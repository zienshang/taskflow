<div align="center">
  <h1>🚀 TaskFlow</h1>
  <p><b>Hệ thống quản lý công việc tuyển dụng nội bộ</b></p>
  <p>
    <img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white" alt="Python">
    <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white" alt="FastAPI">
    <img src="https://img.shields.io/badge/MongoDB-7.x-47A248?logo=mongodb&logoColor=white" alt="MongoDB">
    <img src="https://img.shields.io/badge/JWT-Auth-000000?logo=jsonwebtokens&logoColor=white" alt="JWT">
    <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker">
  </p>
  <p>
    <i>Admin giao task · HR nộp CV · Theo dõi hoa hồng · Hỗ trợ qua ticket</i>
  </p>
</div>

---

## 📸 Dashboard

<p align="center">
  <img src="screenshots/dashboard.png" alt="Dashboard" width="850">
</p>

---

## ✨ Tính năng nổi bật

| | |
|---|---|
| 🔐 **Phân quyền** | Admin / HR Leader / HR |
| 📋 **Giao task** | Rich text editor, file đính kèm, hoa hồng, deadline |
| 📄 **Nộp CV** | PDF/DOCX, đánh giá ứng viên |
| 💰 **Thanh toán** | Yêu cầu → phê duyệt → xác nhận (kèm ảnh chuyển khoản) |
| 🎫 **Ticket** | Hỗ trợ nội bộ với comment thread |
| 📊 **Dashboard** | Theo dõi HR realtime, thống kê |
| 📝 **Audit log** | Mọi thao tác đều được ghi lại |

---

## 🚦 Quick Start

```bash
docker compose -f taskflow/docker-compose.yml up -d
```

Mở **http://localhost:8000** — tài khoản **admin** được tạo tự động khi chạy lần đầu.

---

## 🛠 Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| 🔙 Backend | Python 3.12+, **FastAPI** |
| 🗄 Database | **MongoDB** 7.x |
| 🎨 Frontend | Vanilla JS SPA (zero framework) |
| 🔑 Auth | JWT + bcrypt |
| 🐳 Deploy | Docker Compose |

---

## 🖼 Screenshots

<div align="center">

| Dashboard | Login |
|:---:|:---:|
| ![Dashboard](screenshots/dashboard.png) | ![Login](screenshots/login.png) |
| **Drop Task** | **Ticket** |
| ![Drop Task](screenshots/droptask.png) | ![Ticket](screenshots/ticket.png) |

</div>

---

## 📁 Cấu trúc

```
.
├── build.js               # Build & obfuscation (Node.js)
├── screenshots/           # Hình ảnh dự án
└── taskflow/
    ├── main.py            # FastAPI entry point
    ├── core/              # Auth, config, database, rate limiter
    ├── models/            # Pydantic schemas
    ├── routers/           # 8 API modules
    ├── static/            # Frontend SPA (HTML + CSS + 13 JS)
    ├── Dockerfile
    └── docker-compose.yml
```

---

<div align="center">
  <sub>Built with ❤️ by the TaskFlow team</sub>
</div>
