import json
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from app.config import settings
from app.dependencies import job_manager
from app.models import UploadResponse
from app.services.video_pipeline import run_pipeline

router = APIRouter()

CHUNK_SIZE = 50 * 1024 * 1024  # 50 MB


async def _save_upload(upload: UploadFile, dest: Path):
    """Save an uploaded file to dest."""
    with open(dest, "wb") as f:
        while chunk := await upload.read(1024 * 1024):
            f.write(chunk)


VIDEO_EXTS = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}


# ---------------------------------------------------------------------------
# Chunked upload endpoints
# ---------------------------------------------------------------------------

@router.post("/api/upload/init")
async def init_chunked_upload(
    filename: str = Form(...),
    file_size: int = Form(...),   # total file size in bytes, sent by the client
):
    """Create a new job_id and scratch directory for chunked upload.

    Validates file extension and size against configured limits before
    any data is transferred.
    """
    ext = Path(filename).suffix.lower()
    if ext not in settings.allowed_ext_list:
        raise HTTPException(
            status_code=400,
            detail=f"File type {ext} not allowed. Allowed: {settings.allowed_ext_list}",
        )
    max_bytes = settings.max_upload_size_bytes
    if file_size > max_bytes:
        max_gb = settings.max_upload_size_gb
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file_size / 1024**3:.2f} GB. Maximum allowed: {max_gb} GB.",
        )
    job_id = uuid.uuid4().hex[:12]
    chunk_dir = settings.uploads_path / f"{job_id}_chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    return {"job_id": job_id, "max_upload_size_bytes": max_bytes}


@router.post("/api/upload/chunk/{job_id}")
async def upload_chunk(
    job_id: str,
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    file: UploadFile = File(...),
):
    """Receive one 50 MB slice. Returns progress info."""
    chunk_dir = settings.uploads_path / f"{job_id}_chunks"
    if not chunk_dir.exists():
        raise HTTPException(status_code=404, detail="Upload session not found. Call /api/upload/init first.")

    chunk_path = chunk_dir / f"chunk_{chunk_index:05d}"
    await _save_upload(file, chunk_path)
    return {"job_id": job_id, "received": chunk_index + 1, "total": total_chunks}


