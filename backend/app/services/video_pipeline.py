"""8-step video processing pipeline with human review checkpoint.

Pipeline flow:
  TRANSCRIPTION → AI_PLANNING → CONCEPT_IDEATION
    [PAUSE: AWAITING_REVIEW — user picks concept per short]
  IMAGE_GENERATION → THUMBNAIL_COMPOSITING
    (parallel with)
  HIGHLIGHT_EXTRACTION → CLIP_EXTRACTION → VIDEO_ASSEMBLY
"""
from __future__ import annotations

import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from app.config import settings
from app.dependencies import job_manager
from app.models import (
    ClipMeta,
    HighlightMeta,
    ShortMeta,
    ShortReviewData,
    StepName,
    StepStatus,
    ThumbnailConcept,
)
from app.services import ffmpeg_service, ai_analyzer
from app.services import transcription_service, image_generation_service, thumbnail_compositor, thumbnail_generator, template_thumbnail

# Module-level review event registry (job_id → threading.Event)
_review_events: dict[str, threading.Event] = {}
_review_events_lock = threading.Lock()

DEFAULT_FEATURES = {"thumbnail": True, "shorts": True, "highlight": True, "assembly": True}


# ---------------------------------------------------------------------------
# Public API for the review checkpoint
# ---------------------------------------------------------------------------

def approve_concepts(job_id: str, selections: dict[str, str]):
    """Called by the API when the user submits their concept selections.

    Stores selections in job_manager and unblocks the pipeline thread.
    """
    job_manager.approve_review(job_id, selections)
    with _review_events_lock:
        event = _review_events.get(job_id)
    if event:
        event.set()


def _check_for_instructions(job_id: str) -> str | None:
    """Called before each pipeline step. If a pause was requested, blocks until instructions arrive."""
    if not job_manager.is_pause_requested(job_id):
        return None
    event = threading.Event()
    job_manager.register_instruction_event(job_id, event)
    job_manager.set_awaiting_instructions(job_id)
    event.wait()
    return job_manager.get_and_clear_instructions(job_id)


def _wait_for_review(job_id: str):
    """Block the pipeline thread until the user approves concepts.

    Sets job status to AWAITING_REVIEW. Returns when approve_concepts() is called.
    """
    event = threading.Event()
    with _review_events_lock:
        _review_events[job_id] = event
    job_manager.set_awaiting_review(job_id)
    event.wait()  # blocks until approve_concepts() calls event.set()
    with _review_events_lock:
        _review_events.pop(job_id, None)
    # Restore PROCESSING status (approve_review already did this)


def _wait_for_plan(job_id: str, ai_shorts: list[dict]) -> list[dict]:
    """Pause at AWAITING_PLAN_EDIT so user can edit the AI-generated shorts plan.

    Blocks until submit_plan() is called. Returns the (possibly edited) list of shorts.
    """
    event = threading.Event()
    job_manager.register_plan_event(job_id, event)
    job_manager.set_awaiting_plan_edit(job_id, ai_shorts)
    event.wait()
    return job_manager.get_submitted_plan(job_id) or ai_shorts


