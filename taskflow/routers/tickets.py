"""
Ticket router — hệ thống hỗ trợ nội bộ.

Luồng:
  HR tạo ticket (open)
  → Manager nhận thông báo, nhận ticket (in_progress)
  → Trao đổi qua comment thread
  → Manager resolved → HR nhận thông báo → closed
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.responses import FileResponse, JSONResponse
from datetime import datetime, date
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from typing import Optional
import os, shutil

from ..core.database import get_db
from ..core.auth import get_current_user, require_admin, require_manager, MANAGER_ROLES
from ..core.config import settings
from ..core.rate_limit import limiter

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

BASE_DIR          = os.path.dirname(os.path.dirname(__file__))
TICKET_UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "tickets")

ALLOWED_EXTS = {".pdf", ".docx", ".doc", ".txt", ".xlsx", ".xls",
                ".png", ".jpg", ".jpeg", ".webp"}

CATEGORY_LABEL = {
    "technical":    "Hỗ trợ kỹ thuật",
    "issue":        "Báo cáo vấn đề",
    "info_request": "Yêu cầu thông tin",
    "feedback":     "Phản hồi / Góp ý",
}
STATUS_LABEL = {
    "open":        "Mở",
    "in_progress": "Đang xử lý",
    "resolved":    "Đã giải quyết",
    "closed":      "Đã đóng",
}
PRIORITY_LABEL = {"low":"Thấp","normal":"Bình thường","high":"Cao","urgent":"Khẩn cấp"}


# ── Helpers ───────────────────────────────────────────

def _generate_code(db) -> str:
    """Sinh mã ticket tăng dần theo năm: TKT-2026-001"""
    year   = datetime.utcnow().year
    prefix = f"TKT-{year}-"
    last   = db.tickets.find_one(
        {"ticket_code": {"$regex": f"^{prefix}"}},
        sort=[("ticket_code", -1)],
    )
    num = 1
    if last:
        try:
            num = int(last["ticket_code"].split("-")[-1]) + 1
        except (ValueError, IndexError):
            num = 1
    return f"{prefix}{num:03d}"


def _notify(db, recipients: list, ntype: str, text: str, ticket_id: str):
    """Push notification đến nhiều người — tái dùng pattern payments.py."""
    now  = datetime.utcnow()
    docs = [
        {"recipient": r, "type": ntype, "text": text,
         "read": False, "ticket_id": ticket_id, "created_at": now}
        for r in recipients if r
    ]
    if docs:
        db.notifications.insert_many(docs)


def _can_access(ticket: dict, user: dict) -> bool:
    """Manager thấy tất cả; HR chỉ thấy ticket của mình."""
    if user["role"] in MANAGER_ROLES:
        return True
    return ticket.get("created_by") == user["username"]


def _serialize(t: dict) -> dict:
    t["_id"] = str(t["_id"])
    for f in ("created_at", "updated_at", "resolved_at", "closed_at"):
        if t.get(f):
            t[f] = t[f].isoformat()
    # due_date là date object hoặc string
    if t.get("due_date") and not isinstance(t["due_date"], str):
        t["due_date"] = t["due_date"].isoformat()
    return t


def _validate_file(file: UploadFile):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"Định dạng không hỗ trợ. Chấp nhận: {', '.join(sorted(ALLOWED_EXTS))}")
    data = file.file.read(settings.UPLOAD_MAX_BYTES + 1)
    if len(data) > settings.UPLOAD_MAX_BYTES:
        raise HTTPException(400, f"File tối đa {settings.UPLOAD_MAX_BYTES // 1024 // 1024} MB")
    file.file.seek(0)


def _get_managers(db, exclude: str = None) -> list:
    q = {"role": {"$in": list(MANAGER_ROLES)}, "is_active": True}
    if exclude:
        q["username"] = {"$ne": exclude}
    return [u["username"] for u in db.users.find(q, {"username": 1})]


def _parse_date(date_str: str):
    """Parse YYYY-MM-DD, trả về None nếu rỗng, raise 400 nếu sai định dạng."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "due_date phải có định dạng YYYY-MM-DD")


def _get_ticket_or_404(db, ticket_id: str) -> dict:
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(400, "ID ticket không hợp lệ")
    ticket = db.tickets.find_one({"_id": oid})
    if not ticket:
        raise HTTPException(404, "Không tìm thấy ticket")
    return ticket