@router.post("/api/upload/finalize/{job_id}", response_model=UploadResponse)
async def finalize_chunked_upload(
    background_tasks: BackgroundTasks,
    job_id: str,
    filename: str = Form(...),
    total_chunks: int = Form(...),
    guest_photo: UploadFile | None = File(None),
    intro_video: UploadFile | None = File(None),
    outro_video: UploadFile | None = File(None),
    guest_name: str = Form("Guest"),
    trim_start: float | None = Form(None),
    trim_end: float | None = Form(None),
    features: str = Form("{}"),
    shorts_orientation: str = Form("landscape"),  # "landscape" (16:9) or "portrait" (9:16)
):
    """Assemble chunks, save optional assets, then start the pipeline."""
    chunk_dir = settings.uploads_path / f"{job_id}_chunks"
    if not chunk_dir.exists():
        raise HTTPException(status_code=404, detail="Upload session not found.")

    # Verify all chunks arrived
    missing = [i for i in range(total_chunks) if not (chunk_dir / f"chunk_{i:05d}").exists()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing chunks: {missing}")

    ext = Path(filename).suffix.lower()
    upload_dir = settings.uploads_path
    upload_dir.mkdir(parents=True, exist_ok=True)
    upload_path = upload_dir / f"{job_id}{ext}"

    # Stream-assemble chunks in order — read 4 MB at a time to stay memory-efficient
    # even with many 50 MB chunks (supports files well beyond 2 GB)
    _COPY_BUF = 4 * 1024 * 1024  # 4 MB copy buffer
    with open(upload_path, "wb") as out:
        for i in range(total_chunks):
            chunk_path = chunk_dir / f"chunk_{i:05d}"
            with open(chunk_path, "rb") as cf:
                while buf := cf.read(_COPY_BUF):
                    out.write(buf)
            chunk_path.unlink()
    chunk_dir.rmdir()

    # Set up job dir for optional assets
    job_dir = settings.jobs_path / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    guest_photo_path: str | None = None
    if guest_photo and guest_photo.filename:
        guest_dest = job_dir / "guest_photo.jpg"
        await _save_upload(guest_photo, guest_dest)
        guest_photo_path = str(guest_dest)

    intro_path: str | None = None
    if intro_video and intro_video.filename:
        intro_ext = Path(intro_video.filename).suffix.lower()
        if intro_ext not in VIDEO_EXTS:
            raise HTTPException(status_code=400, detail="Intro must be a video file")
        intro_dest = job_dir / f"uploaded_intro{intro_ext}"
        await _save_upload(intro_video, intro_dest)
        intro_path = str(intro_dest)

    outro_path: str | None = None
    if outro_video and outro_video.filename:
        outro_ext = Path(outro_video.filename).suffix.lower()
        if outro_ext not in VIDEO_EXTS:
            raise HTTPException(status_code=400, detail="Outro must be a video file")
        outro_dest = job_dir / f"uploaded_outro{outro_ext}"
        await _save_upload(outro_video, outro_dest)
        outro_path = str(outro_dest)

    try:
        enabled_features: dict[str, bool] = json.loads(features) if features.strip() else {}
    except Exception:
        enabled_features = {}

    orientation = shorts_orientation if shorts_orientation in ("landscape", "portrait") else "landscape"

    job_manager.create_job(job_id, filename)
    background_tasks.add_task(
        run_pipeline, job_id, str(upload_path), guest_photo_path, guest_name,
        intro_path, outro_path, trim_start, trim_end, enabled_features, orientation,
    )

    return UploadResponse(job_id=job_id, message="Upload complete. Processing started.")


# ---------------------------------------------------------------------------
# Legacy single-request upload (kept for backwards compatibility)
# ---------------------------------------------------------------------------

@router.post("/api/upload", response_model=UploadResponse)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    guest_photo: UploadFile | None = File(None),
    intro_video: UploadFile | None = File(None),
    outro_video: UploadFile | None = File(None),
    guest_name: str = Form("Guest"),
    trim_start: float | None = Form(None),
    trim_end: float | None = Form(None),
    features: str = Form("{}"),
    shorts_orientation: str = Form("landscape"),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in settings.allowed_ext_list:
        raise HTTPException(
            status_code=400,
            detail=f"File type {ext} not allowed. Allowed: {settings.allowed_ext_list}",
        )

    job_id = uuid.uuid4().hex[:12]

    # Save main video
    upload_dir = settings.uploads_path
    upload_dir.mkdir(parents=True, exist_ok=True)
    upload_path = upload_dir / f"{job_id}{ext}"
    await _save_upload(file, upload_path)

    # Set up job dir for optional assets
    job_dir = settings.jobs_path / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    guest_photo_path: str | None = None
    if guest_photo and guest_photo.filename:
        guest_dest = job_dir / "guest_photo.jpg"
        await _save_upload(guest_photo, guest_dest)
        guest_photo_path = str(guest_dest)

    intro_path: str | None = None
    if intro_video and intro_video.filename:
        intro_ext = Path(intro_video.filename).suffix.lower()
        if intro_ext not in VIDEO_EXTS:
            raise HTTPException(status_code=400, detail="Intro must be a video file")
        intro_dest = job_dir / f"uploaded_intro{intro_ext}"
        await _save_upload(intro_video, intro_dest)
        intro_path = str(intro_dest)

    outro_path: str | None = None
    if outro_video and outro_video.filename:
        outro_ext = Path(outro_video.filename).suffix.lower()
        if outro_ext not in VIDEO_EXTS:
            raise HTTPException(status_code=400, detail="Outro must be a video file")
        outro_dest = job_dir / f"uploaded_outro{outro_ext}"
        await _save_upload(outro_video, outro_dest)
        outro_path = str(outro_dest)

    # Parse enabled features
    try:
        enabled_features: dict[str, bool] = json.loads(features) if features.strip() else {}
    except Exception:
        enabled_features = {}

    orientation = shorts_orientation if shorts_orientation in ("landscape", "portrait") else "landscape"

    job_manager.create_job(job_id, file.filename)
    background_tasks.add_task(
        run_pipeline, job_id, str(upload_path), guest_photo_path, guest_name,
        intro_path, outro_path, trim_start, trim_end, enabled_features, orientation,
    )

    return UploadResponse(job_id=job_id, message="Upload successful. Processing started.")
