from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    admin     = "admin"
    hr        = "hr"
    hr_leader = "hr_leader"

class TicketCategory(str, Enum):
    technical    = "technical"     # Hỗ trợ kỹ thuật
    issue        = "issue"         # Báo cáo vấn đề
    info_request = "info_request"  # Yêu cầu thông tin
    feedback     = "feedback"      # Phản hồi / Góp ý

class TicketPriority(str, Enum):
    low    = "low"
    normal = "normal"
    high   = "high"
    urgent = "urgent"

class TicketStatus(str, Enum):
    open        = "open"
    in_progress = "in_progress"
    resolved    = "resolved"
    closed      = "closed"

class TaskStatus(str, Enum):
    active = "active"
    completed = "completed"
    cancelled = "cancelled"

class CVRating(str, Enum):
    potential = "potential"
    good = "good"
    average = "average"
    no = "no"

# ── Auth ──────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=6, max_length=128)

class UpdateProfileRequest(BaseModel):
    avatar_url: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_holder: Optional[str] = None
    bank_qr: Optional[str] = None

# ── Users ─────────────────────────────────────────────
class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    full_name: str = Field(..., min_length=2)
    password: str = Field(..., min_length=6)
    role: UserRole = UserRole.hr
    department: Optional[str] = "HR"
    email: Optional[str] = None

class UpdateUserRequest(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None

class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6)

# ── Tasks ─────────────────────────────────────────────
class CreateTaskRequest(BaseModel):
    title: str = Field(..., min_length=3)
    description: Optional[str] = ""
    assigned_to: str               # username of HR
    cv_target: int = Field(default=1, ge=1)
    deadline: str                  # ISO date string YYYY-MM-DD
    priority: Optional[str] = "normal"  # low | normal | high
    commission: Optional[str] = None

class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cv_target: Optional[int] = None
    deadline: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[TaskStatus] = None

# ── Payments ──────────────────────────────────────────
class RequestCompletionBody(BaseModel):
    task_id: str
    note: Optional[str] = ""

class ApprovePaymentBody(BaseModel):
    amount: str = Field(..., min_length=1)
    bank_name: str = Field(..., min_length=1)
    bank_account: str = Field(..., min_length=1)
    bank_holder: str = Field(..., min_length=1)
    transfer_content: Optional[str] = ""
    admin_note: Optional[str] = ""

class RejectPaymentBody(BaseModel):
    reason: str = Field(..., min_length=1)

# ── CVs ───────────────────────────────────────────────
class SubmitCVRequest(BaseModel):
    task_id: str
    candidate_name: str = Field(..., min_length=2)
    position: str
    rating: CVRating = CVRating.potential
    note: Optional[str] = ""
    contact: Optional[str] = ""