# ── LIST ──────────────────────────────────────────────

@router.get("/")
def list_tickets(
    status:      str = Query(None),
    category:    str = Query(None),
    priority:    str = Query(None),
    created_by:  str = Query(None),   # filter by user (manager only)
    overdue:     bool = Query(False),  # chỉ lấy ticket quá hạn
    limit: int = Query(50, ge=1, le=200),
    skip:  int = Query(0,  ge=0),
    current_user: dict = Depends(get_current_user),
):
    db    = get_db()
    query = {}
    if current_user["role"] not in MANAGER_ROLES:
        query["created_by"] = current_user["username"]
    elif created_by:
        query["created_by"] = created_by
    if status:   query["status"]   = status
    if category: query["category"] = category
    if priority: query["priority"] = priority
    if overdue:
        # Ticket chưa đóng và đã quá due_date
        now = datetime.utcnow()
        query["due_date"]  = {"$lt": now}
        query["status"]    = {"$in": ["open", "in_progress"]}

    total = db.tickets.count_documents(query)
    items = list(db.tickets.find(query).sort("created_at", -1).skip(skip).limit(limit))

    for t in items:
        _serialize(t)
        t["comment_count"] = db.ticket_comments.count_documents({"ticket_id": t["_id"]})

    return JSONResponse(content=items, headers={"X-Total-Count": str(total)})


# ── STATS ─────────────────────────────────────────────

@router.get("/stats")
def get_stats(current_user: dict = Depends(require_manager)):
    db = get_db()
    return {
        "open":        db.tickets.count_documents({"status": "open"}),
        "in_progress": db.tickets.count_documents({"status": "in_progress"}),
        "resolved":    db.tickets.count_documents({"status": "resolved"}),
        "closed":      db.tickets.count_documents({"status": "closed"}),
        "total":       db.tickets.count_documents({}),
        "unassigned":  db.tickets.count_documents({"status": "open", "assigned_to": None}),
    }


# ── CREATE ────────────────────────────────────────────

@router.post("/")
async def create_ticket(
    title:       str          = Form(...),
    description: str          = Form(""),
    category:    str          = Form("issue"),
    priority:    str          = Form("normal"),
    due_date:    str          = Form(None),   # YYYY-MM-DD, optional
    file:        UploadFile   = File(None),
    current_user: dict = Depends(get_current_user),
):
    limiter.check(f"ticket:{current_user['username']}", max_hits=10, window_seconds=60)

    db = get_db()
    if category not in CATEGORY_LABEL:
        raise HTTPException(400, "Category không hợp lệ")
    if priority not in PRIORITY_LABEL:
        raise HTTPException(400, "Priority không hợp lệ")
    if not title.strip():
        raise HTTPException(400, "Tiêu đề không được để trống")

    # Upload file nếu có
    file_name = saved_rel = None
    if file and file.filename:
        _validate_file(file)
        os.makedirs(TICKET_UPLOAD_DIR, exist_ok=True)
        safe   = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
        dest   = os.path.join(TICKET_UPLOAD_DIR, safe)
        with open(dest, "wb") as fp:
            shutil.copyfileobj(file.file, fp)
        file_name  = file.filename
        saved_rel  = f"uploads/tickets/{safe}"

    now = datetime.utcnow()
    # Thử tối đa 3 lần để tránh DuplicateKeyError do concurrent inserts
    for _attempt in range(3):
        code = _generate_code(db)
        doc  = {
        "ticket_code":    code,
        "title":          title.strip(),
        "description":    description,
        "category":       category,
        "priority":       priority,
        "status":         "open",
        "created_by":     current_user["username"],
        "created_by_name":current_user["full_name"],
        "assigned_to":    None,
        "file_name":      file_name,
        "file_path":      saved_rel,
        "due_date":       _parse_date(due_date),
        "created_at":     now,
        "updated_at":     now,
        "resolved_at":    None,
        "closed_at":      None,
    }
        try:
            result = db.tickets.insert_one(doc)
            ticket_id = str(result.inserted_id)
            break
        except DuplicateKeyError:
            if _attempt == 2:
                raise HTTPException(500, "Không thể tạo ticket, vui lòng thử lại")
            continue

    db.activities.insert_one({
        "type":       "ticket_created",
        "text":       f"{current_user['full_name']} tạo ticket [{code}] '{title.strip()}'",
        "actor":      current_user["username"],
        "created_at": now,
    })

    managers = _get_managers(db, exclude=current_user["username"])
    _notify(db, managers, "ticket_created",
            f"🎫 {current_user['full_name']} tạo ticket mới [{code}]: {title.strip()}",
            ticket_id)

    return {"message": "Tạo ticket thành công", "id": ticket_id, "ticket_code": code}