def _run_per_short_reviews(
    job_id: str,
    job_dir: Path,
    shorts_plan: list[dict],
    transcript: dict,
) -> list[dict]:
    """For each short sequentially: generate concepts + DALL-E image, pause for human review.

    Returns a list of approved dicts: {short_index, title, topic, start_time, end_time,
    concept_id, image_prompt, image_path, score}
    """
    approved_results: list[dict] = []
    text = transcript.get("text", "")
    total = len(shorts_plan)

    for i, short in enumerate(shorts_plan):
        start = short.get("start_time", 0)
        end = short.get("end_time", start + 60)

        # Extract relevant transcript excerpt for this segment
        segments = transcript.get("segments", [])
        excerpt = " ".join(
            seg["text"] for seg in segments
            if seg.get("start", 0) >= start and seg.get("end", 0) <= end
        )[:500] or text[int(start * 3):int(end * 3)][:500]

        # Generate concepts for this short
        job_manager.update_step(
            job_id, StepName.CONCEPT_IDEATION, StepStatus.RUNNING,
            f"Generating concepts for short {i + 1}/{total}…"
        )
        raw_concepts = ai_analyzer.generate_thumbnail_concepts(short, excerpt)
        concepts = [
            ThumbnailConcept(
                id=c["id"],
                short_index=i,
                title=c["title"],
                description=c["description"],
                image_prompt=c["image_prompt"],
            )
            for c in raw_concepts
        ]

        # Pick first concept as default and generate initial DALL-E image
        default_concept = concepts[0] if concepts else None
        image_path: str | None = None
        image_prompt = default_concept.image_prompt if default_concept else ""
        selected_concept_id = default_concept.id if default_concept else ""

        if default_concept:
            job_manager.update_step(
                job_id, StepName.IMAGE_GENERATION, StepStatus.RUNNING,
                f"Generating image for short {i + 1}/{total}…"
            )
            bg_path = str(job_dir / f"bg_{i}_v0.jpg")
            try:
                image_generation_service.generate_background_image(image_prompt, bg_path)
                image_path = f"bg_{i}_v0.jpg"
            except Exception as e:
                print(f"[pipeline] DALL-E failed for short {i}: {e}")

        # Build review state and pause
        review_data = ShortReviewData(
            short_index=i,
            total_shorts=total,
            title=short.get("title", f"Short {i + 1}"),
            topic=short.get("topic", ""),
            start_time=start,
            end_time=end,
            concepts=concepts,
            selected_concept_id=selected_concept_id,
            image_path=image_path,
            image_prompt=image_prompt,
            iteration=0,
        )

        event = threading.Event()
        job_manager.register_short_review_event(job_id, event)
        job_manager.set_awaiting_short_review(job_id, review_data)
        event.wait()

        approved = job_manager.get_approved_short(job_id)
        job_manager.clear_short_review(job_id)

        approved_results.append({
            "short_index": i,
            "title": approved.get("title", short.get("title", f"Short {i + 1}")),
            "topic": short.get("topic", ""),
            "start_time": start,
            "end_time": end,
            "score": short.get("score", 0.7),
            "concept_id": approved.get("concept_id", selected_concept_id),
            "image_prompt": approved.get("image_prompt", image_prompt),
            "image_path": approved.get("image_path", image_path),
        })

    job_manager.update_step(
        job_id, StepName.CONCEPT_IDEATION, StepStatus.COMPLETED,
        f"All {total} shorts reviewed and approved"
    )
    job_manager.update_step(
        job_id, StepName.IMAGE_GENERATION, StepStatus.COMPLETED,
        f"Images approved for {total} shorts"
    )
    return approved_results


def _step_review(job_id: str, step_name: str, output_data: dict, timeout: float = 45.0) -> str | None:
    """Auto-pause after a step so the user can inspect output and optionally send feedback.

    Blocks for up to `timeout` seconds. If the user clicks "Continue" (with or without
    feedback text), the pipeline resumes immediately. Otherwise it auto-continues after
    the timeout.

    Returns any feedback text the user submitted, or None.
    """
    event = threading.Event()
    job_manager.store_step_output(job_id, step_name, output_data)
    job_manager.register_instruction_event(job_id, event)
    job_manager.set_awaiting_step_review(job_id, step_name)

    event.wait(timeout=timeout)

    if not event.is_set():
        # Timed out — auto-resume without user input
        job_manager.auto_resume(job_id)

    return job_manager.get_and_clear_instructions(job_id)


# ---------------------------------------------------------------------------
# Step implementations
# ---------------------------------------------------------------------------

def _run_transcription(job_id: str, upload_path: str) -> dict:
    job_manager.update_step(
        job_id, StepName.TRANSCRIPTION, StepStatus.RUNNING,
        "Extracting audio and transcribing with Whisper..."
    )
    transcript = transcription_service.transcribe_video(upload_path)
    word_count = len(transcript.get("text", "").split())
    job_manager.update_step(
        job_id, StepName.TRANSCRIPTION, StepStatus.COMPLETED,
        f"Transcribed {word_count} words ({transcript.get('language', 'en')})"
    )
    return transcript


def _run_ai_planning(job_id: str, transcript: dict, duration: float, extra_context: str = "") -> dict:
    job_manager.update_step(
        job_id, StepName.AI_PLANNING, StepStatus.RUNNING,
        "Claude is planning highlight and shorts from transcript..."
    )
    plan = ai_analyzer.plan_content(transcript, duration, extra_context=extra_context)
    num_shorts = len(plan.get("shorts", []))
    num_bites = len(plan.get("highlight_bites", []))
    job_manager.update_step(
        job_id, StepName.AI_PLANNING, StepStatus.COMPLETED,
        f"Planned {num_bites} highlight bites and {num_shorts} shorts"
    )
    return plan


