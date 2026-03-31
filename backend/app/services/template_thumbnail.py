"""Template-based episode thumbnail compositor.

Replicates the govai.fm thumbnail style:
  - Fixed background (futuristic city skyline)
  - Host photo (bg removed) on the LEFT  — exactly SLOT_W × SLOT_H
  - Guest photo (bg removed) on the RIGHT — exactly SLOT_W × SLOT_H
  - govai.fm logo centered at top
  - Title line in white bold (center-bottom)
  - Subtitle line in cyan bold
  - "With [guest] & [host]" pill bar at very bottom
"""
from __future__ import annotations

import threading
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ─────────────────────────────────────────────────────────────────────────────
# Module-level caches  (thread-safe)
# ─────────────────────────────────────────────────────────────────────────────

_rembg_lock = threading.Lock()
_rembg_session = None                          # loaded once, reused
_bg_removed_cache: dict[str, Image.Image] = {} # path → processed RGBA image


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ]:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _remove_background(photo_path: str) -> Image.Image:
    """Remove background from photo using rembg.

    - Results are cached per path (rembg runs only once per unique photo).
    - Upscales tiny photos to MIN_DIM=512 before rembg for better edge detection.
    - Does NOT resize back to original — keeps at rembg-processed size for quality.
    - Alpha edges are cleaned with a MinFilter erosion + GaussianBlur pass.
    - Falls back to the (upscaled) original if rembg is unavailable or fails.
    """
    global _rembg_session

    with _rembg_lock:
        if photo_path in _bg_removed_cache:
            return _bg_removed_cache[photo_path].copy()

    img = Image.open(photo_path).convert("RGBA")

    # Upscale tiny photos before rembg for better edge detection
    MIN_DIM = 512
    if img.width < MIN_DIM or img.height < MIN_DIM:
        scale = max(MIN_DIM / img.width, MIN_DIM / img.height)
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)

    try:
        from rembg import remove, new_session  # type: ignore

        with _rembg_lock:
            if _rembg_session is None:
                _rembg_session = new_session()
            session = _rembg_session

        # Pass the (possibly upscaled) image bytes to rembg
        buf = BytesIO()
        img.save(buf, format="PNG")
        raw = remove(buf.getvalue(), session=session)

        processed = Image.open(BytesIO(raw)).convert("RGBA")
        # Keep at rembg-processed size — do NOT resize back to the tiny original

        # Light alpha-channel erosion to strip halo/fringe pixels
        r, g, b, a = processed.split()
        a_clean = a.filter(ImageFilter.MinFilter(3))   # shrink mask by 1-2px
        a_clean = a_clean.filter(ImageFilter.GaussianBlur(1))  # smooth edges
        processed = Image.merge("RGBA", (r, g, b, a_clean))

    except Exception as e:
        print(f"[rembg] Background removal failed for {photo_path}: {e} — using original")
        processed = img

    with _rembg_lock:
        _bg_removed_cache[photo_path] = processed

    return processed.copy()


