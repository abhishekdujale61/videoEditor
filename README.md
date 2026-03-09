# AI Video Editor

An AI-powered video editing pipeline that transforms raw podcast or interview footage into polished short-form clips, highlight reels, and branded thumbnails — with human review checkpoints at key stages.

## Features

- **Auto-transcription** — Whisper-based speech-to-text
- **AI content planning** — GPT-4o identifies the best highlight moments and short-form clip segments
- **Human-in-the-loop review** — Edit the AI's plan, review each short, regenerate thumbnail images on demand
- **DALL-E 3 thumbnail generation** — Branded background images composed with a custom template
- **FFmpeg video processing** — Clip extraction, highlight reel assembly, thumbnail stills prepended to shorts
- **Final video assembly** — Highlight reel + intro + main video + outro, normalized to a consistent resolution

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, Pydantic v2 |
| AI | OpenAI GPT-4o (planning), DALL-E 3 (images), Whisper (transcription) |
| Video | FFmpeg, ffprobe, OpenCV |
| Frontend | React, TypeScript, Vite, Tailwind CSS, React Router |
| HTTP Client | Axios |

## Project Structure

```
videoEditor/
  backend/
    app/
      main.py                      # FastAPI app entry, CORS, router registration
      config.py                    # Settings via pydantic-settings (.env)
      models.py                    # Pydantic models: Job, Steps, Clips, Shorts, etc.
      dependencies.py              # job_manager singleton
      routers/
        upload.py                  # POST /api/upload
        jobs.py                    # GET/POST /api/jobs/*
        concepts.py                # GET /api/jobs/{id}/concepts, POST approve-concepts
        shorts.py                  # POST submit-plan, approve-short, regenerate-short-image
        download.py                # GET /api/download/{id}/{asset}
      services/
        video_pipeline.py          # 8-step pipeline (background thread)
        ai_analyzer.py             # GPT-4o content planning + concept generation
        transcription_service.py   # Whisper transcription
        ffmpeg_service.py          # Clip/highlight extraction
        image_generation_service.py# DALL-E 3 image generation
        thumbnail_compositor.py    # Thumbnail compositing
        template_thumbnail.py      # Branded thumbnail template (PIL)
        job_manager.py             # In-memory job state + threading events
    run.py                         # uvicorn entrypoint
    .env                           # API keys
    storage/
      assets/                      # host.png, logo.png, bg_template.png, intro.mp4, outro.mp4
      uploads/                     # Raw uploaded videos ({job_id}.mp4)
      jobs/{job_id}/               # Per-job outputs: shorts, thumbnails, highlight, main_video
  frontend/
    src/
      App.tsx                      # Routes: /, /processing/:id, /review/:id, /plan-edit/:id, /short-review/:id, /results/:id
      api/
        client.ts                  # Axios base client
        videoApi.ts                # All API calls
      pages/
        HomePage.tsx               # Upload form
        ProcessingPage.tsx         # Live pipeline progress
        ConceptReviewPage.tsx      # Pick thumbnail concept per short
        PlanEditPage.tsx           # Edit AI-generated content plan
        ShortReviewPage.tsx        # Review each short + regenerate images
        ResultsPage.tsx            # Download clips, shorts, thumbnails, main video
      hooks/
        useJobPolling.ts           # Polling hook for job status
        useFileUpload.ts
      types/job.ts                 # TypeScript interfaces mirroring backend models
```

## Pipeline

```
1. TRANSCRIPTION          — Whisper speech-to-text
2. AI_PLANNING            — GPT-4o plans highlight + short-clip segments
3. CONCEPT_IDEATION       — GPT-4o generates thumbnail concepts per short
          |
    [PAUSE: AWAITING_PLAN_EDIT]   — User edits the AI's content plan
          |
    [PAUSE: AWAITING_REVIEW]      — User picks a thumbnail concept per short
          |
    [PAUSE: AWAITING_SHORT_REVIEW]— User reviews each short + approves/regenerates thumbnail
          |
4. IMAGE_GENERATION  ─────────────────────────────┐  (parallel)
5. HIGHLIGHT_EXTRACTION ──────────────────────────┤
6. THUMBNAIL_COMPOSITING ─────────────────────────┤
7. CLIP_EXTRACTION ────────────────────────────────┘
8. VIDEO_ASSEMBLY         — highlight + intro + main + outro
```

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- FFmpeg and ffprobe installed and on `$PATH`
- OpenAI API key

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
OPENAI_API_KEY=sk-...
CORS_ORIGINS=http://localhost:5173

# Optional tuning
NUM_SHORTS=5
NUM_THUMBNAIL_CONCEPTS=2
CLIP_DURATION=30
NUM_CLIPS=3
```

Place brand assets in `backend/storage/assets/`:
- `host.png` — host photo
- `logo.png` — brand logo
- `bg_template.png` — thumbnail background template
- `intro.mp4` / `outro.mp4` — intro and outro clips

Start the server:

```bash
python run.py
# API available at http://localhost:8000
```

Health check: `GET /health` — reports FFmpeg availability.

### Frontend

```bash
cd frontend
npm install
npm run dev
# UI available at http://localhost:5173
```

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload a video file, starts pipeline |
| `GET` | `/api/jobs/{id}` | Get job status and step progress |
| `GET` | `/api/jobs/{id}/concepts` | Get AI-generated thumbnail concepts |
| `POST` | `/api/jobs/{id}/approve-concepts` | Submit concept selections |
| `POST` | `/api/jobs/{id}/submit-plan` | Submit edited content plan |
| `POST` | `/api/jobs/{id}/approve-short` | Approve a short's thumbnail |
| `POST` | `/api/jobs/{id}/regenerate-short-image` | Regenerate DALL-E image for a short |
| `GET` | `/api/download/{id}/{asset}` | Download a generated asset |
| `GET` | `/health` | Health check |

## Job Statuses

| Status | Description |
|---|---|
| `PROCESSING` | Pipeline is running |
| `AWAITING_PLAN_EDIT` | Waiting for user to edit AI content plan |
| `AWAITING_REVIEW` | Waiting for user to select thumbnail concepts |
| `AWAITING_SHORT_REVIEW` | Waiting for user to approve each short |
| `COMPLETED` | All outputs ready for download |
| `FAILED` | Pipeline error |

## Configuration

All config is via `.env` (read by `pydantic-settings`):

| Key | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `NUM_SHORTS` | `5` | Number of short clips to generate |
| `NUM_THUMBNAIL_CONCEPTS` | `2` | AI concepts generated per short |
| `CLIP_DURATION` | `30` | Duration (seconds) of each clip |
| `NUM_CLIPS` | `3` | Number of highlight clips |
