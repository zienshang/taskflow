# TaskFlow — Hệ thống quản lý công việc nội bộ

Hệ thống quản lý và giao việc tuyển dụng nội bộ dành cho doanh nghiệp. Cho phép Admin giao task tuyển dụng cho HR, theo dõi tiến độ nộp CV, quản lý hoa hồng/thanh toán và hỗ trợ nội bộ qua ticket.

## Kiến trúc tổng quan

```
┌────────────────────────────────────────────────────┐
│                    Browser                         │
│   (Vanilla JS SPA — inline HTML + CSS + JS)       │
│   ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│   │ protect  │ │  bundle  │ │   style.css      │  │
│   │ .js      │ │  .js     │ │                  │  │
│   └──────────┘ └──────────┘ └──────────────────┘  │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP / JSON + FormData
                       ▼
┌────────────────────────────────────────────────────┐
│               FastAPI (Python 3.12+)                │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ Routers  │ │  Core    │ │   Middleware        │  │
│  │ (8 APIs) │ │ (Auth,   │ │  (CORS, Security,  │  │
│  │          │ │  Config, │ │   Rate Limiter)     │  │
│  │          │ │  DB,     │ │                     │  │
│  │          │ │  RateLmt)│ │                     │  │
│  └──────────┘ └──────────┘ └────────────────────┘  │
└──────────────────────┬─────────────────────────────┘
                       │ PyMongo
                       ▼
┌────────────────────────────────────────────────────┐
│              MongoDB (7.x)                         │
│  Collections: users, tasks, cvs, payments,        │
│  activities, notifications, tickets,               │
│  ticket_comments                                   │
└────────────────────────────────────────────────────┘
```

### Backend (Python/FastAPI)

| Module | Vai trò |
|--------|---------|
| `main.py` | Entry point: lifespan management, middleware, static file serving |
| `core/config.py` | Cấu hình từ `.env` (MongoDB, JWT, CORS, upload limits) |
| `core/database.py` | MongoDB connection pool + index initialization |
| `core/auth.py` | JWT token creation/verification, bcrypt, role-based guards |
| `core/rate_limit.py` | SQLite-backed sliding-window rate limiter (persistent, multi-worker safe) |
| `models/schemas.py` | Pydantic models cho request/response validation |
| `routers/auth.py` | Đăng nhập, profile, avatar/QR upload, đổi mật khẩu |
| `routers/users.py` | CRUD tài khoản, reset mật khẩu, heartbeat, online status |
| `routers/tasks.py` | CRUD task, nhận task, cập nhật trạng thái ứng viên, thống kê |
| `routers/cvs.py` | Nộp/xem/xóa CV, cập nhật trạng thái CV, download file |
| `routers/payments.py` | Yêu cầu, phê duyệt, từ chối, xác nhận thanh toán hoa hồng |
| `routers/activities.py` | Audit log với pagination, orphan cleanup |
| `routers/notifications.py` | Thông báo realtime (polling) |
| `routers/tickets.py` | Hệ thống ticket hỗ trợ nội bộ (CRUD + comment thread) |

### Frontend (Vanilla JS SPA)

Không sử dụng framework — HTML render bằng template literals thuần JS.

| File | Vai trò |
|------|---------|
| `index.html` | Shell SPA: login page, app layout, modals (15+ modals) |
| `style.css` | Design system: CSS variables, responsive, badges, cards, tables |
| `js/api.js` | API client (`fetch` wrapper), secure image loader, toast, modal base |
| `js/utils.js` | Date/time formatting, XSS escaping (`esc()`), currency input |
| `js/auth.js` | Login/logout, change password |
| `js/app.js` | App shell: navigation, heartbeat, notifications, view routing |
| `js/dashboard.js` | Admin dashboard: stats, task table, HR sidebar, activity feed |
| `js/tasks.js` | Task detail, create/accept/delete task, candidate status, CV picker |
| `js/users.js` | User management table, create/reset/toggle user |
| `js/cvs.js` | CV submission, admin CV table, HR CV list |
| `js/payments.js` | Payment request, approve (with transfer image), reject, confirm |
| `js/history.js` | Payment history, audit log with pagination |
| `js/settings.js` | Profile settings, bank info picker (VietQR integration) |
| `js/tickets.js` | Ticket CRUD, comment thread, status/priority management |
| `js/protect.js` | Anti-tamper: block DevTools, disable console, debugger trap |

