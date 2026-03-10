"""Default asset management — intro/outro videos, host photo, logo, background template."""
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import settings

router = APIRouter()

# Canonical filenames for each named asset
ASSET_MAP: dict[str, str] = {
    "intro":       "intro.mp4",
    "outro":       "outro.mp4",
    "host_photo":  "host.png",
    "bg_template": "bg_template.png",
    "logo":        "logo.png",
}

ALLOWED_EXTS: dict[str, set[str]] = {
    "intro":       {".mp4", ".mov", ".avi", ".mkv", ".webm"},
    "outro":       {".mp4", ".mov", ".avi", ".mkv", ".webm"},
    "host_photo":  {".jpg", ".jpeg", ".png", ".webp"},
    "bg_template": {".jpg", ".jpeg", ".png", ".webp"},
    "logo":        {".jpg", ".jpeg", ".png", ".webp"},
}


def _asset_path(name: str) -> Path:
    return settings.assets_path / ASSET_MAP[name]


@router.get("/api/assets")
async def list_assets():
    """Return which default assets are present."""
    settings.assets_path.mkdir(parents=True, exist_ok=True)
    return {
        name: {
            "present": _asset_path(name).exists(),
            "filename": ASSET_MAP[name],
        }
        for name in ASSET_MAP
    }


@router.post("/api/assets/{name}")
async def upload_asset(name: str, file: UploadFile = File(...)):
    """Upload or replace a default asset."""
    if name not in ASSET_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown asset '{name}'. Valid: {list(ASSET_MAP)}")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS[name]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid extension '{ext}' for '{name}'. Allowed: {ALLOWED_EXTS[name]}",
        )

    settings.assets_path.mkdir(parents=True, exist_ok=True)
    dest = _asset_path(name)

    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    return {"ok": True, "name": name, "saved_as": ASSET_MAP[name]}


@router.delete("/api/assets/{name}")
async def delete_asset(name: str):
    """Remove a default asset."""
    if name not in ASSET_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown asset '{name}'")
    path = _asset_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Asset '{name}' not found")
    path.unlink()
    return {"ok": True, "name": name}
