import json
import threading
from pathlib import Path

from app.config import settings
from app.models import (
    ClipMeta,
    HighlightMeta,
    JobResponse,
    JobStatus,
    JobStatusResponse,
    PIPELINE_STEPS,
    ShortMeta,
    ShortReviewData,
    StepInfo,
    StepName,
    StepStatus,
    ThumbnailConcept,
    ThumbnailReviewData,
)

DEFAULT_FEATURES = {
    "thumbnail": True,
    "shorts": True,
    "highlight": True,
    "assembly": True,
}


class JobManager:
    def __init__(self):
        self._jobs: dict[str, JobResponse] = {}
        self._selections: dict[str, dict[str, str]] = {}  # job_id → {short_index: concept_id}
        self._lock = threading.Lock()
        # Instruction-pause support
        self._instruction_events: dict[str, threading.Event] = {}
        self._instruction_events_lock = threading.Lock()
        self._pending_instructions: dict[str, str] = {}
        self._pause_requested: set[str] = set()
        # Non-blocking feedback queue (used when pipeline is already past AWAITING state)
        self._feedback_queues: dict[str, list[str]] = {}
        # Plan-edit HITL state
        self._plan_events: dict[str, threading.Event] = {}
        self._plan_events_lock = threading.Lock()
        self._submitted_plans: dict[str, list[dict]] = {}
        # Per-short review HITL state
        self._short_review_events: dict[str, threading.Event] = {}
        self._short_review_events_lock = threading.Lock()
        self._approved_short_data: dict[str, dict] = {}
        # Thumbnail review HITL state
        self._thumbnail_review_events: dict[str, threading.Event] = {}
        self._thumbnail_review_events_lock = threading.Lock()
        self._load_persisted_jobs()

    def _load_persisted_jobs(self):
        jobs_dir = settings.jobs_path
        if not jobs_dir.exists():
            return
        for job_dir in jobs_dir.iterdir():
            meta_file = job_dir / "metadata.json"
            if meta_file.exists():
                try:
                    data = json.loads(meta_file.read_text())
                    job = JobResponse(**data)
                    self._jobs[job.id] = job
                except Exception:
                    pass

    def _persist(self, job_id: str):
        job = self._jobs.get(job_id)
        if not job:
            return
        job_dir = settings.jobs_path / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        meta_file = job_dir / "metadata.json"
        meta_file.write_text(job.model_dump_json(indent=2))

    def create_job(self, job_id: str, filename: str) -> JobResponse:
        steps = [StepInfo(name=step) for step in PIPELINE_STEPS]
        job = JobResponse(
            id=job_id,
            status=JobStatus.QUEUED,
            filename=filename,
            steps=steps,
        )
        with self._lock:
            self._jobs[job_id] = job
            self._persist(job_id)
        return job

    def get_job(self, job_id: str) -> JobResponse | None:
        return self._jobs.get(job_id)

    def get_status(self, job_id: str) -> JobStatusResponse | None:
        job = self._jobs.get(job_id)
        if not job:
            return None
        return JobStatusResponse(
            id=job.id,
            status=job.status,
            progress=job.progress,
            steps=job.steps,
            error=job.error,
        )

    def list_jobs(self) -> list[JobResponse]:
        return list(self._jobs.values())

    def start_job(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.PROCESSING
                self._persist(job_id)

    def update_step(self, job_id: str, step_name: StepName, status: StepStatus, message: str = ""):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for step in job.steps:
                if step.name == step_name:
                    step.status = status
                    step.message = message
                    break
            completed = sum(1 for s in job.steps if s.status == StepStatus.COMPLETED)
            job.progress = int((completed / len(job.steps)) * 100)
            self._persist(job_id)

    def set_awaiting_review(self, job_id: str):
        """Set job status to AWAITING_REVIEW (pipeline is paused waiting for user input)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.AWAITING_REVIEW
                self._persist(job_id)

    def store_concepts(self, job_id: str, concepts: list[ThumbnailConcept]):
        """Store thumbnail concepts on the job and persist."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.thumbnail_concepts = concepts
                self._persist(job_id)

    def approve_review(self, job_id: str, selections: dict[str, str]):
        """Store user's concept selections and set job back to PROCESSING."""
        with self._lock:
            self._selections[job_id] = selections
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.PROCESSING
                self._persist(job_id)

    def get_approved_selections(self, job_id: str) -> dict[str, str]:
        """Return stored concept selections for a job."""
        return self._selections.get(job_id, {})

    # ── Human-in-the-loop instruction pause ─────────────────────────────────

    def request_pause(self, job_id: str):
        """Request the pipeline to pause at the next checkpoint."""
        with self._lock:
            self._pause_requested.add(job_id)

    def is_pause_requested(self, job_id: str) -> bool:
        return job_id in self._pause_requested

    def register_instruction_event(self, job_id: str, event: threading.Event):
        with self._instruction_events_lock:
            self._instruction_events[job_id] = event

    def set_awaiting_instructions(self, job_id: str):
        """Mark job as paused awaiting human instructions."""
        with self._lock:
            self._pause_requested.discard(job_id)
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.AWAITING_INSTRUCTIONS
                self._persist(job_id)

    def submit_instructions(self, job_id: str, instructions: str):
        """Store instructions and resume the paused pipeline thread."""
        with self._lock:
            if instructions:
                self._pending_instructions[job_id] = instructions
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.PROCESSING
                job.review_step = None
                self._persist(job_id)
        with self._instruction_events_lock:
            event = self._instruction_events.pop(job_id, None)
        if event:
            event.set()

    def store_step_output(self, job_id: str, step_name: str, data: dict):
        """Persist output data for a completed step (visible to the frontend)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.step_outputs[step_name] = data
                self._persist(job_id)

    def set_awaiting_step_review(self, job_id: str, step_name: str):
        """Block the pipeline for per-step human review."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.AWAITING_INSTRUCTIONS
                job.review_step = step_name
                self._persist(job_id)

    def auto_resume(self, job_id: str):
        """Resume job after a step-review timeout (no user input)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.status == JobStatus.AWAITING_INSTRUCTIONS:
                job.status = JobStatus.PROCESSING
                job.review_step = None
                self._persist(job_id)
        # Clean up any stale instruction event
        with self._instruction_events_lock:
            self._instruction_events.pop(job_id, None)

    def queue_feedback(self, job_id: str, text: str):
        """Queue feedback to be used by the next AI step (non-blocking path)."""
        with self._lock:
            self._feedback_queues.setdefault(job_id, []).append(text)

    def drain_feedback(self, job_id: str) -> str:
        """Pop and return all queued feedback as a single string."""
        with self._lock:
            items = self._feedback_queues.pop(job_id, [])
        return "\n".join(items)

    def get_and_clear_instructions(self, job_id: str) -> str | None:
        return self._pending_instructions.pop(job_id, None)

    def complete_job(
        self,
        job_id: str,
        main_video: str,
        main_thumbnail: str,
        clips: list[ClipMeta],
        highlight: HighlightMeta | None = None,
        shorts: list[ShortMeta] | None = None,
    ):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.COMPLETED
                job.progress = 100
                job.main_video = main_video
                job.main_thumbnail = main_thumbnail
                job.clips = clips
                if highlight is not None:
                    job.highlight = highlight
                if shorts is not None:
                    job.shorts = shorts
                self._persist(job_id)

    def fail_job(self, job_id: str, error: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.FAILED
                job.error = error
                self._persist(job_id)

    # ── Plan-edit HITL ───────────────────────────────────────────────────────

    def set_awaiting_plan_edit(self, job_id: str, ai_shorts: list[dict]):
        """Pause pipeline at AWAITING_PLAN_EDIT with AI-suggested shorts."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.AWAITING_PLAN_EDIT
                job.awaiting_plan = ai_shorts
                self._persist(job_id)

    def register_plan_event(self, job_id: str, event: threading.Event):
        with self._plan_events_lock:
            self._plan_events[job_id] = event

    def submit_plan(self, job_id: str, shorts: list[dict]):
        """Store user-edited plan and resume the pipeline thread."""
        with self._lock:
            self._submitted_plans[job_id] = shorts
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.PROCESSING
                job.awaiting_plan = []
                self._persist(job_id)
        with self._plan_events_lock:
            event = self._plan_events.pop(job_id, None)
        if event:
            event.set()

    def get_submitted_plan(self, job_id: str) -> list[dict]:
        return self._submitted_plans.pop(job_id, [])

    # ── Per-short review HITL ────────────────────────────────────────────────

    def set_awaiting_short_review(self, job_id: str, review_data: ShortReviewData):
        """Pause pipeline for per-short concept + image review."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.AWAITING_SHORT_REVIEW
                job.short_review = review_data
                self._persist(job_id)

    def register_short_review_event(self, job_id: str, event: threading.Event):
        with self._short_review_events_lock:
            self._short_review_events[job_id] = event

    def update_short_review_image(
        self, job_id: str, image_path: str, prompt: str, iteration: int, concept_id: str
    ):
        """Update the current short_review with a newly generated image (keeps job status unchanged)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.short_review:
                job.short_review.image_path = image_path
                job.short_review.image_prompt = prompt
                job.short_review.iteration = iteration
                job.short_review.selected_concept_id = concept_id
                self._persist(job_id)

    def approve_short(self, job_id: str, approved_data: dict):
        """Store approved short data and resume the pipeline thread."""
        with self._lock:
            self._approved_short_data[job_id] = approved_data
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.PROCESSING
                self._persist(job_id)
        with self._short_review_events_lock:
            event = self._short_review_events.pop(job_id, None)
        if event:
            event.set()

    def get_approved_short(self, job_id: str) -> dict:
        return self._approved_short_data.pop(job_id, {})

    def clear_short_review(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.short_review = None
                self._persist(job_id)

    def add_completed_short(self, job_id: str, short: ShortMeta):
        """Append a completed ShortMeta to the job incrementally (live UI updates)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.shorts.append(short)
                self._persist(job_id)

    # ── Composited thumbnail review HITL ────────────────────────────────────

    def set_awaiting_thumbnail_review(self, job_id: str, review_data: ThumbnailReviewData):
        """Pause pipeline for human review of a fully composited thumbnail."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.AWAITING_THUMBNAIL_REVIEW
                job.thumbnail_review = review_data
                self._persist(job_id)

    def register_thumbnail_review_event(self, job_id: str, event: threading.Event):
        with self._thumbnail_review_events_lock:
            self._thumbnail_review_events[job_id] = event

    def update_thumbnail_review(self, job_id: str, title: str, subtitle: str, iteration: int):
        """Update the thumbnail review state after a redo (keeps status unchanged)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.thumbnail_review:
                job.thumbnail_review.title = title
                job.thumbnail_review.subtitle = subtitle
                job.thumbnail_review.iteration = iteration
                self._persist(job_id)

    def approve_thumbnail(self, job_id: str):
        """Resume the pipeline after thumbnail approval."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.PROCESSING
                self._persist(job_id)
        with self._thumbnail_review_events_lock:
            event = self._thumbnail_review_events.pop(job_id, None)
        if event:
            event.set()

    def clear_thumbnail_review(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.thumbnail_review = None
                self._persist(job_id)
