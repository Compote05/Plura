from __future__ import annotations

import logging
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile

from app.auth import AuthenticatedUser, get_current_user, rate_limit
from app.config import settings
from app.dependencies import get_pipeline, get_vectorstore
from app.models import DocumentUploadResponse, TaskStatus, TaskStatusResponse
from app.services.extractor import DocumentExtractor
from app.services.pipeline import DocumentPipeline
from app.services.vectorstore import VectorStoreService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["documents"])

# In-memory task registry
_tasks: dict[str, TaskStatusResponse] = {}


@router.post(
    "/documents",
    response_model=DocumentUploadResponse,
    dependencies=[Depends(rate_limit(max_requests=settings.rate_limit_upload))],
)
async def upload_document(
    file: UploadFile,
    user: AuthenticatedUser = Depends(get_current_user),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    pipeline: DocumentPipeline = Depends(get_pipeline),
) -> DocumentUploadResponse:
    """Upload a document for processing and indexing."""
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()

    if ext not in DocumentExtractor.SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Supported: {sorted(DocumentExtractor.SUPPORTED_EXTENSIONS)}",
        )

    # Check file size
    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max {settings.max_upload_size_mb}MB.",
        )

    task_id = uuid.uuid4().hex[:12]

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    tmp.write(content)
    tmp.close()

    _tasks[task_id] = TaskStatusResponse(
        task_id=task_id,
        status=TaskStatus.QUEUED,
        filename=filename,
        created_at=datetime.now(timezone.utc),
    )

    background_tasks.add_task(
        _process_document, task_id, Path(tmp.name), user.id, pipeline, filename
    )

    return DocumentUploadResponse(
        task_id=task_id,
        status=TaskStatus.QUEUED,
        filename=filename,
        message="Document queued for processing.",
    )


@router.get("/documents/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(
    task_id: str,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> TaskStatusResponse:
    """Check the processing status of a document."""
    if task_id not in _tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return _tasks[task_id]


@router.get("/documents/tasks", response_model=list[TaskStatusResponse])
async def list_tasks(
    _user: AuthenticatedUser = Depends(get_current_user),
) -> list[TaskStatusResponse]:
    """List all processing tasks."""
    return sorted(_tasks.values(), key=lambda t: t.created_at, reverse=True)


@router.get("/documents")
async def list_documents(
    user: AuthenticatedUser = Depends(get_current_user),
    store: VectorStoreService = Depends(get_vectorstore),
) -> list[dict]:
    """List all documents for the authenticated user."""
    return await store.list_documents(user.id)


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    store: VectorStoreService = Depends(get_vectorstore),
) -> dict:
    """Delete a document and all its chunks."""
    # Verify ownership
    doc = await store.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc["user_id"] != user.id:
        raise HTTPException(status_code=403, detail="Not your document")

    await store.delete_document(document_id)
    return {"message": f"Document {document_id} deleted."}


@router.post("/documents/preview")
async def preview_document(
    file: UploadFile,
    _user: AuthenticatedUser = Depends(get_current_user),
    pipeline: DocumentPipeline = Depends(get_pipeline),
) -> dict:
    """Extract and chunk a document without embedding — for debugging."""
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()

    if ext not in DocumentExtractor.SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'.",
        )

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    content = await file.read()
    tmp.write(content)
    tmp.close()

    try:
        result = await pipeline.preview_file(Path(tmp.name), original_name=filename)
        result["filename"] = filename
        return result
    finally:
        Path(tmp.name).unlink(missing_ok=True)


async def _process_document(
    task_id: str,
    file_path: Path,
    user_id: str,
    pipeline: DocumentPipeline,
    original_name: str = "",
) -> None:
    task = _tasks[task_id]
    task.status = TaskStatus.RUNNING

    try:
        result = await pipeline.process_file(
            file_path, user_id=user_id, original_name=original_name
        )
        task.document_id = result["document_id"]
        task.chunks_created = result["chunks_created"]
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.now(timezone.utc)
        logger.info(
            "Task %s completed: %d chunks, doc %s",
            task_id,
            result["chunks_created"],
            result["document_id"],
        )
    except Exception as exc:
        task.status = TaskStatus.FAILED
        task.error = str(exc)
        task.completed_at = datetime.now(timezone.utc)
        logger.exception("Task %s failed", task_id)
    finally:
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
