"""
Activities router — audit log với pagination thực sự.

Orphan filtering (activity của task đã bị xóa) được thực hiện ở DB level
thay vì Python level, tránh over-fetch và hỗ trợ skip/limit đúng.

Lưu ý: tasks.py đã cascade-delete activities khi xóa task, nên orphan
chỉ tồn tại trong dữ liệu cũ trước khi có cascade. Filter này là safety net.
"""
from fastapi import APIRouter, Depends, Query
from ..core.database import get_db
from ..core.auth import get_current_user, require_admin, MANAGER_ROLES

router = APIRouter(prefix="/api/activities", tags=["activities"])

# Activity types gắn với task — cần lọc orphan
TASK_ACTIVITY_TYPES = {"task_created", "task_accepted", "candidate_status", "cv_submitted"}


def _build_query(current_user: dict, db) -> dict:
    """
    Xây dựng MongoDB query với:
    - Lọc theo user nếu không phải admin
    - Loại bỏ orphan activities ở DB level dùng $or
    """
    # Lấy task IDs còn tồn tại (dùng projection để giảm bandwidth)
    existing_ids = [str(t["_id"]) for t in db.tasks.find({}, {"_id": 1})]

    # Điều kiện để giữ lại activity:
    #   1. Không phải loại task-specific  →  luôn hiển thị (payment, user, v.v.)
    #   2. Không có task_id               →  activity global (vd: task_deleted log)
    #   3. task_id vẫn còn tồn tại        →  task chưa bị xóa
    orphan_ok = {
        "$or": [
            {"type":    {"$nin": list(TASK_ACTIVITY_TYPES)}},
            {"task_id": {"$exists": False}},
            {"task_id": {"$in": existing_ids}},
        ]
    }

    if current_user["role"] not in MANAGER_ROLES:
        return {"$and": [{"actor": current_user["username"]}, orphan_ok]}
    return orphan_ok


@router.get("/")
def list_activities(
    limit: int = Query(default=20, ge=1, le=500, description="Số bản ghi trả về (tối đa 500)"),
    skip:  int = Query(default=0,  ge=0,         description="Bỏ qua N bản ghi đầu (cursor pagination)"),
    current_user: dict = Depends(get_current_user),
):
    """
    Trả về danh sách activity có phân trang.

    Response headers:
        X-Total-Count: tổng số bản ghi thỏa điều kiện (dùng để tính tổng trang)
    """
    from fastapi.responses import JSONResponse

    db = get_db()
    query = _build_query(current_user, db)

    total = db.activities.count_documents(query)
    items = list(
        db.activities.find(query)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )

    for a in items:
        a["_id"]        = str(a["_id"])
        a["created_at"] = a["created_at"].isoformat()

    # Trả về JSONResponse với header total để frontend biết còn bao nhiêu trang
    return JSONResponse(
        content=items,
        headers={"X-Total-Count": str(total)},
    )


@router.delete("/purge-orphans")
def purge_orphan_activities(current_user: dict = Depends(require_admin)):
    """
    Dọn sạch activity của task đã xóa (safety net cho dữ liệu cũ).
    Với dữ liệu mới, cascade delete trong tasks.py đã xử lý rồi.
    """
    db = get_db()
    existing_ids = {str(t["_id"]) for t in db.tasks.find({}, {"_id": 1})}

    orphan_ids = [
        a["_id"]
        for a in db.activities.find(
            {"task_id": {"$exists": True}, "type": {"$in": list(TASK_ACTIVITY_TYPES)}},
            {"_id": 1, "task_id": 1},
        )
        if a.get("task_id") not in existing_ids
    ]

    count = 0
    if orphan_ids:
        result = db.activities.delete_many({"_id": {"$in": orphan_ids}})
        count = result.deleted_count

    return {"message": f"Đã xóa {count} activity mồ côi", "count": count}