## Tính năng chi tiết

### 1. Phân quyền (3 roles)

| Role | Quyền hạn |
|------|-----------|
| **Admin** | Toàn quyền: tạo/sửa/xóa tài khoản, giao task, phê duyệt thanh toán, quản lý ticket |
| **HR Leader** | Gần như Admin nhưng không được thao tác lên tài khoản Admin |
| **HR** | Nhận task, nộp CV, yêu cầu thanh toán, tạo ticket |

### 2. Quản lý Task

- Admin giao task cho HR kèm: mã task, mô tả (rich text editor), file đính kèm, hoa hồng, deadline
- HR nhận task → xem nội dung + tải file
- Luồng trạng thái ứng viên: `pending → contacted → trial → completed`
- Khi ở trạng thái `trial`, hệ thống tự động đếm ngược 60 ngày
- Hết thời gian thử việc → Admin xác nhận ký hợp đồng

### 3. Nộp CV

- HR nộp CV ứng viên cho từng task (có thể đính kèm file PDF/DOCX)
- Admin đánh giá CV: potential / good / average / no
- Chặn nộp CV nếu còn task đang chờ xác nhận thanh toán

### 4. Hoa hồng & Thanh toán

- HR yêu cầu thanh toán sau khi ứng viên ký hợp đồng
- Admin nhập thông tin chuyển khoản + ảnh CK → đánh dấu `paid`
- HR xác nhận đã nhận tiền (kèm ảnh xác nhận) → task hoàn tất
- Partial unique index ngăn duplicate payment requests (race condition)

### 5. Ticket hỗ trợ

- HR tạo ticket (phân loại: kỹ thuật, báo cáo, yêu cầu, phản hồi)
- Manager xử lý: thay đổi trạng thái, ưu tiên, hạn xử lý
- Comment thread với internal notes (chỉ manager thấy)
- Auto-notification qua polling

### 6. Bảo mật

- **XSS prevention**: HTML sanitization bằng `nh3` (server-side) + `esc()` (client-side)
- **Auth**: JWT token (Bearer), bcrypt password hashing
- **Rate limiting**: SQLite-backed sliding-window (persistent qua restart)
- **Security headers**: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Frontend protection**: Block F12/Ctrl+Shift+I, disable console, debugger trap, DevTools detection
- **Path traversal protection**: Chuẩn hóa và kiểm tra đường dẫn file upload
- **CORS**: Giới hạn origins theo cấu hình

### 7. Hiệu năng

- MongoDB indexes trên tất cả query patterns
- Batch aggregation thay vì N+1 queries
- Atomic `find_one_and_update` cho race-condition-sensitive operations
- Connection pooling (PyMongo)

## Cài đặt & Chạy

### Yêu cầu

- Python 3.12+
- MongoDB 7.x (local hoặc Docker)
- Node.js 18+ (cho build obfuscation — optional)

### Cách 1: Docker Compose (khuyên dùng)

```bash
# Clone & cd vào thư mục dự án (thư mục chứa taskflow/)
docker compose -f taskflow/docker-compose.yml up -d
# Mở http://localhost:8000
```

### Cách 2: Chạy thủ công

