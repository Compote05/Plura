from __future__ import annotations

from app.services.chunker import ChunkingService
from app.services.embedder import EmbeddingService
from app.services.ocr import OCRService
from app.services.pipeline import DocumentPipeline
from app.services.vectorstore import VectorStoreService

# Singleton instances — initialized in lifespan
ocr_service: OCRService | None = None
embedding_service: EmbeddingService | None = None
vectorstore_service: VectorStoreService | None = None
chunking_service: ChunkingService | None = None
document_pipeline: DocumentPipeline | None = None


def get_vectorstore() -> VectorStoreService:
    assert vectorstore_service is not None
    return vectorstore_service


def get_pipeline() -> DocumentPipeline:
    assert document_pipeline is not None
    return document_pipeline
