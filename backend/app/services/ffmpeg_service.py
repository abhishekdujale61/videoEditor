import shutil
import subprocess
import tempfile
from pathlib import Path

from app.config import settings

# Resolve full paths at startup — works on Linux (/usr/bin) and Mac (/opt/homebrew/bin)
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"


def get_video_duration(video_path: str) -> float:
    result = subprocess.run(
        [
            FFPROBE, "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path,
        ],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def get_video_resolution(video_path: str) -> tuple[int, int]:
    result = subprocess.run(
        [
            FFPROBE, "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0",
            video_path,
        ],
        capture_output=True, text=True, check=True,
    )
    parts = result.stdout.strip().split("x")
    return int(parts[0]), int(parts[1])


def concat_with_intro_outro(video_path: str, output_path: str) -> str:
    intro = settings.intro_path
    outro = settings.outro_path

    segments = []
    if intro.exists():
        segments.append(str(intro))
    segments.append(video_path)
    if outro.exists():
        segments.append(str(outro))

    if len(segments) == 1:
        # No intro/outro, just copy
        subprocess.run(
            [FFMPEG, "-y", "-i", video_path, "-c", "copy", output_path],
            capture_output=True, check=True,
        )
        return output_path

    # Create concat file list
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for seg in segments:
            f.write(f"file '{seg}'\n")
        concat_file = f.name

    try:
        # Re-encode all to common format then concat
        intermediate_files = []
        target_w, target_h = get_video_resolution(video_path)

        for i, seg in enumerate(segments):
            intermediate = str(Path(output_path).parent / f"_seg_{i}.mp4")
            subprocess.run(
                [
                    FFMPEG, "-y", "-i", seg,
                    "-vf", f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-ar", "44100", "-ac", "2",
                    "-r", "30",
                    intermediate,
                ],
                capture_output=True, check=True,
            )
            intermediate_files.append(intermediate)

        # Write new concat file with intermediates
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            for seg in intermediate_files:
                f.write(f"file '{seg}'\n")
            concat_file2 = f.name

        subprocess.run(
            [
                FFMPEG, "-y", "-f", "concat", "-safe", "0",
                "-i", concat_file2,
                "-c", "copy",
                output_path,
            ],
            capture_output=True, check=True,
        )

        # Cleanup intermediates
        for f in intermediate_files:
            Path(f).unlink(missing_ok=True)
        Path(concat_file2).unlink(missing_ok=True)
    finally:
        Path(concat_file).unlink(missing_ok=True)

    return output_path


def extract_clip(
    video_path: str,
    start_time: float,
    duration: float,
    output_path: str,
    orientation: str = "landscape",
) -> str:
    """Extract a clip, optionally cropping to portrait (9:16) format.

    orientation:
        "landscape" — keep original aspect ratio (16:9 source → 16:9 clip)
        "portrait"  — center-crop to 9:16 then scale to 1080×1920
    """
    vf_args: list[str] = []
    if orientation == "portrait":
        # Crop a 9:16 region from the horizontal center, then scale to 1080×1920
        vf_args = ["-vf", "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920"]

    subprocess.run(
        [
            FFMPEG, "-y",
            "-ss", str(start_time),
            "-i", video_path,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac",
            *vf_args,
            output_path,
        ],
        capture_output=True, check=True,
    )
    return output_path


def extract_frame(video_path: str, timestamp: float, output_path: str) -> str:
    subprocess.run(
        [
            FFMPEG, "-y",
            "-ss", str(timestamp),
            "-i", video_path,
            "-frames:v", "1",
            "-q:v", "2",
            output_path,
        ],
        capture_output=True, check=True,
    )
    return output_path


def extract_audio(video_path: str, output_path: str) -> str:
    """Extract audio from video as mono MP3 at 16kHz for Whisper (stays under 25MB limit)."""
    subprocess.run(
        [
            FFMPEG, "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "libmp3lame",
            "-ac", "1",
            "-ar", "16000",
            "-q:a", "7",
            output_path,
        ],
        capture_output=True, check=True,
    )
    return output_path


def concat_clips(clip_paths: list[str], output_path: str) -> str:
    """Re-encode each clip to common format then concatenate."""
    if not clip_paths:
        raise ValueError("No clip paths provided")

    if len(clip_paths) == 1:
        subprocess.run(
            [FFMPEG, "-y", "-i", clip_paths[0], "-c", "copy", output_path],
            capture_output=True, check=True,
        )
        return output_path

    intermediate_files = []
    out_dir = Path(output_path).parent

    try:
        for i, clip in enumerate(clip_paths):
            intermediate = str(out_dir / f"_concat_seg_{i}.mp4")
            subprocess.run(
                [
                    FFMPEG, "-y", "-i", clip,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-ar", "44100", "-ac", "2",
                    "-r", "30",
                    intermediate,
                ],
                capture_output=True, check=True,
            )
            intermediate_files.append(intermediate)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            for seg in intermediate_files:
                f.write(f"file '{seg}'\n")
            concat_file = f.name

        subprocess.run(
            [
                FFMPEG, "-y", "-f", "concat", "-safe", "0",
                "-i", concat_file,
                "-c", "copy",
                output_path,
            ],
            capture_output=True, check=True,
        )
        Path(concat_file).unlink(missing_ok=True)

    finally:
        for f in intermediate_files:
            Path(f).unlink(missing_ok=True)

    return output_path


def create_video_from_image_audio(
    image_path: str,
    audio_path: str,
    duration: float,
    output_path: str,
) -> str:
    """Create a video from a static image with an audio track."""
    subprocess.run(
        [
            FFMPEG, "-y",
            "-loop", "1",
            "-i", image_path,
            "-i", audio_path,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac",
            "-shortest",
            "-t", str(duration),
            "-pix_fmt", "yuv420p",
            output_path,
        ],
        capture_output=True, check=True,
    )
    return output_path


def concat_normalized(segments: list[str], output_path: str, reference_path: str) -> str:
    """Concatenate video segments, normalizing all to reference_path's resolution.

    Rescales every segment to match reference_path width×height so that
    intro/outro (1920×1080) and podcast (640×360) can be mixed safely.
    """
    target_w, target_h = get_video_resolution(reference_path)
    print(f"[ffmpeg] concat_normalized: {len(segments)} segments → {target_w}×{target_h}")
    for i, s in enumerate(segments):
        print(f"[ffmpeg]   [{i}] {s}  exists={Path(s).exists()}")

    intermediate_files = []
    out_dir = Path(output_path).parent

    try:
        for i, seg in enumerate(segments):
            intermediate = str(out_dir / f"_norm_{i}.mp4")
            proc = subprocess.run(
                [
                    FFMPEG, "-y", "-i", seg,
                    "-vf", (
                        f"scale={target_w}:{target_h}:"
                        "force_original_aspect_ratio=decrease,"
                        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2"
                    ),
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-ar", "44100", "-ac", "2",
                    "-r", "30",
                    intermediate,
                ],
                capture_output=True,
            )
            if proc.returncode != 0:
                err = proc.stderr.decode(errors="replace")[-800:]
                raise RuntimeError(f"ffmpeg failed encoding segment [{i}] {seg}:\n{err}")
            intermediate_files.append(intermediate)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            for seg in intermediate_files:
                f.write(f"file '{seg}'\n")
            concat_file = f.name

        subprocess.run(
            [
                FFMPEG, "-y", "-f", "concat", "-safe", "0",
                "-i", concat_file,
                "-c", "copy",
                output_path,
            ],
            capture_output=True, check=True,
        )
        Path(concat_file).unlink(missing_ok=True)

    finally:
        for f in intermediate_files:
            Path(f).unlink(missing_ok=True)

    return output_path


def create_still_video(image_path: str, duration: float, reference_video_path: str, output_path: str) -> str:
    """Create a short silent video from a static image, matching the resolution of a reference video."""
    w, h = get_video_resolution(reference_video_path)
    subprocess.run(
        [
            FFMPEG, "-y",
            "-loop", "1",
            "-i", image_path,
            "-f", "lavfi",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            "-vf", f"scale={w}:{h}",
            "-t", str(duration),
            "-pix_fmt", "yuv420p",
            "-r", "30",
            output_path,
        ],
        capture_output=True, check=True,
    )
    return output_path


def assemble_full_video(segments: list[str], output_path: str) -> str:
    """Concatenate a list of video segments in order into a single output video."""
    return concat_clips(segments, output_path)