def _run_concept_ideation(job_id: str, shorts: list[dict], transcript: dict) -> list[ThumbnailConcept]:
    job_manager.update_step(
        job_id, StepName.CONCEPT_IDEATION, StepStatus.RUNNING,
        "Generating thumbnail concepts for each short..."
    )
    all_concepts: list[ThumbnailConcept] = []
    text = transcript.get("text", "")

    for i, short in enumerate(shorts):
        start = short.get("start_time", 0)
        end = short.get("end_time", start + 60)
        # Extract relevant transcript excerpt for this segment
        segments = transcript.get("segments", [])
        excerpt = " ".join(
            seg["text"] for seg in segments
            if seg.get("start", 0) >= start and seg.get("end", 0) <= end
        )[:500] or text[int(start * 3):int(end * 3)][:500]

        raw_concepts = ai_analyzer.generate_thumbnail_concepts(short, excerpt)
        for concept_dict in raw_concepts:
            all_concepts.append(ThumbnailConcept(
                id=concept_dict["id"],
                short_index=i,
                title=concept_dict["title"],
                description=concept_dict["description"],
                image_prompt=concept_dict["image_prompt"],
            ))

    job_manager.store_concepts(job_id, all_concepts)
    job_manager.update_step(
        job_id, StepName.CONCEPT_IDEATION, StepStatus.COMPLETED,
        f"Generated {len(all_concepts)} concepts for {len(shorts)} shorts. Awaiting review."
    )
    return all_concepts


def _run_image_generation(
    job_id: str,
    job_dir: Path,
    concepts: list[ThumbnailConcept],
    selections: dict[str, str],
) -> dict[int, str]:
    """Generate DALL-E background images for selected concepts.

    Returns:
        {short_index: image_path}
    """
    job_manager.update_step(
        job_id, StepName.IMAGE_GENERATION, StepStatus.RUNNING,
        "Generating AI background images with DALL-E 3..."
    )

    # Build map: short_index → selected concept
    selected: dict[int, ThumbnailConcept] = {}
    for short_idx_str, concept_id in selections.items():
        short_idx = int(short_idx_str)
        for concept in concepts:
            if concept.id == concept_id and concept.short_index == short_idx:
                selected[short_idx] = concept
                break

    background_paths: dict[int, str] = {}

    for short_idx, concept in selected.items():
        out_path = str(job_dir / f"bg_{short_idx}.jpg")
        try:
            image_generation_service.generate_background_image(concept.image_prompt, out_path)
            background_paths[short_idx] = out_path
        except Exception as e:
            print(f"[pipeline] DALL-E failed for short {short_idx}: {type(e).__name__}: {e}")
            # Thumbnail compositing will fall back to video-frame thumbnail

    failed = len(selected) - len(background_paths)
    msg = f"Generated {len(background_paths)} background images"
    if failed:
        msg += f" ({failed} failed — frame fallback will be used)"
    job_manager.update_step(
        job_id, StepName.IMAGE_GENERATION, StepStatus.COMPLETED,
        msg
    )
    return background_paths


def _run_thumbnail_compositing(
    job_id: str,
    job_dir: Path,
    approved_results: list[dict],
    guest_photo_path: str | None,
    guest_name: str = "Guest",
) -> dict[int, list[str]]:
    """Compose thumbnails for each short using approved DALL-E images as backgrounds.

    Returns:
        {short_index: [thumbnail_filename, ...]}
    """
    job_manager.update_step(
        job_id, StepName.THUMBNAIL_COMPOSITING, StepStatus.RUNNING,
        "Compositing thumbnails with approved images..."
    )

    host_photo = str(settings.host_png_path) if settings.host_png_path.exists() else None
    bg_tmpl = str(settings.bg_template_path) if settings.bg_template_path.exists() else None
    logo = str(settings.logo_path) if settings.logo_path.exists() else None

    short_thumbnails: dict[int, list[str]] = {}

    for approved in approved_results:
        i = approved["short_index"]
        title = approved.get("title", f"Short {i + 1}")
        subtitle = approved.get("topic", "")[:120]
        ai_bg_filename = approved.get("image_path")
        ai_bg_path = str(job_dir / ai_bg_filename) if ai_bg_filename else None

        out_file = f"short_{i}_thumbnail.jpg"
        out_path = str(job_dir / out_file)

        try:
            template_thumbnail.create_episode_thumbnail(
                output_path=out_path,
                title=title,
                subtitle=subtitle,
                guest_name=guest_name,
                host_photo_path=host_photo,
                guest_photo_path=guest_photo_path,
                bg_template_path=ai_bg_path or bg_tmpl,
                logo_path=logo,
            )
            short_thumbnails[i] = [out_file]
        except Exception as e:
            print(f"[pipeline] Template thumbnail failed for short {i}: {e}")

    job_manager.update_step(
        job_id, StepName.THUMBNAIL_COMPOSITING, StepStatus.COMPLETED,
        f"Composited thumbnails for {len(short_thumbnails)} shorts"
    )
    return short_thumbnails


