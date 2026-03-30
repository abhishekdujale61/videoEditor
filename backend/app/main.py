import shutil

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.dependencies import require_auth
from app.routers import assets, concepts, download, jobs, shorts, upload
from app.routers import auth

app = FastAPI(title="AI Video Editor", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes — no auth required
app.include_router(auth.router)

# Protected routes — JWT required on every endpoint
_auth = [Depends(require_auth)]
app.include_router(upload.router, dependencies=_auth)
app.include_router(jobs.router, dependencies=_auth)
app.include_router(concepts.router, dependencies=_auth)
app.include_router(shorts.router, dependencies=_auth)
app.include_router(download.router, dependencies=_auth)
app.include_router(assets.router, dependencies=_auth)


@app.get("/health")
async def health():
    ffmpeg_available = shutil.which("ffmpeg") is not None
    ffprobe_available = shutil.which("ffprobe") is not None
    return {
        "status": "healthy" if ffmpeg_available else "degraded",
        "ffmpeg": ffmpeg_available,
        "ffprobe": ffprobe_available,
    }
