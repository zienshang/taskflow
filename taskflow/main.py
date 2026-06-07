from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
import asyncio
import os
import warnings

from .core.database import connect_db, close_db, get_db
from .core.config import settings
from .core.auth import hash_password
from .core.rate_limit import limiter
from .routers import auth, users, tasks, cvs, activities, payments, notifications, tickets


async def _rate_limiter_cleanup_loop() -> None:
    """Dọn dẹp rate limiter store mỗi giờ để tránh memory leak."""
    while True:
        await asyncio.sleep(3600)
        removed = limiter.cleanup()
        if removed:
            print(f"[RateLimit] Cleaned {removed} stale keys")


# ── Lifespan (thay thế @app.on_event deprecated) ──────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup → yield → Shutdown."""
    # ── STARTUP ──────────────────────────────────────
    _security_warnings()
    connect_db()
    _seed_admin()
    _ensure_upload_dirs()
    asyncio.create_task(_rate_limiter_cleanup_loop())
    yield
    # ── SHUTDOWN ─────────────────────────────────────
    close_db()


def _security_warnings() -> None:
    if settings.is_using_default_secret():
        warnings.warn(
            "\n⚠️  [SECURITY] SECRET_KEY đang dùng giá trị mặc định!"
            "\n   Set env var SECRET_KEY trước khi deploy production."
            "\n   Tạo key: python -c \"import secrets; print(secrets.token_hex(32))\"",
            stacklevel=2,
        )
    if settings.ALLOWED_ORIGINS.strip() == "*":
        warnings.warn(
            "\n⚠️  [SECURITY] CORS cho phép tất cả origins (*)."
            "\n   Set env var ALLOWED_ORIGINS=https://your-domain.com khi deploy.",
            stacklevel=2,
        )


def _seed_admin() -> None:
    """Tạo tài khoản admin mặc định nếu chưa tồn tại."""
    db = get_db()
    if not db.users.find_one({"username": "admin"}):
        import datetime as _dt
        import secrets as _sec
        # Tạo mật khẩu ngẫu nhiên — không hardcode để tránh bị đoán
        _tmp_pw = "Tf@" + _sec.token_hex(5).upper()   # vd: Tf@A1B2C3D4E5
        db.users.insert_one({
            "username":             "admin",
            "full_name":            "Quản trị viên",
            "password_hash":        hash_password(_tmp_pw),
            "role":                 "admin",
            "department":           "Management",
            "email":                "admin@company.com",
            "is_active":            True,
            "must_change_password": True,
            "created_at":           _dt.datetime.utcnow(),
            "created_by":           "system",
            "last_seen":            None,
        })
        print("\n" + "=" * 55)
        print("  [ADMIN] Tai khoan admin duoc tao tu dong")
        print(f"  Username : admin")
        print(f"  Password : {_tmp_pw}")
        print("  !! DOI MAT KHAU NGAY SAU KHI DANG NHAP !!")
        print("=" * 55 + "\n")


def _ensure_upload_dirs() -> None:
    base = os.path.dirname(__file__)
    for sub in ["uploads", "uploads/cvs", "uploads/avatars", "uploads/transfers", "uploads/confirmations", "uploads/tickets"]:
        os.makedirs(os.path.join(base, sub), exist_ok=True)


