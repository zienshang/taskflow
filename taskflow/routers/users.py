from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timedelta
from bson import ObjectId
from ..core.database import get_db
from ..core.auth import hash_password, require_admin, require_manager, get_current_user
from ..models.schemas import CreateUserRequest, UpdateUserRequest, ResetPasswordRequest

router = APIRouter(prefix="/api/users", tags=["users"])


def _block_if_target_is_admin(target_username: str, db, actor_role: str):
    """HR Leader không được thao tác lên tài khoản Admin."""
    if actor_role == "hr_leader":
        target = db.users.find_one({"username": target_username}, {"role": 1})
        if target and target.get("role") == "admin":
            raise HTTPException(
                status_code=403,
                detail="HR Leader không có quyền thao tác lên tài khoản Admin"
            )


@router.get("/")
def list_users(current_user: dict = Depends(require_manager)):
    db = get_db()
    users = list(db.users.find({}, {"password_hash": 0}))
    for u in users:
        u["_id"] = str(u["_id"])

    usernames = [u["username"] for u in users]

    # 2 aggregation thay vì 2N count_documents (loại bỏ N+1)
    cv_counts = {r["_id"]: r["count"] for r in db.cvs.aggregate([
        {"$match": {"submitted_by": {"$in": usernames}}},
        {"$group": {"_id": "$submitted_by", "count": {"$sum": 1}}},
    ])}
    task_counts = {r["_id"]: r["count"] for r in db.tasks.aggregate([
        {"$match": {"assigned_to": {"$in": usernames}, "status": "active"}},
        {"$group": {"_id": "$assigned_to", "count": {"$sum": 1}}},
    ])}

    for u in users:
        u["cv_count"]     = cv_counts.get(u["username"], 0)
        u["active_tasks"] = task_counts.get(u["username"], 0)
    return users


@router.post("/")
def create_user(body: CreateUserRequest, current_user: dict = Depends(require_manager)):
    db = get_db()
    # HR Leader không được tạo tài khoản Admin
    if current_user["role"] == "hr_leader" and body.role == "admin":
        raise HTTPException(status_code=403, detail="HR Leader không có quyền tạo tài khoản Admin")
    if db.users.find_one({"username": body.username}):
        raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{body.username}' đã tồn tại")
    user_doc = {
        "username":             body.username,
        "full_name":            body.full_name,
        "password_hash":        hash_password(body.password),
        "role":                 body.role,
        "department":           body.department,
        "email":                body.email or "",
        "is_active":            True,
        "must_change_password": True,
        "created_at":           datetime.utcnow(),
        "created_by":           current_user["username"],
        "last_seen":            None,
    }
    result = db.users.insert_one(user_doc)
    db.activities.insert_one({
        "type":       "user_created",
        "text":       f"'{current_user['username']}' tạo tài khoản '{body.username}' ({body.full_name}) - vai trò: {body.role}",
        "actor":      current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": "Tạo tài khoản thành công", "id": str(result.inserted_id)}


@router.put("/{username}")
def update_user(username: str, body: UpdateUserRequest, current_user: dict = Depends(require_manager)):
    db = get_db()
    _block_if_target_is_admin(username, db, current_user["role"])
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Không có dữ liệu cập nhật")
    result = db.users.update_one({"username": username}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return {"message": "Cập nhật thành công"}


@router.post("/{username}/reset-password")
def reset_password(username: str, body: ResetPasswordRequest, current_user: dict = Depends(require_manager)):
    db = get_db()
    # HR Leader không được reset mật khẩu Admin
    _block_if_target_is_admin(username, db, current_user["role"])
    result = db.users.update_one(
        {"username": username},
        {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": True}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    db.activities.insert_one({
        "type":       "password_reset",
        "text":       f"'{current_user['username']}' reset mật khẩu cho tài khoản '{username}'",
        "actor":      current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": f"Đã reset mật khẩu cho '{username}'"}


@router.post("/{username}/toggle-active")
def toggle_active(username: str, current_user: dict = Depends(require_manager)):
    db = get_db()
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Không thể tự vô hiệu hóa tài khoản của mình")
    _block_if_target_is_admin(username, db, current_user["role"])
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    new_state = not user.get("is_active", True)
    db.users.update_one({"username": username}, {"$set": {"is_active": new_state}})
    status_text = "kích hoạt" if new_state else "vô hiệu hóa"
    db.activities.insert_one({
        "type":       "user_toggle",
        "text":       f"'{current_user['username']}' {status_text} tài khoản '{username}'",
        "actor":      current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": f"Tài khoản đã được {status_text}", "is_active": new_state}


@router.delete("/{username}")
def delete_user(username: str, current_user: dict = Depends(require_manager)):
    db = get_db()
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Không thể xóa tài khoản của mình")
    _block_if_target_is_admin(username, db, current_user["role"])
    result = db.users.delete_one({"username": username})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return {"message": "Đã xóa tài khoản"}


@router.post("/heartbeat")
def heartbeat(current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.users.update_one({"username": current_user["username"]}, {"$set": {"last_seen": datetime.utcnow()}})
    return {"ok": True}


@router.get("/online")
def list_online(current_user: dict = Depends(require_manager)):
    db = get_db()
    cutoff = datetime.utcnow() - timedelta(minutes=2)
    online = list(db.users.find(
        {"role": {"$in": ["hr", "hr_leader"]}, "last_seen": {"$gte": cutoff}},
        {"username": 1, "last_seen": 1},
    ))
    for u in online:
        u["_id"] = str(u["_id"])
    return {"online_usernames": [u["username"] for u in online]}
