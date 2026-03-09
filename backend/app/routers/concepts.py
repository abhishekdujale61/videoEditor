from fastapi import APIRouter, HTTPException

from app.dependencies import job_manager
from app.models import ApproveConceptsRequest, ThumbnailConcept
from app.services import video_pipeline

router = APIRouter()


@router.get("/api/jobs/{job_id}/concepts", response_model=list[ThumbnailConcept])
async def get_concepts(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.thumbnail_concepts


@router.post("/api/jobs/{job_id}/approve-concepts")
async def approve_concepts(job_id: str, body: ApproveConceptsRequest):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "awaiting_review":
        raise HTTPException(
            status_code=409,
            detail=f"Job is not awaiting review (current status: {job.status})"
        )

    video_pipeline.approve_concepts(job_id, body.selections)
    return {"status": "approved", "message": "Pipeline resumed"}
