# TaskFlow — Hệ thống quản lý công việc nội bộ

## Tính năng

- **Đăng nhập / Phân quyền**: Admin và HR có màn hình riêng
- **Admin tạo tài khoản**: Tạo, bật/tắt, reset mật khẩu cho nhân viên HR
- **Giao task**: Admin giao task tuyển dụng cho từng HR, đặt mục tiêu CV và deadline
- **HR nhận task & nộp CV**: HR xem task được giao, nộp CV ứng viên kèm đánh giá
- **Dashboard realtime**: Admin theo dõi tiến độ từng HR, số CV nhận được
- **Log hoạt động**: Lịch sử đầy đủ mọi thao tác

## Cài đặt

### Cách 1: Chạy trực tiếp (cần MongoDB local)

```bash
# 1. Cài MongoDB: https://www.mongodb.com/try/download/community
# 2. Cài Python dependencies
pip3 install -r requirements.txt

# 3. Chạy server (từ thư mục cha chứa folder taskflow)
uvicorn taskflow.main:app --host 0.0.0.0 --port 8000 --reload

# Mở trình duyệt: http://localhost:8000
```

### Cách 2: Docker Compose (khuyên dùng)

```bash
docker-compose up -d
# Mở trình duyệt: http://localhost:8000
```

## Tài khoản mặc định

| Tài khoản | Mật khẩu  | Vai trò |
|-----------|-----------|---------|
| admin     | Admin@123 | Admin   |

> **Lưu ý**: Đổi mật khẩu admin sau khi cài đặt!

## Cấu trúc dự án

```
taskflow/
├── main.py              # Entry point FastAPI
├── core/
│   ├── config.py        # Cấu hình (MongoDB URL, JWT secret...)
│   ├── database.py      # Kết nối MongoDB
│   └── auth.py          # JWT authentication, password hashing
├── models/
│   └── schemas.py       # Pydantic models
├── routers/
│   ├── auth.py          # /api/auth/login, /api/auth/me
│   ├── users.py         # /api/users/ (CRUD tài khoản)
│   ├── tasks.py         # /api/tasks/ (CRUD task)
│   ├── cvs.py           # /api/cvs/ (nộp/xem CV)
│   └── activities.py    # /api/activities/ (log)
├── static/
│   └── index.html       # Frontend SPA
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

## API Endpoints

### Auth
- `POST /api/auth/login` — Đăng nhập
- `GET  /api/auth/me` — Thông tin tài khoản hiện tại
- `POST /api/auth/change-password` — Đổi mật khẩu

### Users (Admin only)
- `GET    /api/users/` — Danh sách tài khoản
- `POST   /api/users/` — Tạo tài khoản mới
- `PUT    /api/users/{username}` — Cập nhật thông tin
- `POST   /api/users/{username}/reset-password` — Reset mật khẩu
- `POST   /api/users/{username}/toggle-active` — Bật/tắt tài khoản
- `DELETE /api/users/{username}` — Xóa tài khoản

### Tasks
- `GET    /api/tasks/` — Danh sách task (HR thấy task của mình)
- `POST   /api/tasks/` — Tạo task mới (Admin only)
- `PUT    /api/tasks/{id}` — Cập nhật task (Admin only)
- `DELETE /api/tasks/{id}` — Xóa task (Admin only)
- `GET    /api/tasks/stats/overview` — Thống kê tổng quan

### CVs
- `GET    /api/cvs/` — Danh sách CV
- `POST   /api/cvs/` — Nộp CV mới
- `DELETE /api/cvs/{id}` — Xóa CV

## Biến môi trường

```env
MONGODB_URL=mongodb://localhost:27017
SECRET_KEY=your-super-secret-key
```

## Bảo mật

- Mật khẩu được mã hóa bằng **bcrypt**
- Xác thực bằng **JWT token** (hết hạn sau 8 giờ)
- Phân quyền rõ ràng: Admin vs HR
- HR chỉ thấy task và CV của mình
- Tài khoản có thể bị tắt bởi Admin
