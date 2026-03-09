import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter


def extract_frame_at(video_path: str, timestamp: float) -> np.ndarray | None:
    """Extract a single frame at the given timestamp."""
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        cap.release()
        return None

    frame_num = int(timestamp * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
    ret, frame = cap.read()
    cap.release()
    return frame if ret else None


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return (139, 92, 246)  # fallback purple
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for font_path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]:
        try:
            return ImageFont.truetype(font_path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def create_creative_thumbnail(
    frame: np.ndarray,
    output_path: str,
    title: str,
    subtitle: str = "",
    accent_color: str = "#8B5CF6",
    size: tuple[int, int] = (1280, 720),
) -> str:
    """Create a YouTube-style creative thumbnail with gradient overlay, title, and subtitle."""
    # Convert frame to PIL
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    img = img.resize(size, Image.LANCZOS)

    # Slightly boost contrast & saturation
    from PIL import ImageEnhance
    img = ImageEnhance.Contrast(img).enhance(1.2)
    img = ImageEnhance.Color(img).enhance(1.15)

    # Create overlay layer (RGBA)
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    accent_rgb = _hex_to_rgb(accent_color)

    # Bottom gradient: dark fade from bottom (for text readability)
    for y in range(size[1] // 3, size[1]):
        progress = (y - size[1] // 3) / (size[1] - size[1] // 3)
        alpha = int(200 * progress)
        draw.line([(0, y), (size[0], y)], fill=(0, 0, 0, alpha))

    # Left accent bar
    bar_width = 8
    draw.rectangle([(0, 0), (bar_width, size[1])], fill=(*accent_rgb, 230))

    # Top-left accent corner decoration
    draw.rectangle([(0, 0), (120, 6)], fill=(*accent_rgb, 230))

    # Compose overlay onto image
    img = img.convert("RGBA")
    img = Image.alpha_composite(img, overlay)

    draw = ImageDraw.Draw(img)

    # Draw title (large, bold, uppercase)
    title_font = _load_font(64)
    title_upper = title.upper()

    # Word-wrap title if needed
    title_bbox = draw.textbbox((0, 0), title_upper, font=title_font)
    title_w = title_bbox[2] - title_bbox[0]

    max_text_width = size[0] - 80
    if title_w > max_text_width and " " in title_upper:
        words = title_upper.split()
        mid = len(words) // 2
        line1 = " ".join(words[:mid])
        line2 = " ".join(words[mid:])
        lines = [line1, line2]
    else:
        lines = [title_upper]

    # Position title from bottom
    line_height = 72
    title_y_start = size[1] - 80 - (len(lines) * line_height) - (40 if subtitle else 0)

    for i, line in enumerate(lines):
        y = title_y_start + i * line_height
        # Draw text shadow
        draw.text((42, y + 3), line, fill=(0, 0, 0, 200), font=title_font)
        # Draw text with accent-tinted white
        draw.text((40, y), line, fill="white", font=title_font)

    # Accent underline below title
    underline_y = title_y_start + len(lines) * line_height + 4
    draw.rectangle(
        [(40, underline_y), (40 + min(title_w, max_text_width), underline_y + 4)],
        fill=(*accent_rgb, 220),
    )

    # Draw subtitle
    if subtitle:
        sub_font = _load_font(32)
        sub_y = underline_y + 16
        draw.text((42, sub_y + 2), subtitle, fill=(0, 0, 0, 180), font=sub_font)
        draw.text((40, sub_y), subtitle, fill=(*accent_rgb, 255), font=sub_font)

    # Convert back to RGB and save
    final = img.convert("RGB")
    final.save(output_path, quality=95)
    return output_path