def _run_main_thumbnail(
    job_id: str,
    job_dir: Path,
    title: str,
    subtitle: str,
    guest_name: str,
    guest_photo_path: str | None,
) -> str:
    """Generate the main episode thumbnail using the govai.fm template.

    Returns:
        filename relative to job_dir, or "" on failure.
    """
    host_photo = str(settings.host_png_path) if settings.host_png_path.exists() else None
    bg_tmpl = str(settings.bg_template_path) if settings.bg_template_path.exists() else None
    logo = str(settings.logo_path) if settings.logo_path.exists() else None

    out_path = str(job_dir / "main_thumbnail.jpg")
    try:
        template_thumbnail.create_episode_thumbnail(
            output_path=out_path,
            title=title,
            subtitle=subtitle,
            guest_name=guest_name,
            host_photo_path=host_photo,
            guest_photo_path=guest_photo_path,
            bg_template_path=bg_tmpl,
            logo_path=logo,
        )
        return "main_thumbnail.jpg"
    except Exception as e:
        print(f"[pipeline] Main thumbnail generation failed: {e}")
        return ""


def _run_highlight_extraction(
    job_id: str,
    upload_path: str,
    job_dir: Path,
    highlight_bites: list[dict],
) -> HighlightMeta | None:
    """Extract and concatenate highlight sound bites into a highlight reel."""
    job_manager.update_step(
        job_id, StepName.HIGHLIGHT_EXTRACTION, StepStatus.RUNNING,
        "Extracting highlight sound bites..."
    )

    if not highlight_bites:
        job_manager.update_step(
            job_id, StepName.HIGHLIGHT_EXTRACTION, StepStatus.COMPLETED,
            "No highlight bites planned"
        )
        return None

    bite_clips = []
    for i, bite in enumerate(highlight_bites):
        bite_path = str(job_dir / f"_bite_{i}.mp4")
        duration = bite["end"] - bite["start"]
        try:
            ffmpeg_service.extract_clip(upload_path, bite["start"], duration, bite_path)
            bite_clips.append(bite_path)
        except Exception as e:
            print(f"[pipeline] Failed to extract bite {i}: {e}")

    if not bite_clips:
        job_manager.update_step(
            job_id, StepName.HIGHLIGHT_EXTRACTION, StepStatus.COMPLETED,
            "Could not extract bites"
        )
        return None

    highlight_path = str(job_dir / "highlight.mp4")
    ffmpeg_service.concat_clips(bite_clips, highlight_path)

    # Cleanup bite clips
    for p in bite_clips:
        Path(p).unlink(missing_ok=True)

    total_duration = sum(b["end"] - b["start"] for b in highlight_bites)

    job_manager.update_step(
        job_id, StepName.HIGHLIGHT_EXTRACTION, StepStatus.COMPLETED,
        f"Highlight reel: {total_duration:.0f}s from {len(highlight_bites)} bites"
    )
    return HighlightMeta(duration=total_duration, clip_file="highlight.mp4")


