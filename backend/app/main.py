import shutil

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import upload, jobs, download, concepts, shorts, assets

app = FastAPI(title="AI Video Editor", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(jobs.router)
app.include_router(concepts.router)
app.include_router(shorts.router)
app.include_router(download.router)
app.include_router(assets.router)


@app.get("/health")
async def health():
    ffmpeg_available = shutil.which("ffmpeg") is not None
    ffprobe_available = shutil.which("ffprobe") is not None
    return {
        "status": "healthy" if ffmpeg_available else "degraded",
        "ffmpeg": ffmpeg_available,
        "ffprobe": ffprobe_available,
    }