```bash
# 1. Cài dependencies
pip install -r taskflow/requirements.txt

# 2. Copy cấu hình
cp .env.example .env
# Sửa .env nếu cần (MONGODB_URL, SECRET_KEY, v.v.)

# 3. Chạy MongoDB (mở terminal riêng)
#    Nếu có Docker: docker run -d -p 27017:27017 mongo:7

# 4. Chạy server
uvicorn taskflow.main:app --host 0.0.0.0 --port 8000 --reload

# 5. Mở http://localhost:8000
```

### Build production frontend (optional)

```bash
npm install
npm run build
# Output: taskflow/static_prod/ (obfuscated, minified, bundled)
# Server tự động dùng bản build nếu có
```

## Tài khoản mặc định

| Tài khoản | Vai trò | Ghi chú |
|-----------|---------|---------|
| `admin` | Admin | Mật khẩu ngẫu nhiên được in ra console khi server khởi động lần đầu |

> **Quan trọng**: Đổi `SECRET_KEY` trong `.env` trước khi deploy production!

## API Endpoints

### Auth
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/auth/login` | Đăng nhập |
| GET | `/api/auth/me` | Thông tin user hiện tại |
| PUT | `/api/auth/profile` | Cập nhật profile |
| PUT | `/api/auth/avatar` | Upload avatar |
| PUT | `/api/auth/bank-qr` | Upload QR ngân hàng |
| POST | `/api/auth/change-password` | Đổi mật khẩu |

### Users (Admin/HR Leader)
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/users/` | Danh sách tài khoản |
| POST | `/api/users/` | Tạo tài khoản |
| PUT | `/api/users/{username}` | Cập nhật thông tin |
| POST | `/api/users/{username}/reset-password` | Reset mật khẩu |
| POST | `/api/users/{username}/toggle-active` | Bật/tắt tài khoản |
| DELETE | `/api/users/{username}` | Xóa tài khoản |
| POST | `/api/users/heartbeat` | Heartbeat (online status) |
| GET | `/api/users/online` | Danh sách HR online |

### Tasks
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/tasks/` | Danh sách task |
| POST | `/api/tasks/` | Tạo task (Admin/Leader) |
| PUT | `/api/tasks/{id}` | Cập nhật task |
| DELETE | `/api/tasks/{id}` | Xóa task (cascade CV, payments, activities) |
| POST | `/api/tasks/{id}/accept` | Nhận task |
| PUT | `/api/tasks/{id}/candidate-status` | Cập nhật trạng thái ứng viên |
| POST | `/api/tasks/{id}/confirm-trial` | Xác nhận ký hợp đồng |
| GET | `/api/tasks/{id}/file` | Download file đính kèm |
| GET | `/api/tasks/stats/overview` | Thống kê dashboard |

### CVs
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/cvs/` | Danh sách CV |
| POST | `/api/cvs/` | Nộp CV mới |
| GET | `/api/cvs/{id}/file` | Download file CV |
| PUT | `/api/cvs/{id}/status` | Cập nhật trạng thái CV |
| DELETE | `/api/cvs/{id}` | Xóa CV |

### Payments
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/payments/` | Danh sách payments |
| POST | `/api/payments/request` | HR yêu cầu thanh toán |
| POST | `/api/payments/{id}/approve` | Admin phê duyệt |
| POST | `/api/payments/{id}/reject` | Admin từ chối |
| POST | `/api/payments/{id}/confirm` | HR xác nhận nhận tiền |

### Tickets
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/tickets/` | Danh sách ticket (có filter) |
| GET | `/api/tickets/stats` | Thống kê ticket |
| POST | `/api/tickets/` | Tạo ticket |
| GET | `/api/tickets/{id}` | Chi tiết ticket + comments |
| PUT | `/api/tickets/{id}` | Cập nhật ticket |
| DELETE | `/api/tickets/{id}` | Xóa ticket (Admin) |
| POST | `/api/tickets/{id}/status` | Đổi trạng thái |
| POST | `/api/tickets/{id}/comments` | Thêm comment |
| GET | `/api/tickets/{id}/file` | Download file đính kèm |

