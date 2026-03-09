from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arialbd.ttf",
    ]
    for path in font_paths:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _circular_photo(photo_path: str, size: int, feather: int = 15) -> Image.Image:
    """Load a photo, crop to square, resize, apply circular mask with soft edge."""
    img = Image.open(photo_path).convert("RGBA")

    # Crop to square from center
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    img = img.resize((size, size), Image.LANCZOS)

    # Create circular mask
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)

    # Feather the edge by blurring the mask
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))

    img.putalpha(mask)
    return img


def compose_thumbnail(
    background_path: str,
    output_path: str,
    title: str,
    subtitle: str = "",
    host_photo_path: str | None = None,
    guest_photo_path: str | None = None,
    accent_color: str = "#8B5CF6",
    size: tuple[int, int] = (1280, 720),
) -> str:
    """Compose a professional thumbnail with DALL-E background, photos, and title.

    Layout:
    - Background: full 1280x720 DALL-E generated image
    - Left column: host photo (top), guest photo (below), both circular
    - Bottom strip: dark gradient overlay
    - Title: auto-sized to never overflow, max 2 lines
    - Subtitle: accent color below title

    Returns:
        output_path
    """
    W, H = size
    accent_rgb = _hex_to_rgb(accent_color)

    # 1. Load + resize background
    bg = Image.open(background_path).convert("RGBA")
    bg = bg.resize((W, H), Image.LANCZOS)
    canvas = bg.copy()

    # 2. Paste host photo (circular) at left edge
    photo_size = 180
    photo_x = 30
    center_y = H // 2

    if host_photo_path and Path(host_photo_path).exists():
        host_img = _circular_photo(host_photo_path, photo_size, feather=12)
        host_y = center_y - photo_size - 10
        canvas.paste(host_img, (photo_x, host_y), host_img)

    if guest_photo_path and Path(guest_photo_path).exists():
        guest_img = _circular_photo(guest_photo_path, photo_size, feather=12)
        guest_y = center_y + 10
        canvas.paste(guest_img, (photo_x, guest_y), guest_img)

    # 3. Dark gradient overlay over bottom 220px
    gradient_height = 220
    gradient = Image.new("RGBA", (W, gradient_height), (0, 0, 0, 0))
    for y in range(gradient_height):
        alpha = int(210 * (y / gradient_height))
        for x in range(W):
            gradient.putpixel((x, y), (0, 0, 0, alpha))
    canvas.paste(gradient, (0, H - gradient_height), gradient)

    # Convert to RGB for drawing
    final = canvas.convert("RGB")
    draw = ImageDraw.Draw(final)

    # 4. Title — auto-size to fit within available width, max 3 lines
    text_x = 250 if (host_photo_path or guest_photo_path) else 40
    max_text_width = W - text_x - 40
    font_size = 56
    total_words = len(title.split())

    # Reduce font size until all words fit within 3 lines
    while font_size >= 20:
        font = _load_font(font_size)
        lines = _wrap_text(draw, title, font, max_text_width, max_lines=3)
        words_fitted = sum(len(line.split()) for line in lines)
        if words_fitted >= total_words:
            break
        font_size -= 4

    lines = _wrap_text(draw, title, _load_font(font_size), max_text_width, max_lines=3)

    line_height = font_size + 8
    total_text_height = len(lines) * line_height
    title_y = H - total_text_height - (60 if subtitle else 20) - 10

    title_font = _load_font(font_size)
    for i, line in enumerate(lines):
        y = title_y + i * line_height
        # Shadow
        draw.text((text_x + 2, y + 2), line, font=title_font, fill=(0, 0, 0, 180))
        draw.text((text_x, y), line, font=title_font, fill=(255, 255, 255))

    # 5. Subtitle
    if subtitle:
        sub_font = _load_font(28)
        sub_y = title_y + total_text_height + 6
        draw.text((text_x + 1, sub_y + 1), subtitle, font=sub_font, fill=(0, 0, 0, 160))
        draw.text((text_x, sub_y), subtitle, font=sub_font, fill=accent_rgb)

    # 6. Save
    final.save(output_path, "JPEG", quality=95)
    return output_path


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
    max_lines: int = 2,
) -> list[str]:
    """Word-wrap text to fit within max_width, returning at most max_lines lines."""
    words = text.split()
    lines: list[str] = []
    current = ""

    for word in words:
        test = (current + " " + word).strip()
        try:
            w = draw.textlength(test, font=font)
        except Exception:
            w = len(test) * (font.size if hasattr(font, "size") else 10)
        if w <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            if len(lines) >= max_lines:
                break
            current = word

    if current and len(lines) < max_lines:
        lines.append(current)

    return lines