# ── DETAIL ────────────────────────────────────────────

@router.get("/{ticket_id}")
def get_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    db     = get_db()
    ticket = _get_ticket_or_404(db, ticket_id)
    if not _can_access(ticket, current_user):
        raise HTTPException(403, "Bạn không có quyền xem ticket này")

    _serialize(ticket)

    # Comments (lọc internal note nếu không phải manager)
    comments = list(db.ticket_comments.find(
        {"ticket_id": ticket_id}
    ).sort("created_at", 1))
    if current_user["role"] not in MANAGER_ROLES:
        comments = [c for c in comments if not c.get("is_internal")]
    for c in comments:
        c["_id"] = str(c["_id"])
        if c.get("created_at"):
            c["created_at"] = c["created_at"].isoformat()
    ticket["comments"] = comments

    # Assigned-to full name
    if ticket.get("assigned_to"):
        u = db.users.find_one({"username": ticket["assigned_to"]}, {"full_name": 1})
        ticket["assigned_to_name"] = u["full_name"] if u else ticket["assigned_to"]
    else:
        ticket["assigned_to_name"] = None

    return ticket


# ── COMMENTS ─────────────────────────────────────────

@router.post("/{ticket_id}/comments")
def add_comment(
    ticket_id:   str  = None,
    content:     str  = Form(...),
    is_internal: bool = Form(False),
    current_user: dict = Depends(get_current_user),
):
    limiter.check(f"tcmt:{current_user['username']}", max_hits=20, window_seconds=60)

    db     = get_db()
    ticket = _get_ticket_or_404(db, ticket_id)
    if not _can_access(ticket, current_user):
        raise HTTPException(403, "Bạn không có quyền comment vào ticket này")
    if ticket["status"] == "closed":
        raise HTTPException(400, "Ticket đã đóng, không thể thêm phản hồi")
    if not content.strip():
        raise HTTPException(400, "Nội dung không được để trống")

    # Chỉ manager tạo được internal note
    if is_internal and current_user["role"] not in MANAGER_ROLES:
        is_internal = False

    now = datetime.utcnow()
    db.ticket_comments.insert_one({
        "ticket_id":   ticket_id,
        "content":     content.strip(),
        "author":      current_user["username"],
        "author_name": current_user["full_name"],
        "author_role": current_user["role"],
        "is_internal": is_internal,
        "created_at":  now,
    })
    db.tickets.update_one({"_id": ObjectId(ticket_id)}, {"$set": {"updated_at": now}})

    code  = ticket.get("ticket_code", ticket_id)
    title = ticket.get("title", "")

    if not is_internal:
        if current_user["role"] in MANAGER_ROLES:
            # Manager trả lời → báo HR
            if ticket["created_by"] != current_user["username"]:
                _notify(db, [ticket["created_by"]], "ticket_replied",
                        f"💬 [{code}] {current_user['full_name']} phản hồi: {title}",
                        ticket_id)
        else:
            # HR trả lời → báo managers
            _notify(db, _get_managers(db), "ticket_replied",
                    f"💬 [{code}] {current_user['full_name']} phản hồi: {title}",
                    ticket_id)

    return {"message": "Đã thêm phản hồi"}


# ── UPDATE ────────────────────────────────────────────

