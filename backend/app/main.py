import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.exports import router as exports_router
from app.api.simulate import router as simulate_router
from app.config.env import load_backend_environment
from app.services.persona_repository import parquet_row_groups

load_backend_environment()


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=parquet_row_groups, daemon=True).start()
    yield


app = FastAPI(title="KoreanSim", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(exports_router, prefix="/api")
app.include_router(simulate_router, prefix="/api")
