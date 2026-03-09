import base64
import json
import uuid

import cv2
import openai

from app.config import settings


def _extract_frames(video_path: str, interval_sec: float = 5.0) -> list[tuple[float, str]]:
    """Extract frames at regular intervals, return list of (timestamp, base64_jpeg)."""
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0

    frames = []
    t = 0.0
    while t < duration:
        frame_num = int(t * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        if not ret:
            break

        # Resize to reduce token cost (max 512px wide)
        h, w = frame.shape[:2]
        if w > 512:
            scale = 512 / w
            frame = cv2.resize(frame, (512, int(h * scale)))

        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        b64 = base64.standard_b64encode(buf.tobytes()).decode("utf-8")
        frames.append((t, b64))
        t += interval_sec

    cap.release()
    return frames


def _parse_json(response_text: str) -> dict | list:
    text = response_text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()
    return json.loads(text)


def analyze_video(video_path: str, duration: float) -> dict:
    """Use GPT-4o to analyze video content and identify best conversation topics.

    Returns dict with keys:
        - clips: list of {start_time, end_time, score, reason, thumbnail_text, thumbnail_frame_time}
        - thumbnail: {title, subtitle, best_frame_time, accent_color}
        - video_summary: str
    """
    if duration <= 60:
        interval = 3.0
    elif duration <= 300:
        interval = 5.0
    else:
        interval = 10.0

    frames = _extract_frames(video_path, interval)

    if not frames:
        return _empty_result()

    # Limit to ~20 frames max to control costs
    if len(frames) > 20:
        step = len(frames) / 20
        frames = [frames[int(i * step)] for i in range(20)]

    clip_duration = settings.clip_duration
    num_clips = settings.num_clips

    # Build OpenAI message content with interleaved text + images
    content = [
        {
            "type": "text",
            "text": (
                f"You are a video content analyst and thumbnail designer. "
                f"This video is {duration:.0f} seconds long. "
                f"I'm showing you {len(frames)} frames sampled at regular intervals.\n\n"
                "Study every frame carefully:\n"
                "- Who are the people? How many? What do they look like?\n"
                "- What are they discussing or doing at each point?\n"
                "- What topics/subjects are covered throughout the video?\n"
                "- Which frames show people most clearly (faces visible, not blurry)?\n"
                "- Which frames show ALL people together in one shot?"
            ),
        }
    ]

    for timestamp, b64 in frames:
        content.append({"type": "text", "text": f"[{timestamp:.1f}s]"})
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"},
        })

    content.append({
        "type": "text",
        "text": (
            f"\nAnalyze what is being DISCUSSED/TALKED ABOUT in this video. "
            f"If the conversation covers multiple topics, identify the {num_clips} most "
            f"informative and valuable discussion segments.\n\n"

            f"## 1. BEST {num_clips} CLIPS (30-40 seconds each)\n"
            f"Select clips based on CONTENT VALUE — what topics have the richest, most "
            f"interesting, or most useful information. Think: 'What would someone learn "
            f"or find valuable from each clip?'\n"
            f"Each clip MUST be between 30 and 40 seconds long.\n\n"
            f"For each clip provide:\n"
            f"- **start_time / end_time**: in seconds, non-overlapping, within 0-{duration:.0f}s, duration 30-40s\n"
            f"- **score**: 0.0-1.0 based on information value\n"
            f"- **reason**: 1 sentence describing WHAT TOPIC is discussed in this segment\n"
            f"- **thumbnail_text**: 2-4 words summarizing the clip topic (for overlay on thumbnail)\n"
            f"- **thumbnail_frame_time**: timestamp of the CLEAREST frame in this clip's range where:\n"
            f"  * People's faces are clearly visible (not blurry, not looking away)\n"
            f"  * If multiple people exist, prefer a frame showing ALL of them together\n"
            f"  * If no group shot exists, pick the frame with the clearest single person\n\n"

            f"## 2. MAIN THUMBNAIL\n"
            f"Design the video's main thumbnail:\n"
            f"- **title**: 3-6 word catchy hook based on the KEY TOPIC or INSIGHT being discussed. "
            f"NEVER use generic phrases like 'two leaders', 'interview', 'conversation', "
            f"'professionals discussing', or speaker roles. Base it on what they actually talk about.\n"
            f"- **subtitle**: 6-12 words revealing the angle or key takeaway specific to this "
            f"conversation's content. Must reflect what is actually discussed.\n"
            f"- **best_frame_time**: the CLEAREST frame showing people together. "
            f"Priority: all people visible > clear face close-up > any clear frame. "
            f"Must NOT be blurry, dark, or mid-transition.\n"
            f"- **accent_color**: hex color matching video mood\n\n"

            f"## 3. VIDEO SUMMARY\n"
            f"One sentence: what main topics are covered in this video. Focus on WHAT is discussed, "
            f"not WHO is speaking or their roles.\n\n"

            f"Respond ONLY with valid JSON:\n"
            "```json\n"
            "{\n"
            '  "clips": [\n'
            "    {\n"
            '      "start_time": 10, "end_time": 40, "score": 0.95,\n'
            '      "reason": "Discussion about...",\n'
            '      "thumbnail_text": "Topic Here",\n'
            '      "thumbnail_frame_time": 25.0\n'
            "    }\n"
            "  ],\n"
            '  "thumbnail": {\n'
            '    "title": "Key Topic Hook",\n'
            '    "subtitle": "The specific insight from this conversation",\n'
            '    "best_frame_time": 15.0,\n'
            '    "accent_color": "#FF4444"\n'
            "  },\n"
            '  "video_summary": "..."\n'
            "}\n"
            "```"
        ),
    })

    client = openai.OpenAI(api_key=settings.openai_api_key)

    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1500,
        messages=[{"role": "user", "content": content}],
    )

    response_text = response.choices[0].message.content
    result = _parse_json(response_text)

    # Validate clips — enforce 30-40s duration
    validated_clips = []
    for clip in result.get("clips", [])[:num_clips]:
        start = max(0, float(clip["start_time"]))
        end = min(duration, float(clip["end_time"]))
        clip_len = end - start

        # Skip if too short to be useful
        if clip_len < 10:
            continue

        # Clamp to 30-40s range
        if clip_len < 30:
            end = min(duration, start + 30)
            if end - start < 30:
                start = max(0, end - 30)
        elif clip_len > 40:
            end = start + 40

        thumb_time = float(clip.get("thumbnail_frame_time", (start + end) / 2))
        thumb_time = max(start, min(end, thumb_time))
        validated_clips.append({
            "start_time": start,
            "end_time": end,
            "score": max(0.0, min(1.0, float(clip.get("score", 0.5)))),
            "reason": str(clip.get("reason", "AI-selected moment")),
            "thumbnail_text": str(clip.get("thumbnail_text", ""))[:40],
            "thumbnail_frame_time": thumb_time,
        })

    # Validate thumbnail
    thumb = result.get("thumbnail", {})
    thumbnail = {
        "title": str(thumb.get("title", ""))[:60],
        "subtitle": str(thumb.get("subtitle", ""))[:120],
        "best_frame_time": max(0, min(duration, float(thumb.get("best_frame_time", duration * 0.1)))),
        "accent_color": str(thumb.get("accent_color", "#8B5CF6")),
    }

    return {
        "clips": validated_clips,
        "thumbnail": thumbnail,
        "video_summary": str(result.get("video_summary", "")),
    }