@router.put("/{ticket_id}")
def update_ticket(
    ticket_id:   str = None,
    priority:    str = Form(None),
    assigned_to: str = Form(None),
    title:       str = Form(None),
    due_date:    str = Form(None),   # YYYY-MM-DD | "" để xóa
    current_user: dict = Depends(require_manager),
):
    db     = get_db()
    ticket = _get_ticket_or_404(db, ticket_id)

    upd = {"updated_at": datetime.utcnow()}
    if priority is not None:
        if priority not in PRIORITY_LABEL:
            raise HTTPException(400, "Priority không hợp lệ")
        upd["priority"] = priority
    if assigned_to is not None:
        if assigned_to == "":
            upd["assigned_to"] = None
        else:
            if not db.users.find_one({"username": assigned_to, "role": {"$in": list(MANAGER_ROLES)}}):
                raise HTTPException(404, "Không tìm thấy manager")
            upd["assigned_to"] = assigned_to
    if title and title.strip():
        upd["title"] = title.strip()
    if due_date is not None:
        upd["due_date"] = _parse_date(due_date) if due_date else None

    db.tickets.update_one({"_id": ticket["_id"]}, {"$set": upd})
    return {"message": "Cập nhật thành công"}


# ── DELETE ────────────────────────────────────────────

@router.delete("/{ticket_id}")
def delete_ticket(ticket_id: str, current_user: dict = Depends(require_admin)):
    """Chỉ Admin mới được xóa ticket. Cascade xóa toàn bộ comments."""
    db     = get_db()
    ticket = _get_ticket_or_404(db, ticket_id)

    # Cascade: xóa comments trước
    db.ticket_comments.delete_many({"ticket_id": ticket_id})
    db.tickets.delete_one({"_id": ticket["_id"]})

    code = ticket.get("ticket_code", ticket_id)
    db.activities.insert_one({
        "type":       "ticket_updated",
        "text":       f"{current_user['full_name']} xoa ticket [{code}] '{ticket.get('title', '')}'",
        "actor":      current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": f"Da xoa ticket [{code}]"}


# ── CHANGE STATUS ─────────────────────────────────────

@router.post("/{ticket_id}/status")
def change_status(
    ticket_id: str  = None,
    status:    str  = Form(...),
    comment:   str  = Form(""),
    current_user: dict = Depends(require_manager),
):
    if status not in STATUS_LABEL:
        raise HTTPException(400, "Trạng thái không hợp lệ")

    db     = get_db()
    ticket = _get_ticket_or_404(db, ticket_id)

    now = datetime.utcnow()
    upd = {"status": status, "updated_at": now}
    if status == "resolved": upd["resolved_at"] = now
    if status == "closed":   upd["closed_at"]   = now

    db.tickets.update_one({"_id": ticket["_id"]}, {"$set": upd})

    # Auto-comment hệ thống
    auto_text = f"🔄 Trạng thái: **{STATUS_LABEL[status]}**"
    if comment.strip():
        auto_text += f"\n{comment.strip()}"

    db.ticket_comments.insert_one({
        "ticket_id":   ticket_id,
        "content":     auto_text,
        "author":      current_user["username"],
        "author_name": current_user["full_name"],
        "author_role": current_user["role"],
        "is_internal": False,
        "is_system":   True,
        "created_at":  now,
    })

    code = ticket.get("ticket_code", ticket_id)
    db.activities.insert_one({
        "type":       "ticket_updated",
        "text":       f"{current_user['full_name']} cập nhật [{code}] → {STATUS_LABEL[status]}",
        "actor":      current_user["username"],
        "created_at": now,
    })

    # Báo owner nếu khác người thực hiện
    if ticket["created_by"] != current_user["username"]:
        _notify(db, [ticket["created_by"]], "ticket_status_changed",
                f"🎫 [{code}] Ticket của bạn: {STATUS_LABEL[status]}",
                ticket_id)

    return {"message": f"Đã chuyển sang '{STATUS_LABEL[status]}'"}


# ── FILE DOWNLOAD ─────────────────────────────────────

@router.get("/{ticket_id}/file")
def download_file(ticket_id: str, current_user: dict = Depends(get_current_user)):
    db     = get_db()
    ticket = _get_ticket_or_404(db, ticket_id)
    if not _can_access(ticket, current_user):
        raise HTTPException(403, "Không có quyền truy cập")
    fpath = ticket.get("file_path")
    if not fpath:
        raise HTTPException(404, "Ticket này không có file đính kèm")
    full = os.path.join(BASE_DIR, fpath)
    if not os.path.exists(full):
        raise HTTPException(404, "File không tồn tại trên server")
    return FileResponse(full, filename=ticket.get("file_name", "download"))
