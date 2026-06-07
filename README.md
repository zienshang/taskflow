# TaskFlow

Hệ thống quản lý công việc tuyển dụng nội bộ.  
Admin giao task, HR nộp CV, theo dõi hoa hồng & hỗ trợ qua ticket.

| Stack | |
|-------|-|
| Backend | Python 3.12+, **FastAPI** |
| Database | **MongoDB** 7.x |
| Frontend | Vanilla JS SPA (zero framework) |
| Auth | JWT + bcrypt |
| Deploy | Docker Compose |

## Quick Start

```bash
# Docker
docker compose -f taskflow/docker-compose.yml up -d

# Manual
pip install -r taskflow/requirements.txt
uvicorn taskflow.main:app --host 0.0.0.0 --port 8000 --reload
```

Mở `http://localhost:8000` — tài khoản **admin** được tạo tự động khi chạy lần đầu (kiểm tra terminal để lấy mật khẩu).

## Tính năng

- **Phân quyền**: Admin / HR Leader / HR
- **Giao task**: Rich text editor, file đính kèm, hoa hồng, deadline
- **Nộp CV**: PDF/DOCX, đánh giá ứng viên
- **Thanh toán**: Yêu cầu → phê duyệt → xác nhận (kèm ảnh CK)
- **Ticket**: Hỗ trợ nội bộ với comment thread
- **Dashboard**: Theo dõi HR realtime, thống kê
- **Audit log**: Mọi thao tác đều được ghi lại

## Bảo mật

- JWT Bearer (không cookie → miễn nhiễm CSRF)
- bcrypt + HTML sanitizer (chống XSS)
- SQLite rate limiter (chống brute-force)
- Security headers (CSP, X-Frame-Options)
- Anti-devtools frontend

## Cấu trúc

```
.
├── build.js               # Build & obfuscation (Node.js)
├── package.json
├── .env.example
└── taskflow/
    ├── main.py            # FastAPI entry point
    ├── core/              # Auth, config, database, rate limiter
    ├── models/            # Pydantic schemas
    ├── routers/           # 8 API modules
    ├── static/            # Frontend SPA (HTML + CSS + 13 JS)
    ├── Dockerfile
    └── docker-compose.yml
```
