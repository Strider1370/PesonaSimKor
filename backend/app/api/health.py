import httpx
from fastapi import APIRouter

from app.services.llm_client import ollama_host as configured_ollama_host
from app.services.persona_repository import dataset_status

router = APIRouter()


def ollama_reachable(host: str) -> bool:
    try:
        response = httpx.get(host, timeout=2.0)
        return response.status_code < 500
    except Exception:
        return False


@router.get("/healthz")
def healthz() -> dict:
    ollama_host = configured_ollama_host()
    from app.services.llm_client import ollama_model

    model = ollama_model()
    status = dataset_status()
    return {
        "status": "ok" if status["available"] else "degraded",
        "ollama_host": ollama_host,
        "ollama_model": model,
        "ollama_reachable": ollama_reachable(ollama_host),
        "dataset_loaded": status["loaded"],
        "dataset_available": status["available"],
        "dataset_rows": status["rows"],
    }
