from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
import os
import shutil
from datetime import datetime, timedelta
from bson import ObjectId
from fastapi.responses import FileResponse
from ..core.database import get_db
from ..core.auth import get_current_user, require_admin, require_manager, MANAGER_ROLES
from ..models.schemas import UpdateTaskRequest
from pydantic import BaseModel
from typing import Optional

# HTML sanitizer — loại bỏ scripts/events khỏi task description (stored XSS)
try:
    import nh3 as _nh3
    _ALLOWED_TAGS = frozenset({
        "p", "br", "b", "i", "u", "em", "strong", "s", "del", "mark", "hr",
        "h1", "h2", "h3", "h4", "ul", "ol", "li",
        "a", "span", "div", "blockquote", "pre", "code",
        "table", "thead", "tbody", "tr", "th", "td", "sup", "sub",
    })
    _ALLOWED_ATTRS: dict[str, set[str]] = {
        "a":  {"href", "title", "target"},
        "*":  {"style", "class"},
        "td": {"style", "class", "colspan", "rowspan"},
        "th": {"style", "class", "colspan", "rowspan"},
    }
    def _sanitize_desc(html: str) -> str:
        """Strip mọi script/event handler khỏi HTML, giữ lại tags định dạng an toàn."""
        return _nh3.clean(html, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS) if html else html
except ImportError:
    def _sanitize_desc(html: str) -> str:  # graceful fallback nếu nh3 chưa install
        return html

class UpdateCandidateStatusRequest(BaseModel):
    status: str              # pending | contacted | trial | completed
    cv_id: Optional[str] = None   # CV được đồng bộ trạng thái

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

from ..core.config import settings

ALLOWED_TASK_EXTS = {".pdf", ".docx", ".doc", ".txt", ".xlsx", ".xls", ".pptx", ".ppt", ".png", ".jpg", ".jpeg"}

def _validate_task_file(file: UploadFile):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_TASK_EXTS:
        raise HTTPException(status_code=400, detail=f"Định dạng file không được hỗ trợ. Chấp nhận: {', '.join(sorted(ALLOWED_TASK_EXTS))}")
    data = file.file.read(settings.UPLOAD_MAX_BYTES + 1)
    if len(data) > settings.UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"File tối đa {settings.UPLOAD_MAX_BYTES // 1024 // 1024}MB")
    file.file.seek(0)   # reset so shutil.copyfileobj can re-read

def fmt(task: dict) -> dict:
    task["_id"] = str(task["_id"])
    return task

@router.get("/")
def list_tasks(current_user: dict = Depends(get_current_user)):
    db = get_db()
    query = {} if current_user["role"] in MANAGER_ROLES else {"assigned_to": current_user["username"]}
    tasks = list(db.tasks.find(query).sort("created_at", -1))
    for t in tasks:
        t["_id"] = str(t["_id"])

    task_ids = [t["_id"] for t in tasks]
    usernames = list({t["assigned_to"] for t in tasks})

    cv_counts = {r["_id"]: r["count"] for r in db.cvs.aggregate([
        {"$match": {"task_id": {"$in": task_ids}}},
        {"$group": {"_id": "$task_id", "count": {"$sum": 1}}},
    ])}
    user_names = {u["username"]: u["full_name"] for u in db.users.find(
        {"username": {"$in": usernames}}, {"username": 1, "full_name": 1}
    )}

    for t in tasks:
        t["cv_count"] = cv_counts.get(t["_id"], 0)
        t["assigned_to_name"] = user_names.get(t["assigned_to"], t["assigned_to"])
    return tasks