### Activities
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/activities/` | Audit log (phân trang) |
| DELETE | `/api/activities/purge-orphans` | Dọn orphan activities |

### Notifications
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/notifications/` | Danh sách thông báo |
| POST | `/api/notifications/read-all` | Đánh dấu đã đọc |

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `MONGODB_URL` | `mongodb://localhost:27017` | URL kết nối MongoDB |
| `DB_NAME` | `taskflow` | Tên database |
| `SECRET_KEY` | *(default)* | Secret key cho JWT — **bắt buộc đổi khi deploy** |
| `ALGORITHM` | `HS256` | Thuật toán JWT |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | Thời gian hết hạn token (phút) |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins |
| `UPLOAD_MAX_MB` | `10` | Dung lượng tối đa file task/CV (MB) |
| `IMAGE_MAX_MB` | `5` | Dung lượng tối đa ảnh CK/avatar/QR (MB) |

## Cấu trúc thư mục

```
📦 taskflow/
├── main.py                   # FastAPI entry point
├── Dockerfile                # Docker image
├── docker-compose.yml        # Docker Compose (app + MongoDB)
├── requirements.txt           # Python dependencies
├── README.md                 # Bạn đang đọc đây
├── .env.example               # Template cấu hình
├── .gitignore
├── build.js                   # Build tool (obfuscate + minify)
├── package.json               # Node.js devDependencies
├── core/
│   ├── __init__.py
│   ├── config.py              # Settings từ .env
│   ├── database.py            # MongoDB connection + indexes
│   ├── auth.py                # JWT + bcrypt
│   └── rate_limit.py          # SQLite rate limiter
├── models/
│   ├── __init__.py
│   └── schemas.py             # Pydantic models
├── routers/
│   ├── __init__.py
│   ├── auth.py                # 8 endpoints
│   ├── users.py               # 8 endpoints
│   ├── tasks.py               # 10+ endpoints
│   ├── cvs.py                 # 5 endpoints
│   ├── payments.py            # 5 endpoints
│   ├── activities.py          # 2 endpoints
│   ├── tickets.py             # 10+ endpoints
│   └── notifications.py       # 2 endpoints
├── static/
│   ├── index.html             # SPA — single HTML file
│   ├── style.css              # Design system (~200 lines)
│   ├── favicon.svg
│   └── js/
│       ├── protect.js         # Anti-tamper (load đầu tiên)
│       ├── api.js             # API client + helpers
│       ├── utils.js           # Date, XSS escaping, currency
│       ├── auth.js            # Login/logout
│       ├── app.js             # App shell, navigation
│       ├── dashboard.js       # Admin dashboard
│       ├── tasks.js           # Task management
│       ├── users.js           # User management
│       ├── cvs.js             # CV management
│       ├── payments.js        # Payment flow
│       ├── history.js         # Payment history + logs
│       ├── settings.js        # Profile settings + bank picker
│       └── tickets.js         # Ticket system
├── static_prod/               # Build output (obfuscated)
└── uploads/
    ├── avatars/
    ├── cvs/
    ├── transfers/
    ├── confirmations/
    └── tickets/
```

## Security Considerations

1. **Không dùng cookie**: App dùng `Authorization: Bearer <jwt>` qua header → miễn nhiễm CSRF
2. **Stored XSS**: Mọi HTML input được sanitize bằng `nh3` trước khi lưu
3. **Rate limiting**: 10 lần login/IP/60s + 5 lần fail/username/300s → chống brute-force
4. **File upload**: Validate extension + kích thước + path traversal protection
5. **Cascade delete**: Xóa task → xóa toàn bộ CV, payments, activities liên quan
6. **Admin seeding**: Mật khẩu admin được tạo ngẫu nhiên khi server chạy lần đầu
7. **Partial unique index**: Ngăn duplicate payment request ở DB level (race condition)
