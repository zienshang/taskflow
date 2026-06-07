from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from datetime import datetime, timedelta
import os
import shutil

from ..core.database import get_db
from ..core.auth import verify_password, create_access_token, hash_password, get_current_user
from ..core.config import settings
from ..core.rate_limit import limiter
from ..models.schemas import LoginRequest, ChangePasswordRequest, UpdateProfileRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Login ─────────────────────────────────────────────
@router.post("/login")
def login(body: LoginRequest, request: Request):
    # Rate limit: 10 lần / 60 giây mỗi IP (chặn brute-force)
    client_ip = request.client.host if request.client else "unknown"
    limiter.check(f"login:{client_ip}", max_hits=10, window_seconds=60)

    db = get_db()
    user = db.users.find_one({"username": body.username})

    if not user or not verify_password(body.password, user["password_hash"]):
        # Thêm rate limit per-username để ngăn brute-force vào 1 tài khoản
        limiter.check(f"login_fail:{body.username}", max_hits=5, window_seconds=300)
        raise HTTPException(status_code=401, detail="Tên đăng nhập hoặc mật khẩu không đúng")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Tài khoản đã bị vô hiệu hóa. Liên hệ Admin.")

    db.users.update_one({"username": user["username"]}, {"$set": {"last_seen": datetime.utcnow()}})

    token = create_access_token(
        {"sub": user["username"], "role": user["role"]},
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "username":            user["username"],
            "full_name":           user["full_name"],
            "role":                user["role"],
            "department":          user.get("department", ""),
            "email":               user.get("email", ""),
            "must_change_password":user.get("must_change_password", False),
            "avatar_url":          user.get("avatar_url", ""),
            "bank_name":           user.get("bank_name", ""),
            "bank_account":        user.get("bank_account", ""),
            "bank_holder":         user.get("bank_holder", ""),
            "bank_qr":             user.get("bank_qr", ""),
        },
    }


# ── Me ────────────────────────────────────────────────
@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return {k: v for k, v in current_user.items() if k != "password_hash"}


# ── Profile ───────────────────────────────────────────
@router.put("/profile")
def update_profile(body: UpdateProfileRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Không có dữ liệu cập nhật")
    db.users.update_one({"username": current_user["username"]}, {"$set": update})
    _field_labels = {
        "bank_name":    "ngân hàng",
        "bank_account": "số TK",
        "bank_holder":  "chủ TK",
        "bank_qr":      "mã QR",
        "avatar_url":   "ảnh đại diện",
    }
    changed = ", ".join(_field_labels.get(k, k) for k in update)
    db.activities.insert_one({
        "type":       "profile_updated",
        "text":       f"'{current_user['username']}' ({current_user['full_name']}) cập nhật {changed}",
        "actor":      current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": "Cập nhật thông tin thành công"}


# ── File upload helpers ───────────────────────────────
BASE_DIR           = os.path.dirname(os.path.dirname(__file__))
AVATAR_DIR         = os.path.join(BASE_DIR, "uploads", "avatars")
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
_IMAGE_MAX_BYTES   = 2 * 1024 * 1024   # 2 MB hardcoded cho avatar / QR


def _save_image(upload: UploadFile, prefix: str) -> str:
    """Validate, lưu ảnh vào AVATAR_DIR, trả về URL path."""
    ext = os.path.splitext(upload.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ JPG, JPEG, PNG, WEBP")

    os.makedirs(AVATAR_DIR, exist_ok=True)
    safe_name = f"{prefix}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{ext}"
    dest = os.path.join(AVATAR_DIR, safe_name)

    # Đọc giới hạn để kiểm tra kích thước trước khi lưu
    data = upload.file.read(_IMAGE_MAX_BYTES + 1)
    if len(data) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Ảnh tối đa 2MB")

    with open(dest, "wb") as f:
        f.write(data)

    return f"/uploads/avatars/{safe_name}"


# ── Avatar upload ─────────────────────────────────────
@router.put("/avatar")
def upload_avatar(
    request: Request,
    avatar: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    # Rate limit: tránh spam upload
    limiter.check(f"upload:{current_user['username']}", max_hits=10, window_seconds=60)
    db = get_db()
    avatar_url = _save_image(avatar, current_user["username"])
    db.users.update_one({"username": current_user["username"]}, {"$set": {"avatar_url": avatar_url}})
    return {"message": "Cập nhật ảnh đại diện thành công", "avatar_url": avatar_url}


# ── Bank QR upload ────────────────────────────────────
@router.put("/bank-qr")
def upload_bank_qr(
    request: Request,
    qr: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    limiter.check(f"upload:{current_user['username']}", max_hits=10, window_seconds=60)
    db = get_db()
    bank_qr = _save_image(qr, f"qr_{current_user['username']}")
    db.users.update_one({"username": current_user["username"]}, {"$set": {"bank_qr": bank_qr}})
    return {"message": "Cập nhật mã QR thành công", "bank_qr": bank_qr}


# ── Change password ───────────────────────────────────
@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    # Rate limit: tránh brute-force đổi mật khẩu
    limiter.check(f"changepw:{current_user['username']}", max_hits=5, window_seconds=300)

    db = get_db()
    user = db.users.find_one({"username": current_user["username"]})
    if not verify_password(body.old_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Mật khẩu cũ không đúng")

    db.users.update_one(
        {"username": current_user["username"]},
        {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": False}},
    )
    db.activities.insert_one({
        "type":       "password_changed",
        "text":       f"'{current_user['username']}' ({current_user['full_name']}) đã đổi mật khẩu",
        "actor":      current_user["username"],
        "created_at": datetime.utcnow(),
    })
    return {"message": "Đổi mật khẩu thành công"}
