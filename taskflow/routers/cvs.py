from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel
import os
import shutil
from datetime import datetime
from bson import ObjectId
from fastapi.responses import FileResponse
from ..core.database import get_db
from ..core.auth import get_current_user, require_admin, require_manager, MANAGER_ROLES
from ..models.schemas import SubmitCVRequest

class UpdateCVStatusRequest(BaseModel):
    cv_status: str  # pending | good | no

router = APIRouter(prefix="/api/cvs", tags=["cvs"])

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
CV_UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "cvs")

from ..core.config import settings

ALLOWED_CV_EXTS = {".pdf", ".docx", ".doc", ".txt"}

def _validate_cv_file(file: UploadFile):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_CV_EXTS:
        raise HTTPException(status_code=400, detail=f"Định dạng CV không được hỗ trợ. Chấp nhận: {', '.join(sorted(ALLOWED_CV_EXTS))}")
    data = file.file.read(settings.UPLOAD_MAX_BYTES + 1)
    if len(data) > settings.UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"File tối đa {settings.UPLOAD_MAX_BYTES // 1024 // 1024}MB")
    file.file.seek(0)

@router.get("/")
def list_cvs(task_id: str = None, current_user: dict = Depends(get_current_user)):
    db = get_db()
    query = {}
    if current_user["role"] == "hr":
        query["submitted_by"] = current_user["username"]
    if task_id:
        query["task_id"] = task_id
    cvs = list(db.cvs.find(query).sort("submitted_at", -1))
    for c in cvs:
        c["_id"] = str(c["_id"])

    missing_task_ids = list({ObjectId(c["task_id"]) for c in cvs if not c.get("task_code")})
    task_codes = {}
    if missing_task_ids:
        task_codes = {str(t["_id"]): t.get("task_code", "") for t in
                      db.tasks.find({"_id": {"$in": missing_task_ids}}, {"task_code": 1})}

    for c in cvs:
        if not c.get("task_code"):
            c["task_code"] = task_codes.get(c["task_id"], "")
    return cvs

@router.post("/")
def submit_cv(
    task_id: str = Form(...),
    candidate_name: str = Form(...),
    position: str = Form(...),
    rating: str = Form("potential"),
    note: str = Form(""),
    contact: str = Form(""),
    file: UploadFile = File(None),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    if current_user["role"] not in MANAGER_ROLES:
        # HR thường: chặn nếu còn task chờ xác nhận thanh toán
        pending_pay = db.tasks.find_one({"assigned_to": current_user["username"], "payment_status": "paid"})
        if pending_pay:
            code = f"[{pending_pay['task_code']}] " if pending_pay.get("task_code") else ""
            raise HTTPException(
                status_code=403,
                detail=f"Vui lòng xác nhận đã nhận tiền hoa hồng cho task {code}'{pending_pay['title']}' trước khi nộp CV"
            )
        task = db.tasks.find_one({"_id": ObjectId(task_id), "assigned_to": current_user["username"]})
        if not task:
            raise HTTPException(status_code=403, detail="Task này không được giao cho bạn")
    else:
        # Admin / HR Leader: xem được tất cả task
        task = db.tasks.find_one({"_id": ObjectId(task_id)})
        if not task:
            raise HTTPException(status_code=404, detail="Không tìm thấy task")

    file_name = None
    saved_path = None
    if file and file.filename:
        _validate_cv_file(file)
        os.makedirs(CV_UPLOAD_DIR, exist_ok=True)
        safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
        saved_path = os.path.join(CV_UPLOAD_DIR, safe_name)
        with open(saved_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        file_name = file.filename

    cv_doc = {
        "task_id": task_id,
        "task_title": task["title"],
        "task_code": task.get("task_code", ""),
        "candidate_name": candidate_name,
        "position": position,
        "rating": rating,
        "note": note,
        "contact": contact,
        "submitted_by": current_user["username"],
        "submitted_by_name": current_user["full_name"],
        "submitted_at": datetime.utcnow(),
        "file_name": file_name,
        "file_path": f"uploads/cvs/{safe_name}" if saved_path else None,
        "cv_status": "pending",
    }
    result = db.cvs.insert_one(cv_doc)
    db.activities.insert_one({
        "type": "cv_submitted",
        "task_id": task_id,
        "task_code": task.get("task_code") or "",
        "text": f"{current_user['full_name']} nộp CV '{candidate_name}' cho task '{task['title']}'",
        "actor": current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": "Nộp CV thành công", "id": str(result.inserted_id)}

@router.get("/{cv_id}/file")
def download_cv_file(cv_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    cv = db.cvs.find_one({"_id": ObjectId(cv_id)})
    if not cv:
        raise HTTPException(status_code=404, detail="Không tìm thấy CV")
    fpath = cv.get("file_path")
    if not fpath:
        raise HTTPException(status_code=404, detail="CV này không có file đính kèm")
    full = os.path.join(BASE_DIR, fpath)
    if not os.path.exists(full):
        raise HTTPException(status_code=404, detail="File không tồn tại")
    return FileResponse(full, filename=cv.get("file_name", "download"))

@router.put("/{cv_id}/status")
def update_cv_status(cv_id: str, body: UpdateCVStatusRequest, current_user: dict = Depends(require_manager)):
    db = get_db()
    valid = ["pending", "contacted", "good", "no", "trial", "signed"]
    if body.cv_status not in valid:
        raise HTTPException(status_code=400, detail=f"Trạng thái không hợp lệ. Chấp nhận: {', '.join(valid)}")
    result = db.cvs.update_one({"_id": ObjectId(cv_id)}, {"$set": {"cv_status": body.cv_status}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy CV")
    return {"message": "Cập nhật trạng thái CV thành công"}

@router.delete("/{cv_id}")
def delete_cv(cv_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    cv = db.cvs.find_one({"_id": ObjectId(cv_id)})
    if not cv:
        raise HTTPException(status_code=404, detail="Không tìm thấy CV")
    if current_user["role"] == "hr" and cv["submitted_by"] != current_user["username"]:
        raise HTTPException(status_code=403, detail="Không có quyền xóa CV này")
    db.cvs.delete_one({"_id": ObjectId(cv_id)})
    return {"message": "Đã xóa CV"}
