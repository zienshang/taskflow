"""
SQLite-backed sliding-window rate limiter.

Tại sao thay thế in-memory limiter:
  - In-memory bị reset mỗi lần server restart → attacker có thể bypass bằng cách
    trigger restart (OOM, crash) rồi brute-force lại ngay.
  - Không hoạt động đúng khi chạy nhiều uvicorn worker (mỗi process có store riêng).

SQLite giải quyết cả hai:
  - Persistent trên disk → survive restart
  - Multi-process safe qua WAL (Write-Ahead Logging) mode
  - Không cần Redis hay bất kỳ service ngoài nào
  - Python stdlib (sqlite3) — zero extra dependency

API không thay đổi:
    from .core.rate_limit import limiter
    limiter.check("login:1.2.3.4", max_hits=10, window_seconds=60)
"""
import logging
import os
import sqlite3
import threading
import time

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# rate_limit.db đặt cùng thư mục với main.py (taskflow/)
_DB_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "rate_limit.db")
)

# Thread-local storage: mỗi thread trong uvicorn threadpool có connection riêng
# (tránh "objects created in a thread can only be used in that thread" của SQLite)
_local  = threading.local()
_schema_lock = threading.Lock()
_schema_ready = False


def _get_conn() -> sqlite3.Connection:
    """
    Lấy SQLite connection cho thread hiện tại.
    Tạo mới nếu chưa có, cấu hình WAL + timeout để chịu concurrent writes.
    """
    if not getattr(_local, "conn", None):
        conn = sqlite3.connect(_DB_PATH, check_same_thread=False, timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL")   # multi-process concurrent access
        conn.execute("PRAGMA synchronous=NORMAL")  # balance giữa safety và speed
        conn.execute("PRAGMA cache_size=-2000")    # 2 MB page cache
        conn.execute("PRAGMA temp_store=MEMORY")
        _local.conn = conn
    return _local.conn


def _ensure_schema() -> None:
    """Tạo bảng + index nếu chưa có. Chạy tối đa 1 lần per process."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        conn = _get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rate_hits (
                key      TEXT NOT NULL,
                hit_time REAL NOT NULL   -- Unix timestamp (float)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_rl_key_time "
            "ON rate_hits (key, hit_time)"
        )
        conn.commit()
        _schema_ready = True


class _RateLimiter:
    """
    Sliding-window rate limiter backed by SQLite.

    Thread-safe, persistent qua restarts, multi-worker compatible.
    Graceful degradation: nếu SQLite lỗi, log warning và cho request đi qua
    (tránh làm down toàn bộ service vì lỗi rate limiter).
    """

    def check(self, key: str, max_hits: int, window_seconds: int) -> None:
        """
        Raises HTTP 429 nếu `key` đã đạt `max_hits` trong `window_seconds` giây.
        Gọi hàm này *trước* khi xử lý request.
        """
        _ensure_schema()
        now    = time.time()
        cutoff = now - window_seconds

        try:
            conn = _get_conn()
            with conn:  # auto-commit / rollback
                # 1. Dọn hits cũ ngoài window (giữ bảng nhỏ)
                conn.execute(
                    "DELETE FROM rate_hits WHERE key=? AND hit_time<?",
                    (key, cutoff),
                )
                # 2. Đếm hits còn trong window
                (count,) = conn.execute(
                    "SELECT COUNT(*) FROM rate_hits WHERE key=? AND hit_time>=?",
                    (key, cutoff),
                ).fetchone()

                if count >= max_hits:
                    raise HTTPException(
                        status_code=429,
                        detail=(
                            f"Quá nhiều yêu cầu ({max_hits} lần / {window_seconds}s). "
                            "Vui lòng thử lại sau."
                        ),
                        headers={"Retry-After": str(window_seconds)},
                    )

                # 3. Ghi hit mới
                conn.execute(
                    "INSERT INTO rate_hits (key, hit_time) VALUES (?,?)",
                    (key, now),
                )

        except HTTPException:
            raise  # re-raise 429, không bị swallow bởi except bên dưới
        except Exception as exc:
            # SQLite lỗi (disk full, locked quá lâu…) → log và cho đi qua
            # Không để rate limiter làm sập toàn bộ login endpoint
            logger.warning("[RateLimit] SQLite error (degraded mode): %s", exc)

    def cleanup(self) -> int:
        """
        Xóa tất cả hits cũ hơn 1 giờ.
        Được gọi từ background task trong main.py mỗi giờ.
        Trả về số rows đã xóa.
        """
        _ensure_schema()
        cutoff = time.time() - 3600
        try:
            conn = _get_conn()
            with conn:
                cur = conn.execute(
                    "DELETE FROM rate_hits WHERE hit_time<?", (cutoff,)
                )
            return cur.rowcount
        except Exception as exc:
            logger.warning("[RateLimit] Cleanup error: %s", exc)
            return 0


# Singleton — import và dùng trực tiếp
limiter = _RateLimiter()
