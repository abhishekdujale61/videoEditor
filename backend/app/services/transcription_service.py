import os
import tempfile

import openai

from app.config import settings
from app.services import ffmpeg_service


def transcribe_video(video_path: str) -> dict:
    """Extract audio from video and transcribe using Whisper API.

    Returns:
        {"text": str, "segments": [{start, end, text}], "language": str}
    """
    tmp_audio = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            tmp_audio = f.name

        ffmpeg_service.extract_audio(video_path, tmp_audio)

        client = openai.OpenAI(api_key=settings.openai_api_key)

        with open(tmp_audio, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        segments = []
        if hasattr(response, "segments") and response.segments:
            for seg in response.segments:
                segments.append({
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text,
                })

        return {
            "text": response.text if hasattr(response, "text") else "",
            "segments": segments,
            "language": response.language if hasattr(response, "language") else "en",
        }

    except Exception as e:
        print(f"[transcription_service] Whisper transcription failed: {e}")
        return {"text": "", "segments": [], "language": "en"}

    finally:
        if tmp_audio and os.path.exists(tmp_audio):
            os.unlink(tmp_audio)
