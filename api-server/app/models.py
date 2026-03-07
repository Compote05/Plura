from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Enums ────────────────────────────────────────────────────────────────────


class ExtractionMethod(str, Enum):
    NATIVE = "native"
    OCR = "ocr"


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


# ── Internal data ────────────────────────────────────────────────────────────


class PageContent(BaseModel):
    page_number: int
    text: str
    extraction_method: ExtractionMethod
    has_tables: bool = False
    tables_markdown: str = ""


class Chunk(BaseModel):
    id: str
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


# ── API request / response ───────────────────────────────────────────────────


class DocumentUploadResponse(BaseModel):
    task_id: str
    status: TaskStatus
    filename: str
    message: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: TaskStatus
    filename: str
    document_id: Optional[str] = None
    chunks_created: int = 0
    error: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class HealthResponse(BaseModel):
    status: str
    ollama: bool
    models: dict[str, bool]
    supabase: bool
    version: str
