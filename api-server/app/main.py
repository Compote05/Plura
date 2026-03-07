from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import dependencies as deps
from app.config import settings
from app.models import HealthResponse
from app.routers import documents
from app.services.chunker import ChunkingService
from app.services.embedder import EmbeddingService
from app.services.ocr import OCRService
from app.services.pipeline import DocumentPipeline
from app.services.vectorstore import VectorStoreService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing services...")
    deps.ocr_service = OCRService()
    deps.embedding_service = EmbeddingService()
    deps.vectorstore_service = VectorStoreService(deps.embedding_service)
    deps.chunking_service = ChunkingService()
    deps.document_pipeline = DocumentPipeline(
        ocr=deps.ocr_service,
        embedder=deps.embedding_service,
        vectorstore=deps.vectorstore_service,
        chunker=deps.chunking_service,
    )
    logger.info("Services ready.")
    yield
    # Shutdown
    logger.info("Shutting down services...")
    await deps.ocr_service.close()
    await deps.embedding_service.close()
    logger.info("Shutdown complete.")


app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# Routers
app.include_router(documents.router)


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health_check() -> HealthResponse:
    """System health check — verifies Ollama connectivity and model availability."""
    ollama_ok = False
    models_status: dict[str, bool] = {}
    supabase_ok = False

    # Check Ollama
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.ollama_url}/api/tags")
            if resp.status_code == 200:
                ollama_ok = True
                available = [m["name"] for m in resp.json().get("models", [])]
                models_status[settings.ocr_model] = settings.ocr_model in available
                models_status[settings.embedding_model] = settings.embedding_model in available
    except Exception:
        pass

    # Check Supabase
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{settings.supabase_url}/rest/v1/",
                headers={
                    "apikey": settings.supabase_key,
                    "Authorization": f"Bearer {settings.supabase_key}",
                },
            )
            supabase_ok = resp.status_code == 200
    except Exception:
        pass

    all_ok = ollama_ok and all(models_status.values()) and supabase_ok

    return HealthResponse(
        status="ok" if all_ok else "degraded",
        ollama=ollama_ok,
        models=models_status,
        supabase=supabase_ok,
        version=settings.api_version,
    )


@app.get("/", tags=["system"])
async def root():
    return {
        "name": settings.api_title,
        "version": settings.api_version,
        "docs": "/docs",
    }
