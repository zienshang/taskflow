from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import os

_DEFAULT_SECRET = "taskflow-insecure-default-key-CHANGE-IN-PRODUCTION"


class Settings(BaseSettings):
    # Tự động đọc file .env ở thư mục chạy uvicorn
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",          # bỏ qua key lạ trong .env
    )

    # ── Database ──────────────────────────────────────
    MONGODB_URL: str = "mongodb://localhost:27017"
    DB_NAME:     str = "taskflow"

    # ── Auth ──────────────────────────────────────────
    # Tạo key mạnh: python -c "import secrets; print(secrets.token_hex(32))"
    SECRET_KEY:                  str = _DEFAULT_SECRET
    ALGORITHM:                   str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480   # 8 giờ

    # ── CORS ──────────────────────────────────────────
    # Production: ALLOWED_ORIGINS=https://your-domain.com
    # Nhiều domain: ALLOWED_ORIGINS=https://a.com,https://b.com
    ALLOWED_ORIGINS: str = "*"

    # ── Upload limits ─────────────────────────────────
    UPLOAD_MAX_MB: int = 10   # file đính kèm task / CV
    IMAGE_MAX_MB:  int = 5    # ảnh CK, avatar, QR

    # ── Computed ──────────────────────────────────────
    @property
    def UPLOAD_MAX_BYTES(self) -> int:
        return self.UPLOAD_MAX_MB * 1024 * 1024

    @property
    def IMAGE_MAX_BYTES(self) -> int:
        return self.IMAGE_MAX_MB * 1024 * 1024

    def allowed_origins_list(self) -> List[str]:
        if self.ALLOWED_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    def is_using_default_secret(self) -> bool:
        return self.SECRET_KEY == _DEFAULT_SECRET


settings = Settings()
