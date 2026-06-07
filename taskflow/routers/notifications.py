from fastapi import APIRouter, Depends
from ..core.database import get_db
from ..core.auth import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

@router.get("/")
def get_notifications(current_user: dict = Depends(get_current_user)):
    db = get_db()
    items = list(db.notifications.find(
        {"recipient": current_user["username"]}
    ).sort("created_at", -1).limit(30))
    for n in items:
        n["_id"] = str(n["_id"])
        if n.get("created_at"):
            n["created_at"] = n["created_at"].isoformat()
    return items

@router.post("/read-all")
def read_all(current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.notifications.update_many(
        {"recipient": current_user["username"], "read": False},
        {"$set": {"read": True}}
    )
    return {"message": "ok"}
