from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from datetime import datetime
from bson import ObjectId
import os, shutil
from pymongo.errors import DuplicateKeyError
from ..core.database import get_db
from ..core.auth import get_current_user, require_admin, require_manager, MANAGER_ROLES
from ..models.schemas import RequestCompletionBody, RejectPaymentBody

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
TRANSFER_DIR     = os.path.join(BASE_DIR, "uploads", "transfers")
CONFIRMATION_DIR = os.path.join(BASE_DIR, "uploads", "confirmations")

from ..core.config import settings

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def _validate_image(file: UploadFile, field: str = "file"):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"{field}: chỉ hỗ trợ JPG, PNG, WEBP")
    data = file.file.read(settings.IMAGE_MAX_BYTES + 1)
    if len(data) > settings.IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"{field}: ảnh tối đa {settings.IMAGE_MAX_BYTES // 1024 // 1024}MB")
    file.file.seek(0)

router = APIRouter(prefix="/api/payments", tags=["payments"])


def _notify(db, recipient: str, ntype: str, text: str, task_id: str = None, payment_id: str = None):
    doc = {"recipient": recipient, "type": ntype, "text": text,
           "read": False, "created_at": datetime.utcnow()}
    if task_id:
        doc["task_id"] = task_id
    if payment_id:
        doc["payment_id"] = payment_id
    db.notifications.insert_one(doc)


# ── HR: yêu cầu thanh toán ────────────────────────────
@router.post("/request")
def request_completion(body: RequestCompletionBody, current_user: dict = Depends(get_current_user)):
    if current_user["role"] in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Admin/HR Leader không cần yêu cầu thanh toán")
    db = get_db()

    try:
        task_oid = ObjectId(body.task_id)
    except Exception:
        raise HTTPException(status_code=400, detail="task_id không hợp lệ")
    task = db.tasks.find_one({"_id": task_oid, "assigned_to": current_user["username"]})
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy task hoặc task không thuộc về bạn")
    if not task.get("accepted"):
        raise HTTPException(status_code=400, detail="Bạn chưa nhận task này")
    if task.get("candidate_status") != "completed":
        raise HTTPException(status_code=400, detail="Ứng viên chưa hoàn thành thử việc — không thể yêu cầu thanh toán")

    # Chặn nếu còn task KHÁC đang chờ xác nhận thanh toán
    other_pending = db.tasks.find_one({
        "assigned_to": current_user["username"],
        "payment_status": "paid",
        "_id": {"$ne": ObjectId(body.task_id)}
    })
    if other_pending:
        code = f"[{other_pending['task_code']}] " if other_pending.get("task_code") else ""
        raise HTTPException(
            status_code=403,
            detail=f"Vui lòng xác nhận đã nhận tiền hoa hồng cho task {code}'{other_pending['title']}' trước"
        )

    # Đếm CV snapshot trước khi tạo payment
    cv_count = db.cvs.count_documents({"task_id": body.task_id})
    cv_good = db.cvs.count_documents({"task_id": body.task_id, "rating": "good"})

    now = datetime.utcnow()
    doc = {
        "task_id": body.task_id,
        "task_title": task["title"],
        "task_code": task.get("task_code") or "",
        "hr_username": current_user["username"],
        "hr_full_name": current_user["full_name"],
        "completion_note": body.note or "",
        "cv_count_snapshot": cv_count,
        "cv_good_count_snapshot": cv_good,
        "commission_preset": task.get("commission") or "",
        "status": "pending",
        "requested_at": now,
        "created_at": now,
        # admin fill
        "amount": None, "bank_name": None, "bank_account": None,
        "bank_holder": None, "transfer_content": None,
        "admin_note": None, "paid_by": None, "paid_at": None,
        # rejection
        "reject_reason": None, "rejected_by": None, "rejected_at": None,
        # confirmation
        "confirmed_at": None,
    }

    # Atomic insert — partial unique index trên (task_id, status∈active) ngăn duplicate
    # dù 2 request đến cùng lúc: insert thứ 2 sẽ ném DuplicateKeyError
    try:
        result = db.payments.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Task này đã có yêu cầu thanh toán đang xử lý")
    pid = str(result.inserted_id)

    db.tasks.update_one(
        {"_id": ObjectId(body.task_id)},
        {"$set": {"payment_status": "requested", "payment_id": pid}}
    )
    task_code = task.get("task_code") or ""
    task_ref = f"[{task_code}] {task['title']}" if task_code else task["title"]

    db.activities.insert_one({
        "type": "payment_requested", "task_id": body.task_id,
        "text": f"HR {current_user['full_name']} yêu cầu thanh toán hoa hồng — {task_ref}",
        "actor": current_user["username"], "created_at": now,
    })

    for admin in db.users.find({"role": "admin", "is_active": True}, {"username": 1}):
        _notify(db, admin["username"], "completion_requested",
                f"💰 {current_user['full_name']} yêu cầu thanh toán — {task_ref}",
                body.task_id, pid)

    return {"message": "Yêu cầu đã được gửi đến Admin", "id": pid}


