from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    storage_dir: str = "storage"
    max_upload_size_gb: float = 50.0   # maximum allowed upload size in gigabytes
    allowed_extensions: str = ".mp4,.mov,.avi,.mkv,.webm,.m4v"
    clip_duration: int = 30
    num_clips: int = 3
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    num_shorts: int = 5
    num_thumbnail_concepts: int = 2
    auth_username: str = "admin"
    auth_password: str = "changeme"
    jwt_secret: str = "please-change-this-secret-before-deploying"
    jwt_expire_hours: int = 168  # 7 days

    class Config:
        env_file = ".env"

    @property
    def storage_path(self) -> Path:
        return Path(__file__).parent.parent / self.storage_dir

    @property
    def uploads_path(self) -> Path:
        return self.storage_path / "uploads"

    @property
    def assets_path(self) -> Path:
        return self.storage_path / "assets"

    @property
    def jobs_path(self) -> Path:
        return self.storage_path / "jobs"

    @property
    def intro_path(self) -> Path:
        return self.assets_path / "intro.mp4"

    @property
    def outro_path(self) -> Path:
        return self.assets_path / "outro.mp4"

    @property
    def host_photo_path(self) -> Path:
        return self.assets_path / "host_photo.jpg"

    @property
    def host_png_path(self) -> Path:
        return self.assets_path / "host.png"

    @property
    def bg_template_path(self) -> Path:
        return self.assets_path / "bg_template.png"

    @property
    def logo_path(self) -> Path:
        return self.assets_path / "logo.png"

    @property
    def max_upload_size_bytes(self) -> int:
        return int(self.max_upload_size_gb * 1024 ** 3)

    @property
    def allowed_ext_list(self) -> list[str]:
        return [ext.strip() for ext in self.allowed_extensions.split(",")]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