def _run_clip_extraction(
    job_id: str,
    upload_path: str,
    job_dir: Path,
    shorts: list[dict],
    short_thumbnails: dict[int, list[str]],
) -> list[ShortMeta]:
    """Extract short-form clips from the main video."""
    job_manager.update_step(
        job_id, StepName.CLIP_EXTRACTION, StepStatus.RUNNING,
        f"Extracting {len(shorts)} short clips..."
    )

    short_metas: list[ShortMeta] = []
    for i, short in enumerate(shorts):
        clip_file = f"short_{i}.mp4"
        clip_path = str(job_dir / clip_file)
        start = short["start_time"]
        end = short["end_time"]
        try:
            ffmpeg_service.extract_clip(upload_path, start, end - start, clip_path)
            short_metas.append(ShortMeta(
                index=i,
                start_time=start,
                end_time=end,
                score=short.get("score", 0.7),
                topic=short.get("topic", ""),
                clip_file=clip_file,
                thumbnail_files=short_thumbnails.get(i, []),
            ))
        except Exception as e:
            print(f"[pipeline] Failed to extract short {i}: {e}")
            short_metas.append(ShortMeta(
                index=i,
                start_time=start,
                end_time=end,
                score=short.get("score", 0.7),
                topic=short.get("topic", ""),
                thumbnail_files=short_thumbnails.get(i, []),
            ))

    job_manager.update_step(
        job_id, StepName.CLIP_EXTRACTION, StepStatus.COMPLETED,
        f"Extracted {len(short_metas)} shorts"
    )
    return short_metas


def _prepend_thumbnails_to_shorts(
    job_id: str,
    job_dir: Path,
    short_metas: list[ShortMeta],
    thumbnail_duration: float = 3.0,
) -> list[ShortMeta]:
    """Prepend a 3-second thumbnail still to each short clip."""
    for sm in short_metas:
        if not sm.clip_file or not sm.thumbnail_files:
            continue

        clip_path = str(job_dir / sm.clip_file)
        thumb_path = str(job_dir / sm.thumbnail_files[0])

        if not Path(clip_path).exists() or not Path(thumb_path).exists():
            continue

        try:
            # Create a 3-second still video from the thumbnail
            thumb_vid = str(job_dir / f"_thumbvid_{sm.index}.mp4")
            ffmpeg_service.create_still_video(thumb_path, thumbnail_duration, clip_path, thumb_vid)

            # Prepend thumbnail video to the clip
            final_clip = str(job_dir / f"short_{sm.index}_with_thumb.mp4")
            ffmpeg_service.concat_clips([thumb_vid, clip_path], final_clip)

            # Swap the clip file reference
            sm.clip_file = f"short_{sm.index}_with_thumb.mp4"
            Path(thumb_vid).unlink(missing_ok=True)
        except Exception as e:
            print(f"[pipeline] Failed to prepend thumbnail to short {sm.index}: {e}")

    return short_metas


def _highest_res_path(paths: list[str]) -> str:
    """Return the path with the largest width×height among the given video files."""
    best, best_pixels = paths[0], 0
    for p in paths:
        try:
            w, h = ffmpeg_service.get_video_resolution(p)
            if w * h > best_pixels:
                best_pixels = w * h
                best = p
        except Exception:
            pass
    return best


def _run_video_assembly(
    job_id: str,
    job_dir: Path,
    main_video_path: str,
    highlight_path: str | None = None,
    intro_path: str | None = None,
    outro_path: str | None = None,
) -> str:
    """Assemble the final full video: highlight (if any) + intro + full video + outro.

    Resolution: all segments are normalized to whichever segment has the highest
    resolution (typically the intro/outro at 1920×1080).
    """
    job_manager.update_step(
        job_id, StepName.VIDEO_ASSEMBLY, StepStatus.RUNNING,
        "Assembling final video with intro/outro..."
    )

    output_path = str(job_dir / "main_video.mp4")

    # Resolve intro/outro: prefer per-job upload, fall back to global assets
    resolved_intro: str | None = intro_path
    if not resolved_intro and settings.intro_path.exists():
        resolved_intro = str(settings.intro_path)

    resolved_outro: str | None = outro_path
    if not resolved_outro and settings.outro_path.exists():
        resolved_outro = str(settings.outro_path)

    # Build ordered segment list: highlight → intro → full video → outro
    segments: list[str] = []
    if highlight_path and Path(highlight_path).exists():
        segments.append(highlight_path)
    if resolved_intro and Path(resolved_intro).exists():
        segments.append(resolved_intro)
    segments.append(main_video_path)
    if resolved_outro and Path(resolved_outro).exists():
        segments.append(resolved_outro)

    # Normalize to the highest-resolution segment (avoids downscaling intro/outro)
    reference = _highest_res_path(segments)
    ref_w, ref_h = ffmpeg_service.get_video_resolution(reference)

    ffmpeg_service.concat_normalized(segments, output_path, reference_path=reference)

    job_manager.update_step(
        job_id, StepName.VIDEO_ASSEMBLY, StepStatus.COMPLETED,
        f"Assembled {len(segments)} segments at {ref_w}×{ref_h}"
    )
    return "main_video.mp4"


