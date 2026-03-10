from fastapi import APIRouter, HTTPException

from app.dependencies import job_manager
from app.models import ThumbnailConcept

router = APIRouter()


@router.get("/api/jobs/{job_id}/concepts", response_model=list[ThumbnailConcept])
async def get_concepts(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.thumbnail_concepts
