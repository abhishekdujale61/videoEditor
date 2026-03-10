from enum import Enum
from typing import Any

from pydantic import BaseModel


class StepName(str, Enum):
    TRANSCRIPTION = "transcription"
    AI_PLANNING = "ai_planning"
    CONCEPT_IDEATION = "concept_ideation"
    IMAGE_GENERATION = "image_generation"
    THUMBNAIL_COMPOSITING = "thumbnail_compositing"
    HIGHLIGHT_EXTRACTION = "highlight_extraction"
    CLIP_EXTRACTION = "clip_extraction"
    VIDEO_ASSEMBLY = "video_assembly"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    AWAITING_REVIEW = "awaiting_review"
    AWAITING_INSTRUCTIONS = "awaiting_instructions"
    AWAITING_PLAN_EDIT = "awaiting_plan_edit"        # user edits AI-suggested shorts plan
    AWAITING_SHORT_REVIEW = "awaiting_short_review"  # per-short concept+image review
    COMPLETED = "completed"
    FAILED = "failed"


PIPELINE_STEPS = list(StepName)


class StepInfo(BaseModel):
    name: StepName
    status: StepStatus = StepStatus.PENDING
    message: str = ""


class ClipMeta(BaseModel):
    index: int
    start_time: float
    end_time: float
    score: float
    reason: str
    clip_file: str
    thumbnail_file: str


class ThumbnailConcept(BaseModel):
    id: str
    short_index: int
    title: str
    description: str
    image_prompt: str
    selected: bool = False


class ShortReviewData(BaseModel):
    """State for per-short human-in-the-loop review (concept + image)."""
    short_index: int
    total_shorts: int
    title: str
    topic: str
    start_time: float
    end_time: float
    concepts: list[ThumbnailConcept]
    selected_concept_id: str
    image_path: str | None = None   # filename relative to job_dir
    image_prompt: str = ""
    iteration: int = 0              # how many times image has been regenerated
    clip_file: str | None = None    # extracted clip filename for in-review preview


class ShortMeta(BaseModel):
    index: int
    start_time: float
    end_time: float
    score: float
    topic: str
    clip_file: str | None = None
    thumbnail_files: list[str] = []


class HighlightMeta(BaseModel):
    duration: float
    clip_file: str


class JobResponse(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    filename: str
    steps: list[StepInfo]
    error: str | None = None
    main_video: str | None = None
    main_thumbnail: str | None = None
    clips: list[ClipMeta] = []
    highlight: HighlightMeta | None = None
    shorts: list[ShortMeta] = []
    thumbnail_concepts: list[ThumbnailConcept] = []
    pending_instructions: str | None = None
    enabled_features: dict[str, bool] = {}
    step_outputs: dict[str, Any] = {}   # output data stored after each step
    review_step: str | None = None       # which step is currently paused for review
    awaiting_plan: list[dict] = []       # AI-suggested shorts awaiting user edit
    short_review: ShortReviewData | None = None  # current per-short review state
    files_cleaned: bool = False          # True after user downloads and files are deleted


class JobStatusResponse(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    steps: list[StepInfo]
    error: str | None = None


class UploadResponse(BaseModel):
    job_id: str
    message: str


class ApproveConceptsRequest(BaseModel):
    selections: dict[str, str]  # short_index (str) → concept_id


class InstructionsRequest(BaseModel):
    instructions: str
    pause: bool = False


class FeedbackRequest(BaseModel):
    text: str


class ShortPlanItem(BaseModel):
    index: int
    title: str
    topic: str
    start_time: float
    end_time: float
    score: float = 0.7
    image_prompt: str = ""


class SubmitPlanRequest(BaseModel):
    shorts: list[ShortPlanItem]


class RegenerateImageRequest(BaseModel):
    prompt: str
    concept_id: str | None = None


class ApproveShortRequest(BaseModel):
    title: str
    concept_id: str
    image_prompt: str