# ---------------------------------------------------------------------------
# Main pipeline entrypoint
# ---------------------------------------------------------------------------

def run_pipeline(
    job_id: str,
    upload_path: str,
    guest_photo_path: str | None = None,
    guest_name: str = "Guest",
    intro_path: str | None = None,
    outro_path: str | None = None,
    trim_start: float | None = None,
    trim_end: float | None = None,
    enabled_features: dict[str, bool] | None = None,
):
    """Run the full 8-step video processing pipeline.

    Steps 1-3 run sequentially, then pipeline pauses for user review.
    Steps 4-7 run after approval (some in parallel), step 8 is final assembly.
    """
    features = {**DEFAULT_FEATURES, **(enabled_features or {})}

    job_dir = settings.jobs_path / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    job_manager.start_job(job_id)

    try:
        # ── Trim video if timestamps provided ──
        if trim_start is not None or trim_end is not None:
            raw_duration = ffmpeg_service.get_video_duration(upload_path)
            t_start = trim_start or 0.0
            t_end = trim_end if trim_end is not None else raw_duration
            trimmed_path = str(job_dir / "_trimmed.mp4")
            ffmpeg_service.extract_clip(upload_path, t_start, t_end - t_start, trimmed_path)
            upload_path = trimmed_path

        duration = ffmpeg_service.get_video_duration(upload_path)

        # ── Step 1: Transcription ──
        extra = _check_for_instructions(job_id)
        transcript = _run_transcription(job_id, upload_path)

        # ── Step 1 Review: show transcript, collect feedback for AI planning ──
        transcript_text = transcript.get("text", "")
        step1_feedback = _step_review(job_id, "transcription", {
            "word_count": len(transcript_text.split()),
            "language": transcript.get("language", "en"),
            "excerpt": transcript_text[:300],
        }, timeout=45.0)

        # ── Step 2: AI Planning ──
        # Merge step-review feedback + any manual pause instructions
        extra = _check_for_instructions(job_id)
        queued = job_manager.drain_feedback(job_id)
        combined_context = "\n".join(filter(None, [step1_feedback or "", extra or "", queued]))
        plan = _run_ai_planning(job_id, transcript, duration, extra_context=combined_context)
        highlight_bites = plan.get("highlight_bites", [])
        shorts_plan = plan.get("shorts", [])

        # Store AI planning output for frontend display
        job_manager.store_step_output(job_id, "ai_planning", {
            "highlight_bites_count": len(highlight_bites),
            "shorts_count": len(shorts_plan),
            "video_summary": plan.get("video_summary", "")[:300],
            "shorts": [
                {
                    "title": s.get("title", ""),
                    "start": int(s.get("start_time", 0)),
                    "end": int(s.get("end_time", 0)),
                    "topic": s.get("topic", "")[:80],
                }
                for s in shorts_plan
            ],
        })

        # Extract episode-level title/subtitle for main thumbnail
        video_summary = plan.get("video_summary", "")
        plan_thumb = plan.get("thumbnail", {})
        episode_title = plan_thumb.get("title", "") or (shorts_plan[0]["title"] if shorts_plan else "")
        episode_subtitle = plan_thumb.get("subtitle", "") or video_summary

        # ── Fallback: Visual analysis when transcript yields no shorts ──
        if not shorts_plan:
            job_manager.update_step(
                job_id, StepName.AI_PLANNING, StepStatus.RUNNING,
                "No speech detected — running visual analysis for clips..."
            )
            visual = ai_analyzer.analyze_video(upload_path, duration)
            shorts_plan = [
                {
                    "start_time": c["start_time"],
                    "end_time": c["end_time"],
                    "topic": c["reason"],
                    "score": c["score"],
                    "title": c.get("thumbnail_text", f"Clip {i + 1}"),
                }
                for i, c in enumerate(visual.get("clips", []))
            ]
            if not highlight_bites and visual.get("clips"):
                c = visual["clips"][0]
                highlight_bites = [{"start": c["start_time"], "end": c["end_time"], "text": ""}]
            vis_thumb = visual.get("thumbnail", {})
            episode_title = vis_thumb.get("title", episode_title)
            episode_subtitle = vis_thumb.get("subtitle", episode_subtitle)
            job_manager.update_step(
                job_id, StepName.AI_PLANNING, StepStatus.COMPLETED,
                f"Visual fallback: {len(highlight_bites)} highlight bites and {len(shorts_plan)} shorts"
            )

        # ── PAUSE: Let user edit the shorts plan ──
        if shorts_plan:
            shorts_plan = _wait_for_plan(job_id, shorts_plan)

        # ── Phase B: Per-short sequential concept+image review ──
        approved_results: list[dict] = []
        if features.get("thumbnail", True) and shorts_plan:
            approved_results = _run_per_short_reviews(job_id, job_dir, shorts_plan, transcript)
        else:
            reason = "Thumbnail disabled" if not features.get("thumbnail", True) else "No content detected"
            for step_name in (StepName.CONCEPT_IDEATION, StepName.IMAGE_GENERATION, StepName.THUMBNAIL_COMPOSITING):
                job_manager.update_step(job_id, step_name, StepStatus.COMPLETED, f"{reason} — skipping")

        # ── Highlight Extraction (runs after per-short reviews) ──
        highlight_meta: HighlightMeta | None = None
        extra = _check_for_instructions(job_id)
        if not features.get("highlight", True):
            job_manager.update_step(job_id, StepName.HIGHLIGHT_EXTRACTION, StepStatus.COMPLETED, "Highlight disabled — skipping")
        else:
            highlight_meta = _run_highlight_extraction(job_id, upload_path, job_dir, highlight_bites)

        # ── Thumbnail Compositing + Clip Extraction ──
        short_thumbnails: dict[int, list[str]] = {}
        short_metas: list[ShortMeta] = []

        def _maybe_compositing():
            if not features.get("thumbnail", True) or not approved_results:
                return {}
            return _run_thumbnail_compositing(
                job_id, job_dir, approved_results, guest_photo_path, guest_name
            )

        def _maybe_clips():
            if not features.get("shorts", True):
                job_manager.update_step(job_id, StepName.CLIP_EXTRACTION, StepStatus.COMPLETED, "Shorts disabled — skipping")
                return []
            return _run_clip_extraction(job_id, upload_path, job_dir, shorts_plan, {})

        extra = _check_for_instructions(job_id)
        with ThreadPoolExecutor(max_workers=2) as executor:
            composite_future = executor.submit(_maybe_compositing)
            clips_future = executor.submit(_maybe_clips)
            short_thumbnails = composite_future.result()
            short_metas_no_thumbs = clips_future.result()

        # Merge thumbnails into short metas
        for sm in short_metas_no_thumbs:
            sm.thumbnail_files = short_thumbnails.get(sm.index, [])
        short_metas = short_metas_no_thumbs

        # ── Prepend 3-second thumbnail to each short ──
        if features.get("shorts", True):
            short_metas = _prepend_thumbnails_to_shorts(job_id, job_dir, short_metas)

        # ── Step 8: Video Assembly (highlight → intro → full video → outro) ──
        extra = _check_for_instructions(job_id)
        if not features.get("assembly", True):
            job_manager.update_step(job_id, StepName.VIDEO_ASSEMBLY, StepStatus.COMPLETED, "Assembly disabled — skipping")
            main_video_filename = ""
        else:
            highlight_clip = str(job_dir / "highlight.mp4") if highlight_meta else None
            main_video_filename = _run_video_assembly(
                job_id, job_dir, upload_path, highlight_clip,
                intro_path=intro_path, outro_path=outro_path,
            )

        # ── Generate main episode thumbnail ──
        if not features.get("thumbnail", True):
            main_thumbnail_file = ""
        else:
            main_thumbnail_file = _run_main_thumbnail(
                job_id, job_dir,
                title=episode_title,
                subtitle=episode_subtitle,
                guest_name=guest_name,
                guest_photo_path=guest_photo_path,
            )

        # ── Complete job ──
        job_manager.complete_job(
            job_id,
            main_video=main_video_filename,
            main_thumbnail=main_thumbnail_file,
            clips=[],
            highlight=highlight_meta,
            shorts=short_metas,
        )

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        traceback.print_exc()

        job = job_manager.get_job(job_id)
        if job:
            for step in job.steps:
                if step.status == StepStatus.RUNNING:
                    job_manager.update_step(job_id, step.name, StepStatus.FAILED, error_msg)

        job_manager.fail_job(job_id, error_msg)