@router.post("/")
def create_task(
    title: str = Form(...),
    description: str = Form(""),
    assigned_to: str = Form(...),
    task_code: str = Form(""),
    cv_target: int = Form(1),
    deadline: str = Form(...),
    priority: str = Form("normal"),
    commission: str = Form(""),
    file: UploadFile = File(None),
    current_user: dict = Depends(require_manager),
):
    db = get_db()
    if not db.users.find_one({"username": assigned_to, "role": {"$in": ["hr", "hr_leader"]}}):
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên HR này")
    file_name = None
    saved_path = None
    if file and file.filename:
        _validate_task_file(file)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
        saved_path = os.path.join(UPLOAD_DIR, safe_name)
        with open(saved_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        file_name = file.filename
    task_doc = {
        "title": title,
        "task_code": task_code or None,
        "commission": commission or None,
        "description": _sanitize_desc(description),
        "assigned_to": assigned_to,
        "cv_target": cv_target,
        "deadline": deadline,
        "priority": priority,
        "status": "active",
        "accepted": False,
        "candidate_status": "pending",
        "created_by": current_user["username"],
        "created_at": datetime.utcnow(),
        "file_name": file_name,
        "file_path": f"uploads/{safe_name}" if saved_path else None,
    }
    result = db.tasks.insert_one(task_doc)
    assignee = db.users.find_one({"username": assigned_to})
    db.activities.insert_one({
        "type": "task_created",
        "task_id": str(result.inserted_id),
        "text": f"Admin giao task '{title}' cho {assignee['full_name'] if assignee else assigned_to}",
        "actor": current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": "Tạo task thành công", "id": str(result.inserted_id)}

@router.get("/{task_id}/file")
def download_file(task_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    task = db.tasks.find_one({"_id": ObjectId(task_id)})
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy task")
    fpath = task.get("file_path")
    if not fpath:
        raise HTTPException(status_code=404, detail="Task này không có file đính kèm")
    full = os.path.join(BASE_DIR, fpath)
    if not os.path.exists(full):
        raise HTTPException(status_code=404, detail="File không tồn tại")
    return FileResponse(full, filename=task.get("file_name", "download"))

@router.put("/{task_id}")
def update_task(task_id: str, body: UpdateTaskRequest, current_user: dict = Depends(require_manager)):
    db = get_db()
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if "description" in update:
        update["description"] = _sanitize_desc(update["description"])
    if not update:
        raise HTTPException(status_code=400, detail="Không có dữ liệu cập nhật")
    task = db.tasks.find_one({"_id": ObjectId(task_id)}, {"title": 1})
    result = db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy task")
    _field_labels = {"title": "tiêu đề", "description": "mô tả", "cv_target": "target CV",
                     "deadline": "deadline", "priority": "ưu tiên", "status": "trạng thái"}
    changed = ", ".join(_field_labels.get(f, f) for f in update)
    db.activities.insert_one({
        "type": "task_updated",
        "task_id": task_id,
        "text": f"Admin cập nhật {changed} — task '{task['title'] if task else task_id}'",
        "actor": current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": "Cập nhật task thành công"}

@router.put("/{task_id}/candidate-status")
def update_candidate_status(task_id: str, body: UpdateCandidateStatusRequest, current_user: dict = Depends(require_manager)):
    db = get_db()
    valid = ["pending", "contacted", "trial", "completed"]
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Trạng thái không hợp lệ. Chấp nhận: {', '.join(valid)}")
    update = {"candidate_status": body.status}
    if body.status == "trial":
        update["trial_started_at"] = datetime.utcnow()
    if body.status == "completed":
        update["completed_at"] = datetime.utcnow()
    result = db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy task")

    # Đồng bộ cv_status cho CV được chọn
    _cv_status_sync = {"contacted": "contacted", "trial": "trial", "completed": "signed"}
    if body.cv_id and body.status in _cv_status_sync:
        db.cvs.update_one(
            {"_id": ObjectId(body.cv_id)},
            {"$set": {"cv_status": _cv_status_sync[body.status]}}
        )

    task = db.tasks.find_one({"_id": ObjectId(task_id)})
    db.activities.insert_one({
        "type": "candidate_status",
        "task_id": task_id,
        "text": f"Admin cập nhật trạng thái task '{task['title']}' thành '{body.status}'",
        "actor": current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": "Cập nhật trạng thái thành công"}


@router.post("/{task_id}/confirm-trial")
def confirm_trial_completion(task_id: str, current_user: dict = Depends(require_manager)):
    """Admin xác nhận ứng viên đã ký hợp đồng sau khi hết thời gian thử việc."""
    db = get_db()
    task = db.tasks.find_one({"_id": ObjectId(task_id)})
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy task")
    if task.get("candidate_status") != "trial":
        raise HTTPException(status_code=400, detail="Task không ở trạng thái thử việc")
    now = datetime.utcnow()
    db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": {"candidate_status": "completed", "completed_at": now}}
    )
    db.activities.insert_one({
        "type": "candidate_status",
        "task_id": task_id,
        "text": f"Admin xác nhận ứng viên đã ký hợp đồng — task '{task['title']}'",
        "actor": current_user["username"],
        "created_at": now,
    })
    return {"message": "Đã xác nhận hoàn thành thử việc"}


def _block_if_pending_payment(db, username: str, exclude_task_id: str = None):
    """Chặn HR nếu còn task đang chờ xác nhận thanh toán."""
    q = {"assigned_to": username, "payment_status": "paid"}
    if exclude_task_id:
        q["_id"] = {"$ne": ObjectId(exclude_task_id)}
    pending = db.tasks.find_one(q)
    if pending:
        code = f"[{pending['task_code']}] " if pending.get("task_code") else ""
        raise HTTPException(
            status_code=403,
            detail=f"Vui lòng xác nhận đã nhận tiền hoa hồng cho task {code}'{pending['title']}' trước khi thực hiện thao tác này"
        )

@router.post("/{task_id}/accept")
def accept_task(task_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user["role"] == "hr":
        _block_if_pending_payment(db, current_user["username"])

    # Atomic update: chỉ update nếu task tồn tại, chưa accepted, và đúng người nhận.
    # Tránh race condition khi 2 request đến cùng lúc.
    now = datetime.utcnow()
    result = db.tasks.find_one_and_update(
        {"_id": ObjectId(task_id), "assigned_to": current_user["username"], "accepted": False},
        {"$set": {"accepted": True, "accepted_at": now}},
        projection={"title": 1, "assigned_to": 1, "accepted": 1},
        return_document=False,
    )
    if result is None:
        # Phân biệt: task không tồn tại, không thuộc người dùng, hay đã accepted
        task = db.tasks.find_one({"_id": ObjectId(task_id)}, {"assigned_to": 1, "accepted": 1})
        if not task:
            raise HTTPException(status_code=404, detail="Không tìm thấy task")
        if task["assigned_to"] != current_user["username"]:
            raise HTTPException(status_code=403, detail="Bạn không được giao task này")
        return {"message": "Task đã được nhận trước đó"}

    db.activities.insert_one({
        "type": "task_accepted",
        "task_id": task_id,
        "text": f"HR {current_user['full_name']} đã nhận task '{result['title']}'",
        "actor": current_user["username"],
        "created_at": now,
    })
    return {"message": "Đã nhận task"}

@router.delete("/{task_id}")
def delete_task(task_id: str, current_user: dict = Depends(require_manager)):
    db = get_db()
    task = db.tasks.find_one({"_id": ObjectId(task_id)}, {"title": 1, "task_code": 1})
    result = db.tasks.delete_one({"_id": ObjectId(task_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy task")
    # Cascade: xóa tất cả dữ liệu liên quan đến task này
    db.activities.delete_many({"task_id": task_id})
    db.cvs.delete_many({"task_id": task_id})
    db.payments.delete_many({"task_id": task_id})
    db.notifications.delete_many({"task_id": task_id})
    # Log xóa — không đặt task_id để log này tồn tại sau cascade
    if task:
        code = f"[{task['task_code']}] " if task.get("task_code") else ""
        db.activities.insert_one({
            "type": "task_deleted",
            "text": f"Admin đã xóa task {code}'{task['title']}'",
            "actor": current_user["username"],
            "created_at": datetime.utcnow(),
        })
    return {"message": "Đã xóa task"}

@router.get("/stats/overview")
def get_stats(current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user["role"] in MANAGER_ROLES:
        # Projection: loại bỏ description (HTML nặng) để giảm lượng data transfer từ DB
        task_proj = {"description": 0}
        all_tasks = list(db.tasks.find({}, task_proj).sort("created_at", -1))
        for t in all_tasks:
            t["_id"] = str(t["_id"])
            t["cv_count"] = 0
            t["cv_good_count"] = 0
            t["cv_no_count"] = 0
            t["cvs"] = []

        # Index O(1) cho lookup task theo _id
        task_map: dict = {t["_id"]: t for t in all_tasks}
        tasks_by_user: dict = {}
        for t in all_tasks:
            tasks_by_user.setdefault(t["assigned_to"], []).append(t)

        # Batch: CV stats tổng hợp theo user (1 aggregation)
        cv_by_user = {r["_id"]: r for r in db.cvs.aggregate([
            {"$group": {
                "_id": "$submitted_by",
                "cv_count": {"$sum": 1},
                "good_cv_count": {"$sum": {"$cond": [{"$eq": ["$rating", "good"]}, 1, 0]}},
            }}
        ])}

        # 1 pass qua tất cả CVs — dùng dict lookup O(1) thay vì build cv_by_task riêng
        for cv in db.cvs.find({}, {"task_id": 1, "candidate_name": 1, "position": 1, "rating": 1}):
            t = task_map.get(cv["task_id"])
            if t is None:
                continue
            t["cv_count"] += 1
            r = cv.get("rating", "")
            if r == "good":
                t["cv_good_count"] += 1
            elif r == "no":
                t["cv_no_count"] += 1
            t["cvs"].append({
                "candidate_name": cv["candidate_name"],
                "position": cv.get("position", ""),
                "rating": r,
            })

        hr_list = list(db.users.find({"role": {"$in": ["hr", "hr_leader"]}}, {"password_hash": 0}))
        for hr in hr_list:
            hr["_id"] = str(hr["_id"])
            udata = cv_by_user.get(hr["username"], {})
            hr["cv_count"] = udata.get("cv_count", 0)
            hr["good_cv_count"] = udata.get("good_cv_count", 0)
            hr_tasks = tasks_by_user.get(hr["username"], [])
            for t in hr_tasks:
                t["assigned_to_name"] = hr["full_name"]
            hr["tasks"] = hr_tasks

        total_tasks = len(all_tasks)
        active_tasks = sum(1 for t in all_tasks if t.get("status") == "active")
        total_cvs = db.cvs.count_documents({})
        total_hr = db.users.count_documents({"role": {"$in": ["hr", "hr_leader"]}, "is_active": True})
        return {"total_tasks": total_tasks, "active_tasks": active_tasks,
                "total_cvs": total_cvs, "total_hr": total_hr, "hr_list": hr_list}
    else:
        my_tasks = db.tasks.count_documents({"assigned_to": current_user["username"]})
        my_cvs = db.cvs.count_documents({"submitted_by": current_user["username"]})
        return {"my_tasks": my_tasks, "my_cvs": my_cvs}