# ── Security Headers Middleware ────────────────────────
class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Thêm security headers vào mọi HTTP response.

    Tại sao không cần CSRF token:
      - App dùng Authorization: Bearer <jwt> qua header, không dùng cookie.
      - Browser không tự gửi header cross-origin → CSRF miễn nhiễm by design.

    Rủi ro thực sự là XSS (attacker inject JS → đọc localStorage).
    Các header dưới đây giảm thiểu attack surface XSS đáng kể.
    """

    _CSP = (
        "default-src 'self'; "
        # unsafe-inline bắt buộc vì HTML dùng onclick='...' inline handlers
        # Nếu refactor sang addEventListener thì bỏ unsafe-inline được
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        # blob: cho loadSecureImg(), data: cho avatar preview khi upload
        "img-src 'self' blob: data: https:; "
        "connect-src 'self'; "
        # Chặn iframe embedding → chống clickjacking
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        h = response.headers
        h["X-Content-Type-Options"]  = "nosniff"          # chống MIME sniffing
        h["X-Frame-Options"]          = "DENY"             # fallback clickjacking
        h["Referrer-Policy"]          = "strict-origin-when-cross-origin"
        h["Permissions-Policy"]       = "camera=(), microphone=(), geolocation=()"
        h["Content-Security-Policy"]  = self._CSP
        # Xóa header tiết lộ server stack
        for _hdr in ("server", "x-powered-by"):
            try:
                del h[_hdr]
            except KeyError:
                pass
        return response


# ── App ────────────────────────────────────────────────
app = FastAPI(
    title="TaskFlow API",
    version="1.0.0",
    lifespan=lifespan,
    # Tắt Swagger/ReDoc để không lộ API schema ra public internet
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# ── CORS ──────────────────────────────────────────────
# Production: ALLOWED_ORIGINS=https://your-domain.com
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
# Security headers — thêm sau CORS để wrap toàn bộ response
app.add_middleware(_SecurityHeadersMiddleware)

# ── Routers ───────────────────────────────────────────
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(tasks.router)
app.include_router(cvs.router)
app.include_router(activities.router)
app.include_router(payments.router)
app.include_router(notifications.router)
app.include_router(tickets.router)


# ── Health check ──────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "TaskFlow API"}


# ── Serve frontend SPA ─────────────────────────────────
# Ưu tiên static_prod/ (bản obfuscated) nếu đã build; fallback về static/ (dev)
_base        = os.path.dirname(__file__)
static_dir   = os.path.join(_base, "static")
static_prod  = os.path.join(_base, "static_prod")
_serve_dir   = static_prod if os.path.isfile(os.path.join(static_prod, "index.html")) else static_dir
_is_prod     = _serve_dir == static_prod

_uploads_dir = os.path.join(_base, "uploads")

# ── Protected file endpoint — yêu cầu JWT hợp lệ ──────
# Chỉ riêng /uploads/avatars được mount public (dùng cho <img src> avatar/QR)
from fastapi import Depends as _Depends
from .core.auth import get_current_user as _get_current_user

@app.get("/api/uploads/{file_path:path}")
def serve_upload(file_path: str, current_user: dict = _Depends(_get_current_user)):
    """Serve file upload có authentication — ngăn truy cập trái phép CV, ảnh CK."""
    # Chống path traversal: chuẩn hóa và đảm bảo nằm trong uploads/
    norm = os.path.normpath(file_path)
    if norm.startswith("..") or os.path.isabs(norm):
        raise HTTPException(status_code=400, detail="Invalid path")
    full_path = os.path.realpath(os.path.join(_uploads_dir, norm))
    if not full_path.startswith(os.path.realpath(_uploads_dir) + os.sep):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File không tồn tại")
    return FileResponse(full_path)


if os.path.exists(_serve_dir):
    print(f"[Static] Serving {'PRODUCTION (obfuscated)' if _is_prod else 'DEVELOPMENT (source)'}: {_serve_dir}")
    app.mount("/static", StaticFiles(directory=_serve_dir), name="static")

    # Chỉ mount public /uploads/avatars — avatar và QR dùng trong <img src>
    # Các file nhạy cảm (CV, ảnh CK, xác nhận) phục vụ qua /api/uploads/ có auth
    _avatars_dir = os.path.join(_uploads_dir, "avatars")
    if os.path.isdir(_avatars_dir):
        app.mount("/uploads/avatars", StaticFiles(directory=_avatars_dir), name="avatars")

    @app.get("/", response_class=FileResponse)
    def serve_frontend():
        return os.path.join(_serve_dir, "index.html")

    @app.get("/{full_path:path}", response_class=FileResponse)
    def serve_spa(full_path: str):
        return os.path.join(_serve_dir, "index.html")