# ── Danh sách payments ────────────────────────────────
@router.get("/")
def list_payments(current_user: dict = Depends(get_current_user)):
    db = get_db()
    q = {} if current_user["role"] in MANAGER_ROLES else {"hr_username": current_user["username"]}
    items = list(db.payments.find(q).sort("created_at", -1))
    # Thu thập usernames của admin đã chuyển tiền để lookup 1 lần
    admin_usernames = list({p["paid_by"] for p in items if p.get("paid_by")})
    admin_bank_map = {}
    if admin_usernames:
        for u in db.users.find({"username": {"$in": admin_usernames}},
                               {"username":1,"full_name":1,"bank_name":1,"bank_account":1,"bank_holder":1,"bank_qr":1}):
            admin_bank_map[u["username"]] = u
    for p in items:
        p["_id"] = str(p["_id"])
        for f in ["requested_at", "paid_at", "rejected_at", "confirmed_at", "created_at"]:
            if p.get(f):
                p[f] = p[f].isoformat()
        if p.get("paid_by") and p["paid_by"] in admin_bank_map:
            a = admin_bank_map[p["paid_by"]]
            p["admin_full_name"]   = a.get("full_name", "")
            p["admin_bank_name"]   = a.get("bank_name", "")
            p["admin_bank_account"]= a.get("bank_account", "")
            p["admin_bank_holder"] = a.get("bank_holder", "")
            p["admin_bank_qr"]     = a.get("bank_qr", "")
    return items


# ── Admin: phê duyệt + nhập thông tin CK ─────────────
@router.post("/{payment_id}/approve")
def approve_payment(
    payment_id: str,
    amount: str = Form(...),
    bank_name: str = Form(...),
    bank_account: str = Form(...),
    bank_holder: str = Form(...),
    transfer_content: str = Form(""),
    admin_note: str = Form(""),
    transfer_image: UploadFile = File(...),
    current_user: dict = Depends(require_manager),
):
    db = get_db()
    payment = db.payments.find_one({"_id": ObjectId(payment_id)})
    if not payment:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu")
    if payment["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Yêu cầu đang ở trạng thái '{payment['status']}'")

    # Validate + lưu ảnh chuyển khoản
    _validate_image(transfer_image, "Ảnh chuyển khoản")
    os.makedirs(TRANSFER_DIR, exist_ok=True)
    ext = os.path.splitext(transfer_image.filename)[1].lower() or ".jpg"
    safe_name = f"{payment_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{ext}"
    saved_path = os.path.join(TRANSFER_DIR, safe_name)
    with open(saved_path, "wb") as f:
        shutil.copyfileobj(transfer_image.file, f)
    transfer_image_url = f"/api/uploads/transfers/{safe_name}"

    now = datetime.utcnow()
    db.payments.update_one({"_id": ObjectId(payment_id)}, {"$set": {
        "status": "paid",
        "amount": amount, "bank_name": bank_name,
        "bank_account": bank_account, "bank_holder": bank_holder,
        "transfer_content": transfer_content or "",
        "admin_note": admin_note or "",
        "transfer_image_url": transfer_image_url,
        "paid_by": current_user["username"], "paid_at": now,
    }})
    task_id = payment["task_id"]
    db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": {"payment_status": "paid"}})
    db.activities.insert_one({
        "type": "payment_sent", "task_id": task_id,
        "text": f"Admin đã chuyển {amount} hoa hồng cho {payment['hr_full_name']} — task '{payment['task_title']}'",
        "actor": current_user["username"], "created_at": now,
    })
    _notify(db, payment["hr_username"], "payment_sent",
            f"💸 Admin đã chuyển {amount} cho task '{payment['task_title']}' — kiểm tra và xác nhận!",
            task_id, payment_id)
    return {"message": "Đã xác nhận chuyển khoản, HR sẽ nhận thông báo"}


