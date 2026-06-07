"""
Database module — MongoDB connection pool.

PyMongo's MongoClient is thread-safe và có built-in connection pooling,
nên singleton per-process là đúng. Mỗi worker process tạo client riêng.
"""
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.database import Database
from .config import settings

_client: MongoClient = None
_db: Database = None


def connect_db() -> None:
    global _client, _db
    _client = MongoClient(
        settings.MONGODB_URL,
        # Connection pool
        maxPoolSize=50,
        minPoolSize=5,
        maxIdleTimeMS=30_000,       # đóng connection nhàn quá 30s
        # Timeouts
        serverSelectionTimeoutMS=5_000,   # fail-fast nếu không tìm được server
        connectTimeoutMS=5_000,
        socketTimeoutMS=15_000,
        # Retry
        retryWrites=True,
        retryReads=True,
    )
    _db = _client[settings.DB_NAME]
    _ensure_indexes(_db)
    print(f"[OK] Connected to MongoDB: {settings.DB_NAME}")


def _ensure_indexes(db: Database) -> None:
    """Tạo tất cả indexes một lần khi khởi động."""
    # users
    db.users.create_index("username", unique=True)
    db.users.create_index("role")
    db.users.create_index("last_seen")

    # tasks
    db.tasks.create_index([("created_at", DESCENDING)])
    db.tasks.create_index([("assigned_to", ASCENDING), ("status", ASCENDING)])
    db.tasks.create_index([("assigned_to", ASCENDING), ("payment_status", ASCENDING)])

    # cvs
    db.cvs.create_index("task_id")
    db.cvs.create_index([("submitted_by", ASCENDING)])
    db.cvs.create_index([("submitted_at", DESCENDING)])

    # activities — index desc để sort mặc định hiệu quả
    db.activities.create_index([("created_at", DESCENDING)])
    db.activities.create_index([("actor", ASCENDING), ("created_at", DESCENDING)])
    db.activities.create_index("task_id")   # cho orphan lookup

    # tasks — thêm index cho payment_status (dùng trong block_if_pending_payment)
    db.tasks.create_index("payment_status")

    # payments
    db.payments.create_index("task_id")
    db.payments.create_index("hr_username")
    db.payments.create_index([("created_at", DESCENDING)])
    db.payments.create_index([("hr_username", ASCENDING), ("status", ASCENDING)])
    # Partial unique index: mỗi task chỉ có 1 payment ở trạng thái active tại 1 thời điểm.
    # Ngăn race condition khi 2 request gửi cùng lúc vượt qua kiểm tra rồi cùng insert.
    db.payments.create_index(
        [("task_id", ASCENDING)],
        unique=True,
        partialFilterExpression={"status": {"$in": ["pending", "paid", "confirmed"]}},
        name="unique_active_payment_per_task",
    )

    # notifications
    db.notifications.create_index([("recipient", ASCENDING), ("read", ASCENDING)])
    db.notifications.create_index([("recipient", ASCENDING), ("created_at", DESCENDING)])

    # tickets
    db.tickets.create_index("ticket_code", unique=True)
    db.tickets.create_index([("created_by", ASCENDING), ("status", ASCENDING)])
    db.tickets.create_index([("status", ASCENDING),     ("created_at", DESCENDING)])
    db.tickets.create_index([("assigned_to", ASCENDING),("status", ASCENDING)])
    db.tickets.create_index([("created_at", DESCENDING)])

    # ticket_comments
    db.ticket_comments.create_index([("ticket_id", ASCENDING), ("created_at", ASCENDING)])


def get_db() -> Database:
    if _db is None:
        raise RuntimeError(
            "Database chưa được khởi tạo — gọi connect_db() trong startup."
        )
    return _db


def close_db() -> None:
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None
