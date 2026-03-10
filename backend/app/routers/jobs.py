from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import settings
from app.dependencies import job_manager
from app.models import FeedbackRequest, InstructionsRequest, JobResponse, JobStatus, JobStatusResponse

router = APIRouter()


@router.get("/api/jobs/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    status = job_manager.get_status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/api/jobs", response_model=list[JobResponse])
async def list_jobs():
    return job_manager.list_jobs()


@router.get("/api/jobs/{job_id}/source")
async def get_source_video(job_id: str):
    """Serve the original uploaded video so the frontend can preview clips via time fragments."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # File is saved as {job_id}.{ext} — find it by glob
    for p in settings.uploads_path.glob(f"{job_id}.*"):
        if p.suffix.lower() in (".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"):
            return FileResponse(p, media_type="video/mp4", filename=p.name)
    raise HTTPException(status_code=404, detail="Source video not found")


@router.post("/api/jobs/{job_id}/pause")
async def pause_job(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.PROCESSING, JobStatus.QUEUED):
        raise HTTPException(status_code=400, detail="Job is not currently processing")
    job_manager.request_pause(job_id)
    return {"ok": True, "message": "Pause requested — pipeline will pause at next checkpoint"}


@router.post("/api/jobs/{job_id}/instructions")
async def submit_instructions(job_id: str, body: InstructionsRequest):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if body.pause:
        job_manager.request_pause(job_id)
        return {"ok": True, "message": "Pause requested"}
    if job.status == JobStatus.AWAITING_INSTRUCTIONS:
        job_manager.submit_instructions(job_id, body.instructions)
        return {"ok": True, "message": "Instructions submitted — pipeline resuming"}
    if job.status == JobStatus.PROCESSING:
        # Pipeline already moved on — queue feedback for the next AI step
        if body.instructions:
            job_manager.queue_feedback(job_id, body.instructions)
        return {"ok": True, "message": "Feedback queued for next AI step"}
    raise HTTPException(
        status_code=400,
        detail=f"Job is not in a state to receive instructions (status: {job.status})",
    )


@router.post("/api/jobs/{job_id}/feedback")
async def submit_feedback(job_id: str, body: FeedbackRequest):
    """Queue feedback for the next AI step without pausing the pipeline."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if body.text:
        job_manager.queue_feedback(job_id, body.text)
    return {"ok": True}