# ── Admin: từ chối ────────────────────────────────────
@router.post("/{payment_id}/reject")
def reject_payment(payment_id: str, body: RejectPaymentBody, current_user: dict = Depends(require_manager)):
    db = get_db()
    payment = db.payments.find_one({"_id": ObjectId(payment_id)})
    if not payment:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu")
    if payment["status"] != "pending":
        raise HTTPException(status_code=400, detail="Chỉ có thể từ chối yêu cầu đang chờ")

    now = datetime.utcnow()
    db.payments.update_one({"_id": ObjectId(payment_id)}, {"$set": {
        "status": "rejected",
        "reject_reason": body.reason,
        "rejected_by": current_user["username"],
        "rejected_at": now,
    }})
    task_id = payment["task_id"]
    db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": {"payment_status": "rejected"}})
    db.activities.insert_one({
        "type": "payment_rejected", "task_id": task_id,
        "text": f"Admin từ chối yêu cầu của {payment['hr_full_name']} — task '{payment['task_title']}': {body.reason}",
        "actor": current_user["username"], "created_at": now,
    })
    _notify(db, payment["hr_username"], "payment_rejected",
            f"❌ Yêu cầu thanh toán task '{payment['task_title']}' bị từ chối: {body.reason}",
            task_id, payment_id)
    return {"message": "Đã từ chối yêu cầu"}


# ── HR: xác nhận đã nhận tiền (kèm ảnh xác nhận) ─────
@router.post("/{payment_id}/confirm")
def confirm_payment(
    payment_id: str,
    confirmation_image: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] in MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Admin/HR Leader không cần xác nhận nhận tiền")
    db = get_db()
    payment = db.payments.find_one({"_id": ObjectId(payment_id), "hr_username": current_user["username"]})
    if not payment:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu")
    if payment["status"] != "paid":
        raise HTTPException(status_code=400, detail="Chưa có thông tin chuyển khoản để xác nhận")

    # Validate + lưu ảnh xác nhận từ HR
    _validate_image(confirmation_image, "Ảnh xác nhận")
    os.makedirs(CONFIRMATION_DIR, exist_ok=True)
    ext = os.path.splitext(confirmation_image.filename)[1].lower() or ".jpg"
    safe_name = f"{payment_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{ext}"
    with open(os.path.join(CONFIRMATION_DIR, safe_name), "wb") as f:
        shutil.copyfileobj(confirmation_image.file, f)
    confirmation_image_url = f"/api/uploads/confirmations/{safe_name}"

    now = datetime.utcnow()
    db.payments.update_one({"_id": ObjectId(payment_id)}, {"$set": {
        "status": "confirmed",
        "confirmed_at": now,
        "confirmation_image_url": confirmation_image_url,
    }})
    task_id = payment["task_id"]
    db.tasks.update_one({"_id": ObjectId(task_id)},
                        {"$set": {"payment_status": "confirmed", "status": "completed"}})
    db.activities.insert_one({
        "type": "payment_confirmed", "task_id": task_id,
        "text": f"HR {current_user['full_name']} đã xác nhận nhận hoa hồng — task '{payment['task_title']}'",
        "actor": current_user["username"], "created_at": now,
    })
    for admin in db.users.find({"role": "admin", "is_active": True}, {"username": 1}):
        _notify(db, admin["username"], "payment_confirmed",
                f"✅ {current_user['full_name']} đã xác nhận nhận tiền — task '{payment['task_title']}'",
                task_id, payment_id)
    return {"message": "Đã xác nhận. Task chuyển vào Lịch sử."}
