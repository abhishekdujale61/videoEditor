import json
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from app.config import settings
from app.dependencies import job_manager
from app.models import UploadResponse
from app.services.video_pipeline import run_pipeline

router = APIRouter()


async def _save_upload(upload: UploadFile, dest: Path):
    """Save an uploaded file to dest."""
    with open(dest, "wb") as f:
        while chunk := await upload.read(1024 * 1024):
            f.write(chunk)


VIDEO_EXTS = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}


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

    job_manager.create_job(job_id, file.filename)
    background_tasks.add_task(
        run_pipeline, job_id, str(upload_path), guest_photo_path, guest_name,
        intro_path, outro_path, trim_start, trim_end, enabled_features,
    )

    return UploadResponse(job_id=job_id, message="Upload successful. Processing started.")