def _empty_result() -> dict:
    return {
        "clips": [],
        "thumbnail": {
            "title": "Video",
            "subtitle": "",
            "best_frame_time": 0,
            "accent_color": "#8B5CF6",
        },
        "video_summary": "Could not extract frames",
    }


def plan_content(transcript: dict, duration: float, extra_context: str = "") -> dict:
    """Use GPT-4o to plan highlight sound bites and short clips from transcript.

    Returns:
        {
            "highlight_bites": [{start, end, text}],  # totaling 30-45s
            "shorts": [{start_time, end_time, topic, score, title}],
            "video_summary": str,
            "thumbnail": {title, subtitle},
        }
    """
    text = transcript.get("text", "")
    segments = transcript.get("segments", [])

    if not text and not segments:
        return _empty_plan(duration)

    num_shorts = settings.num_shorts

    segments_text = "\n".join(
        f"[{seg['start']:.1f}s - {seg['end']:.1f}s]: {seg['text']}"
        for seg in segments[:200]  # cap to avoid token overrun
    )

    extra_section = f"\n\nAdditional instructions from the producer:\n{extra_context}\n" if extra_context else ""

    prompt = f"""You are a podcast video editor. You have a full transcript of a {duration:.0f}s video.{extra_section}

Full transcript:
{text[:3000]}

Timed segments:
{segments_text[:4000]}

Your tasks:

## 1. HIGHLIGHT REEL (30-45 seconds total)
Select 3-6 short sound bite segments that together form a compelling highlight reel.
- Each bite: 5-15 seconds, complete sentence(s), coherent standalone quote
- Mix of host and guest voices if identifiable
- Total combined duration: 30-45 seconds

## 2. SHORTS ({num_shorts} shorts, each 45-90 seconds)
Identify {num_shorts} distinct topic segments suitable for standalone short-form videos.
- Each must cover one clear topic/question
- Give each a punchy title (3-6 words)
- Score 0-1 based on standalone value

## 3. VIDEO SUMMARY
One sentence describing the main topics and insights from this video. Focus on WHAT is discussed, not WHO is speaking or their roles.

## 4. MAIN THUMBNAIL
Design a thumbnail title and subtitle based entirely on what is DISCUSSED in this conversation.
- **title**: 3-6 word catchy hook — must be about the TOPIC or KEY INSIGHT (e.g. "Why AI Fails Companies", "Building Without Burnout"). NEVER use generic labels like "two leaders", "interview", "conversation", "professionals", or speaker roles.
- **subtitle**: 6-12 word phrase that reveals the angle, tension, or key takeaway (e.g. "The one mindset shift that changes everything", "What most founders get completely wrong"). Must be specific to the actual content discussed.

Respond ONLY with valid JSON:
```json
{{
  "highlight_bites": [
    {{"start": 10.5, "end": 22.0, "text": "quote..."}}
  ],
  "shorts": [
    {{"start_time": 45.0, "end_time": 120.0, "topic": "Topic description", "score": 0.9, "title": "Punchy Title"}}
  ],
  "video_summary": "...",
  "thumbnail": {{
    "title": "Topic-Based Hook",
    "subtitle": "The specific insight or angle from this conversation"
  }}
}}
```"""

    client = openai.OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = response.choices[0].message.content
    result = _parse_json(response_text)

    # Validate highlight_bites
    validated_bites = []
    total = 0.0
    for bite in result.get("highlight_bites", []):
        start = max(0.0, float(bite.get("start", 0)))
        end = min(duration, float(bite.get("end", start + 10)))
        seg_len = end - start
        if seg_len < 2:
            continue
        if total + seg_len > 50:
            break
        validated_bites.append({"start": start, "end": end, "text": str(bite.get("text", ""))})
        total += seg_len

    # Validate shorts
    validated_shorts = []
    for short in result.get("shorts", [])[:num_shorts]:
        start = max(0.0, float(short.get("start_time", 0)))
        end = min(duration, float(short.get("end_time", start + 60)))
        if end - start < 15:
            end = min(duration, start + 60)
        validated_shorts.append({
            "start_time": start,
            "end_time": end,
            "topic": str(short.get("topic", ""))[:200],
            "score": max(0.0, min(1.0, float(short.get("score", 0.7)))),
            "title": str(short.get("title", f"Short {len(validated_shorts)+1}"))[:60],
        })

    # Validate thumbnail title/subtitle
    raw_thumb = result.get("thumbnail", {})
    thumbnail = {
        "title": str(raw_thumb.get("title", ""))[:60],
        "subtitle": str(raw_thumb.get("subtitle", ""))[:120],
    }

    return {
        "highlight_bites": validated_bites,
        "shorts": validated_shorts,
        "video_summary": str(result.get("video_summary", "")),
        "thumbnail": thumbnail,
    }


