# TaskFlow

**Hệ thống quản lý công việc tuyển dụng nội bộ.**  
Admin giao task cho HR, theo dõi CV, quản lý hoa hồng & hỗ trợ qua ticket.

---

### Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| Backend | Python 3.12+, FastAPI, PyMongo |
| Database | MongoDB 7.x |
| Frontend | Vanilla JS SPA (không framework) |
| Auth | JWT + bcrypt |
| Rate Limit | SQLite (persistent, multi-worker) |
| Deploy | Docker + Docker Compose |

### Tính năng chính

- **Phân quyền 3 roles**: Admin — HR Leader — HR
- **Giao task**: Rich text editor, file đính kèm, hoa hồng, deadline
- **Nộp CV**: Kèm file PDF/DOCX, đánh giá ứng viên
- **Thanh toán hoa hồng**: Yêu cầu → Admin chuyển tiền → HR xác nhận (kèm ảnh CK)
- **Ticket hỗ trợ**: Comment thread, internal notes, ưu tiên, hạn xử lý
- **Dashboard realtime**: Theo dõi tiến độ HR, online status
- **Audit log**: Ghi lại mọi thao tác, phân trang
- **Bảo mật**: CSP headers, XSS sanitizer, rate limiter, anti-devtools

### Cài đặt nhanh

```bash
# Docker
docker compose -f taskflow/docker-compose.yml up -d

# Hoặc chạy thủ công
pip install -r taskflow/requirements.txt
uvicorn taskflow.main:app --host 0.0.0.0 --port 8000 --reload
```

Mở `http://localhost:8000` — tài khoản admin được tạo tự động (xem console log).

### API Overview

| Module | Endpoints |
|--------|-----------|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `PUT /api/auth/profile` |
| Users | `GET/POST /api/users/`, `PUT/DELETE /api/users/{username}` |
| Tasks | `GET/POST /api/tasks/`, `PUT/DELETE /api/tasks/{id}`, `GET .../stats/overview` |
| CVs | `GET/POST /api/cvs/`, `DELETE /api/cvs/{id}`, `GET .../{id}/file` |
| Payments | `POST .../request`, `POST .../{id}/approve`, `POST .../{id}/confirm` |
| Tickets | `GET/POST /api/tickets/`, `POST .../{id}/comments`, `POST .../{id}/status` |
| Activities | `GET /api/activities/` (phân trang) |
| Notifications | `GET /api/notifications/`, `POST .../read-all` |

### Kiến trúc

```
Browser (Vanilla JS SPA) → FastAPI (8 routers + core services) → MongoDB
```

- **Frontend**: Single HTML file + CSS + 13 JS modules (no build step cho dev)
- **Backend**: Routers xử lý business logic, Core xử lý auth/config/DB, middleware cho CORS & security
- **Build production**: `npm run build` → obfuscate JS, minify CSS/HTML

### Biến môi trường

| Biến | Mặc định |
|------|----------|
| `MONGODB_URL` | `mongodb://localhost:27017` |
| `SECRET_KEY` | *(đổi ngay khi deploy)* |
| `ALLOWED_ORIGINS` | `*` |
| `UPLOAD_MAX_MB` | `10` |
| `IMAGE_MAX_MB` | `5` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` (8h) |

### Bảo mật

- ✅ JWT Bearer token — không dùng cookie → miễn nhiễm CSRF
- ✅ bcrypt password hashing
- ✅ HTML sanitizer (nh3) — chống stored XSS
- ✅ SQLite rate limiter — chống brute-force
- ✅ Security headers (CSP, X-Frame-Options, X-Content-Type-Options)
- ✅ Frontend anti-tamper (block DevTools, disable console, debugger trap)
- ✅ Path traversal protection cho file uploads
- ✅ Atomic operations + partial unique index — chống race condition
