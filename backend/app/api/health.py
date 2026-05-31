from fastapi import APIRouter

from app.services.persona_repository import dataset_status

router = APIRouter()


@router.get("/healthz")
def healthz() -> dict:
    status = dataset_status()
    return {
        "status": "ok" if status["available"] else "degraded",
        "dataset_loaded": status["loaded"],
        "dataset_available": status["available"],
        "dataset_rows": status["rows"],
    }