def _empty_plan(duration: float) -> dict:
    return {
        "highlight_bites": [{"start": 0, "end": min(40, duration), "text": ""}],
        "shorts": [],
        "video_summary": "No transcript available",
        "thumbnail": {"title": "", "subtitle": ""},
    }


def generate_thumbnail_concepts(short: dict, topic_context: str) -> list[dict]:
    """Use GPT-4o to generate creative thumbnail concepts for a short.

    Args:
        short: {start_time, end_time, topic, title}
        topic_context: A few sentences of transcript context for this segment.

    Returns:
        List of concept dicts: [{id, title, description, image_prompt}]
    """
    num_concepts = settings.num_thumbnail_concepts

    prompt = f"""You are a creative director designing LinkedIn/enterprise AI video thumbnails.

Short video topic: {short.get('topic', '')}
Short title: {short.get('title', '')}
Context: {topic_context[:500]}

Generate {num_concepts} distinct creative thumbnail concepts for this short-form video.
The thumbnail will be 16:9 format (YouTube/LinkedIn style).

Rules for image_prompt:
- Describe ONLY abstract backgrounds, environments, patterns, or symbolic objects
- NO human faces, NO people, NO text overlays
- Must be cinematic and visually striking
- Target audience: enterprise AI / technology / business professionals

For each concept provide:
- title: catchy 3-5 word title for the thumbnail
- description: 1-2 sentences describing the visual concept
- image_prompt: detailed DALL-E 3 prompt (describe abstract scene, style, colors, mood)

Respond ONLY with valid JSON:
```json
[
  {{
    "title": "Short Title Here",
    "description": "Dark neural network visualization...",
    "image_prompt": "Abstract neural network connections glowing electric blue..."
  }}
]
```"""

    client = openai.OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = response.choices[0].message.content
    raw = _parse_json(response_text)
    if not isinstance(raw, list):
        raw = [raw]

    concepts = []
    for item in raw[:num_concepts]:
        concepts.append({
            "id": uuid.uuid4().hex[:8],
            "title": str(item.get("title", "Concept"))[:60],
            "description": str(item.get("description", ""))[:300],
            "image_prompt": str(item.get("image_prompt", ""))[:500],
        })

    return concepts