def _fit_photo(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Scale photo to CONTAIN within target_w × target_h (aspect preserved).

    Returns an RGBA image of EXACTLY target_w × target_h with the person
    bottom-centered on a transparent canvas.  Because both host and guest use
    the same target dimensions, they are always equal in size on the canvas.
    """
    # Scale to fit entirely within the target box (no cropping, no distortion)
    scale = min(target_w / img.width, target_h / img.height)
    new_w = max(1, int(img.width * scale))
    new_h = max(1, int(img.height * scale))
    img = img.resize((new_w, new_h), Image.LANCZOS)

    # Transparent canvas of the exact target size
    box = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    # Bottom-aligned, horizontally centered within the slot
    x = (target_w - new_w) // 2
    y = target_h - new_h
    box.paste(img, (x, y), img)
    return box


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
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
            current = word
    if current:
        lines.append(current)
    return lines


def _create_dark_gradient(W: int, H: int) -> Image.Image:
    """Fallback dark blue gradient if no bg_template is found."""
    bg = Image.new("RGBA", (W, H))
    draw = ImageDraw.Draw(bg)
    for y in range(H):
        p = y / H
        draw.line([(0, y), (W, y)], fill=(int(5 + 10 * p), int(15 + 35 * p), int(50 + 60 * p), 255))
    return bg


# ─────────────────────────────────────────────────────────────────────────────
# Main compositor
# ─────────────────────────────────────────────────────────────────────────────

def create_episode_thumbnail(
    output_path: str,
    title: str,
    subtitle: str,
    guest_name: str,
    host_name: str = "Girish Limaye",
    host_photo_path: str | None = None,
    guest_photo_path: str | None = None,
    bg_template_path: str | None = None,
    logo_path: str | None = None,
    size: tuple[int, int] = (1920, 1080),
) -> str:
    """Compose a govai.fm-style episode thumbnail.

    Layout (1920×1080):
        Left  slot  : x 0    → 806  (42% of W)  — host
        Centre gap  : x 806  → 1114 (16% of W)  — logo + text
        Right slot  : x 1114 → 1920 (42% of W)  — guest

    Both photos are scaled to CONTAIN within a SLOT_W × SLOT_H transparent box,
    bottom-centered, so they are always equal in width and height on the canvas.
    """
    W, H = size

    # Per-slot dimensions — each person gets 42% of canvas width
    SLOT_W = int(W * 0.42)   # 806 px at 1920
    SLOT_H = int(H * 0.95)   # 1026 px at 1080

    # ── 1. Background ────────────────────────────────────────────────────────
    if bg_template_path and Path(bg_template_path).exists():
        bg = Image.open(bg_template_path).convert("RGBA").resize((W, H), Image.LANCZOS)
    else:
        bg = _create_dark_gradient(W, H)

    canvas = bg.copy()

    # ── 2. Host photo — left slot ─────────────────────────────────────────────
    if host_photo_path and Path(host_photo_path).exists():
        host = _remove_background(host_photo_path)
        host = _fit_photo(host, SLOT_W, SLOT_H)        # exactly SLOT_W × SLOT_H
        # Anchor: bottom-left corner, 5% bleed off the left edge
        x = -int(SLOT_W * 0.05)
        y = H - SLOT_H
        canvas.paste(host, (x, y), host)
        print(f"[thumbnail] host placed at x={x}, y={y}, slot=({SLOT_W}×{SLOT_H})")

    # ── 3. Guest photo — right slot ───────────────────────────────────────────
    if guest_photo_path and Path(guest_photo_path).exists():
        guest = _remove_background(guest_photo_path)
        guest = _fit_photo(guest, SLOT_W, SLOT_H)      # exactly SLOT_W × SLOT_H
        # Anchor: bottom-right corner, 5% bleed off the right edge
        x = W - SLOT_W + int(SLOT_W * 0.05)
        y = H - SLOT_H
        canvas.paste(guest, (x, y), guest)
        print(f"[thumbnail] guest placed at x={x}, y={y}, slot=({SLOT_W}×{SLOT_H})")

    # ── 4. Logo — center top ──────────────────────────────────────────────────
    # Only paste logo.png when using the gradient fallback background.
    # If a bg_template is used it already has the logo baked in.
    using_bg_template = bool(bg_template_path and Path(bg_template_path).exists())
    if not using_bg_template and logo_path and Path(logo_path).exists():
        logo = Image.open(logo_path).convert("RGBA")
        logo_target_w = int(W * 0.20)
        scale = logo_target_w / logo.width
        logo = logo.resize((logo_target_w, int(logo.height * scale)), Image.LANCZOS)
        canvas.paste(logo, ((W - logo.width) // 2, 28), logo)

    # ── 5. Smooth dark gradient — bottom 50% of canvas ───────────────────────
    gradient_h = int(H * 0.50)
    gradient_img = Image.new("RGBA", (W, gradient_h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gradient_img)
    for y in range(gradient_h):
        alpha = int(215 * (y / gradient_h))
        gd.line([(0, y), (W, y)], fill=(0, 0, 0, alpha))
    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.paste(gradient_img, (0, H - gradient_h), gradient_img)
    final = canvas_rgba.convert("RGB")
    draw = ImageDraw.Draw(final)

    # ── 6. Font sizing ────────────────────────────────────────────────────────
    max_text_w = int(W * 0.65)

    title_font_size = 110
    while title_font_size >= 60:
        title_font = _load_font(title_font_size)
        title_lines = _wrap_text(draw, title, title_font, max_text_w)
        if len(title_lines) <= 2:
            break
        title_font_size -= 4
    title_font = _load_font(title_font_size)
    title_line_h = title_font_size + 16
    title_lines = _wrap_text(draw, title, title_font, max_text_w)

    sub_font_size = 80
    while sub_font_size >= 48:
        sub_font = _load_font(sub_font_size)
        sub_lines = _wrap_text(draw, subtitle, sub_font, max_text_w)
        if len(sub_lines) <= 3:
            break
        sub_font_size -= 4
    sub_font = _load_font(sub_font_size)
    sub_line_h = sub_font_size + 12
    sub_lines = _wrap_text(draw, subtitle, sub_font, max_text_w)

    bar_font = _load_font(44)
    pad_x, pad_y = 48, 16
    bar_h = 44 + pad_y * 2
    names_text = f"With {guest_name} & {host_name}"
    names_w = int(draw.textlength(names_text, font=bar_font))
    bar_w = names_w + pad_x * 2

    # ── 7. Position text bottom-up (pill → subtitle → title) ─────────────────
    bar_y   = H - bar_h - 28
    sub_y   = bar_y - len(sub_lines) * sub_line_h - 20
    title_y = sub_y - len(title_lines) * title_line_h - 14

    # ── 8. Title (white, bold) ────────────────────────────────────────────────
    for i, line in enumerate(title_lines):
        lw = int(draw.textlength(line, font=title_font))
        x = (W - lw) // 2
        y = title_y + i * title_line_h
        draw.text((x + 3, y + 3), line, fill=(0, 0, 0), font=title_font)
        draw.text((x, y), line, fill=(255, 255, 255), font=title_font)

    # ── 9. Subtitle (cyan, bold) ──────────────────────────────────────────────
    CYAN = (0, 229, 255)
    for i, line in enumerate(sub_lines):
        lw = int(draw.textlength(line, font=sub_font))
        x = (W - lw) // 2
        y = sub_y + i * sub_line_h
        draw.text((x + 2, y + 2), line, fill=(0, 0, 0), font=sub_font)
        draw.text((x, y), line, fill=CYAN, font=sub_font)

    # ── 10. Names pill bar ────────────────────────────────────────────────────
    bar_x = (W - bar_w) // 2
    bar_overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bar_draw = ImageDraw.Draw(bar_overlay)
    bar_draw.rounded_rectangle(
        [(bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h)],
        radius=10,
        fill=(215, 215, 215, 210),
    )
    final_rgba = final.convert("RGBA")
    final_rgba = Image.alpha_composite(final_rgba, bar_overlay)
    final = final_rgba.convert("RGB")
    draw = ImageDraw.Draw(final)
    draw.text((bar_x + pad_x, bar_y + pad_y), names_text, fill=(20, 20, 20), font=bar_font)

    # ── 11. Save ──────────────────────────────────────────────────────────────
    final.save(output_path, "JPEG", quality=95)
    return output_path
