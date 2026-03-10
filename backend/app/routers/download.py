import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from app.config import settings
from app.dependencies import job_manager

router = APIRouter()


def _resolve_asset(job_id: str, asset: str) -> Path:
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_dir = settings.jobs_path / job_id

    if asset == "main_video" and job.main_video:
        return job_dir / job.main_video
    if asset == "main_thumbnail" and job.main_thumbnail:
        return job_dir / job.main_thumbnail

    # Highlight reel
    if asset == "highlight" and job.highlight:
        return job_dir / job.highlight.clip_file

    # Shorts: short_N or short_N_thumbnail_M
    for short in job.shorts:
        if asset == f"short_{short.index}" and short.clip_file:
            return job_dir / short.clip_file
        for thumb_idx, thumb_file in enumerate(short.thumbnail_files):
            if asset == f"short_{short.index}_thumbnail_{thumb_idx}":
                return job_dir / thumb_file

    # Legacy clips
    for clip in job.clips:
        if asset == f"clip_{clip.index}":
            return job_dir / clip.clip_file
        if asset == f"clip_{clip.index}_thumbnail":
            return job_dir / clip.thumbnail_file

    # In-review preview files — images and video clips served directly by filename
    candidate = job_dir / asset
    if candidate.exists() and candidate.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".mp4"):
        return candidate

    raise HTTPException(status_code=404, detail=f"Asset '{asset}' not found")


# NOTE: /all must be registered before /{asset} to avoid route shadowing
@router.get("/api/download/{job_id}/all")
async def download_all(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_dir = settings.jobs_path / job_id
    files_to_zip: list[tuple[str, Path]] = []

    if job.main_video:
        p = job_dir / job.main_video
        if p.exists():
            files_to_zip.append((job.main_video, p))
    if job.main_thumbnail:
        p = job_dir / job.main_thumbnail
        if p.exists():
            files_to_zip.append((job.main_thumbnail, p))

    if job.highlight:
        p = job_dir / job.highlight.clip_file
        if p.exists():
            files_to_zip.append((job.highlight.clip_file, p))

    for short in job.shorts:
        if short.clip_file:
            cp = job_dir / short.clip_file
            if cp.exists():
                files_to_zip.append((short.clip_file, cp))
        for thumb_file in short.thumbnail_files:
            tp = job_dir / thumb_file
            if tp.exists():
                files_to_zip.append((thumb_file, tp))

    for clip in job.clips:
        cp = job_dir / clip.clip_file
        if cp.exists():
            files_to_zip.append((clip.clip_file, cp))
        tp = job_dir / clip.thumbnail_file
        if tp.exists():
            files_to_zip.append((clip.thumbnail_file, tp))

    if not files_to_zip:
        raise HTTPException(status_code=404, detail="No assets available")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, path in files_to_zip:
            zf.write(path, name)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{job_id}_assets.zip"'},
    )


@router.get("/api/download/{job_id}/{asset}")
async def download_asset(job_id: str, asset: str):
    path = _resolve_asset(job_id, asset)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(path, filename=path.name)
