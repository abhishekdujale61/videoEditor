export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobStatus =
  | 'queued'
  | 'processing'
  | 'awaiting_review'
  | 'awaiting_instructions'
  | 'awaiting_plan_edit'
  | 'awaiting_short_review'
  | 'completed'
  | 'failed';

export interface StepInfo {
  name: string;
  status: StepStatus;
  message: string;
}

export interface ClipMeta {
  index: number;
  start_time: number;
  end_time: number;
  score: number;
  reason: string;
  clip_file: string;
  thumbnail_file: string;
}

export interface ThumbnailConcept {
  id: string;
  short_index: number;
  title: string;
  description: string;
  image_prompt: string;
  selected: boolean;
}

export interface ShortMeta {
  index: number;
  start_time: number;
  end_time: number;
  score: number;
  topic: string;
  clip_file: string | null;
  thumbnail_files: string[];
}

export interface HighlightMeta {
  duration: number;
  clip_file: string;
}

export interface ShortReviewData {
  short_index: number;
  total_shorts: number;
  title: string;
  topic: string;
  start_time: number;
  end_time: number;
  concepts: ThumbnailConcept[];
  selected_concept_id: string;
  image_path: string | null;
  image_prompt: string;
  iteration: number;
  clip_file: string | null;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  filename: string;
  steps: StepInfo[];
  error: string | null;
  main_video: string | null;
  main_thumbnail: string | null;
  clips: ClipMeta[];
  highlight: HighlightMeta | null;
  shorts: ShortMeta[];
  thumbnail_concepts: ThumbnailConcept[];
  pending_instructions: string | null;
  enabled_features: Record<string, boolean>;
  step_outputs: Record<string, any>;
  review_step: string | null;
  awaiting_plan: any[];
  short_review: ShortReviewData | null;
}

export interface JobStatusResponse {
  id: string;
  status: JobStatus;
  progress: number;
  steps: StepInfo[];
  error: string | null;
}

export interface UploadResponse {
  job_id: string;
  message: string;
}

export const STEP_LABELS: Record<string, string> = {
  transcription: 'Transcription',
  ai_planning: 'AI Content Planning',
  concept_ideation: 'Thumbnail Concept Design',
  image_generation: 'AI Image Generation',
  thumbnail_compositing: 'Thumbnail Compositing',
  highlight_extraction: 'Highlight Extraction',
  clip_extraction: 'Short Clip Extraction',
  video_assembly: 'Video Assembly',
};
