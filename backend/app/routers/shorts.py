from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.dependencies import job_manager
from app.models import (
    ApproveThumbnailRequest,
    ApproveShortRequest,
    JobStatus,
    RedoThumbnailRequest,
    RegenerateImageRequest,
    SubmitPlanRequest,
)
from app.services import image_generation_service, template_thumbnail

router = APIRouter()


@router.post("/api/jobs/{job_id}/submit-plan")
async def submit_plan(job_id: str, body: SubmitPlanRequest):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.AWAITING_PLAN_EDIT:
        raise HTTPException(
            status_code=400,
            detail=f"Job is not awaiting plan edit (status: {job.status})",
        )
    shorts = [s.model_dump() for s in body.shorts]
    job_manager.submit_plan(job_id, shorts)
    return {"ok": True, "message": f"Plan submitted with {len(shorts)} shorts"}


@router.post("/api/jobs/{job_id}/regenerate-short-image")
def regenerate_short_image(job_id: str, body: RegenerateImageRequest):
    """Generate a new DALL-E image for the current short under review.

    This is a synchronous endpoint — the caller waits for DALL-E to respond.
    The job must be in AWAITING_SHORT_REVIEW status.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.AWAITING_SHORT_REVIEW:
        raise HTTPException(
            status_code=400,
            detail=f"Job is not awaiting short review (status: {job.status})",
        )

    review = job.short_review
    if not review:
        raise HTTPException(status_code=400, detail="No active short review")

    iteration = review.iteration + 1
    concept_id = body.concept_id or review.selected_concept_id
    job_dir = settings.jobs_path / job_id
    out_filename = f"bg_{review.short_index}_v{iteration}.jpg"
    out_path = str(job_dir / out_filename)

    try:
        image_generation_service.generate_background_image(body.prompt, out_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {e}")

    job_manager.update_short_review_image(
        job_id,
        image_path=out_filename,
        prompt=body.prompt,
        iteration=iteration,
        concept_id=concept_id,
    )

    return {
        "ok": True,
        "image_path": out_filename,
        "iteration": iteration,
    }


@router.post("/api/jobs/{job_id}/approve-short")
async def approve_short(job_id: str, body: ApproveShortRequest):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.AWAITING_SHORT_REVIEW:
        raise HTTPException(
            status_code=400,
            detail=f"Job is not awaiting short review (status: {job.status})",
        )

    review = job.short_review
    if not review:
        raise HTTPException(status_code=400, detail="No active short review")

    approved_data = {
        "title": body.title,
        "concept_id": body.concept_id,
        "image_prompt": body.image_prompt,
        "image_path": review.image_path,
    }
    job_manager.approve_short(job_id, approved_data)
    return {"ok": True, "message": f"Short {review.short_index} approved"}


# ── Composited thumbnail review endpoints ────────────────────────────────────

@router.post("/api/jobs/{job_id}/redo-thumbnail")
def redo_thumbnail(job_id: str, body: RedoThumbnailRequest):
    """Recomposite the thumbnail with a new title/subtitle (fast PIL, no DALL-E).

    The job must be in AWAITING_THUMBNAIL_REVIEW status. The pipeline thread
    remains blocked — the user stays on the review page until they approve.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.AWAITING_THUMBNAIL_REVIEW:
        raise HTTPException(
            status_code=400,
            detail=f"Job is not awaiting thumbnail review (status: {job.status})",
        )

    review = job.thumbnail_review
    if not review:
        raise HTTPException(status_code=400, detail="No active thumbnail review")

    job_dir = settings.jobs_path / job_id
    out_path = str(job_dir / review.thumbnail_file)
    bg = review.bg_path or None

    try:
        template_thumbnail.create_episode_thumbnail(
            output_path=out_path,
            title=body.title,
            subtitle=body.subtitle,
            guest_name=review.guest_name,
            host_photo_path=review.host_photo_path if review.review_type == "main" else None,
            guest_photo_path=review.guest_photo_path if review.review_type == "main" else None,
            bg_template_path=bg if bg and Path(bg).exists() else None,
            logo_path=review.logo_path,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thumbnail compositing failed: {e}")

    iteration = review.iteration + 1
    job_manager.update_thumbnail_review(job_id, title=body.title, subtitle=body.subtitle, iteration=iteration)

    return {"ok": True, "thumbnail_file": review.thumbnail_file, "iteration": iteration}


@router.post("/api/jobs/{job_id}/approve-thumbnail")
async def approve_thumbnail(job_id: str):
    """Approve the current composited thumbnail and resume the pipeline."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.AWAITING_THUMBNAIL_REVIEW:
        raise HTTPException(
            status_code=400,
            detail=f"Job is not awaiting thumbnail review (status: {job.status})",
        )

    review = job.thumbnail_review
    if not review:
        raise HTTPException(status_code=400, detail="No active thumbnail review")

    msg = (
        f"Short {review.short_index + 1}/{review.total_shorts} thumbnail approved"
        if review.review_type == "short"
        else "Main thumbnail approved"
    )
    job_manager.approve_thumbnail(job_id)
    return {"ok": True, "message": msg}
