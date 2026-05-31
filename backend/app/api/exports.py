import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


class CsvExportRequest(BaseModel):
    filename: str = Field(min_length=1)
    content: str
    snapshot: dict[str, Any] | None = None


def exports_dir() -> Path:
    configured = os.getenv("KOREANSIM_EXPORTS_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[3] / "exports"


def safe_csv_filename(filename: str) -> str:
    name = Path(filename.replace("\\", "/")).name.strip()
    if not name:
        name = "experiment"
    if name.lower().endswith(".csv"):
        name = name[:-4]
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", name).strip(" ._")
    if not name:
        name = "experiment"
    return f"{name}.csv"


def unique_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    index = 2
    while True:
        next_candidate = directory / f"{stem}_{index}{suffix}"
        if not next_candidate.exists():
            return next_candidate
        index += 1


def resolve_existing_csv(filename: str) -> Path:
    if "/" in filename or "\\" in filename or ".." in Path(filename).parts:
        raise HTTPException(status_code=400, detail="Invalid export filename.")
    safe_name = safe_csv_filename(filename)
    path = exports_dir() / safe_name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="CSV export not found.")
    return path


@router.post("/exports/csv")
def save_csv_export(request: CsvExportRequest):
    directory = exports_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = unique_path(directory, safe_csv_filename(request.filename))
    encoded = request.content.encode("utf-8-sig")
    path.write_bytes(encoded)
    if request.snapshot is not None:
        sidecar = path.with_suffix(".json")
        sidecar.write_text(json.dumps(request.snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "filename": path.name,
        "path": f"exports/{path.name}",
        "bytes": len(encoded),
    }


@router.get("/exports/csv")
def list_csv_exports():
    directory = exports_dir()
    if not directory.exists():
        return {"items": []}
    items = []
    for path in sorted(directory.glob("*.csv"), key=lambda item: (item.stat().st_mtime, item.name), reverse=True):
        items.append(
            {
                "filename": path.name,
                "path": f"exports/{path.name}",
                "bytes": path.stat().st_size,
                "modified_at": path.stat().st_mtime,
                "has_snapshot": path.with_suffix(".json").exists(),
            }
        )
    return {"items": items}


@router.get("/exports/csv/{filename:path}")
def load_csv_export(filename: str):
    path = resolve_existing_csv(filename)
    snapshot = None
    sidecar = path.with_suffix(".json")
    if sidecar.exists():
        try:
            snapshot = json.loads(sidecar.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            snapshot = None
    return {
        "filename": path.name,
        "content": path.read_text(encoding="utf-8-sig"),
        "snapshot": snapshot,
    }
