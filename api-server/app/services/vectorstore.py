from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.models import Chunk
from app.services.embedder import EmbeddingService

logger = logging.getLogger(__name__)


class VectorStoreService:
    """Supabase pgvector store — uses PostgREST + RPC for similarity search."""

    def __init__(self, embedder: EmbeddingService):
        self.embedder = embedder
        self._headers = {
            "apikey": settings.supabase_key,
            "Authorization": f"Bearer {settings.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self._base = settings.supabase_url

    def _url(self, path: str) -> str:
        return f"{self._base}/rest/v1/{path}"

    # ── Documents ─────────────────────────────────────────────────────────

    async def create_document(
        self,
        user_id: str,
        filename: str,
        storage_path: str,
        size: int,
        content_type: str,
        extracted_text: str | None = None,
    ) -> str:
        """Insert a document row and return its UUID."""
        payload = {
            "user_id": user_id,
            "filename": filename,
            "storage_path": storage_path,
            "size": size,
            "content_type": content_type,
        }
        if extracted_text:
            payload["extracted_text"] = extracted_text

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                self._url("documents"),
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()[0]["id"]

    # ── Chunks ────────────────────────────────────────────────────────────

    async def add_chunks(
        self,
        chunks: list[Chunk],
        document_id: str,
    ) -> int:
        if not chunks:
            return 0

        texts = [c.text for c in chunks]
        embeddings = await self.embedder.embed_batch_concurrent(texts)

        rows = [
            {
                "document_id": document_id,
                "content": chunk.text,
                "embedding": emb,
            }
            for chunk, emb in zip(chunks, embeddings)
        ]

        # Insert in batches of 100
        inserted = 0
        async with httpx.AsyncClient(timeout=60) as client:
            for i in range(0, len(rows), 100):
                batch = rows[i : i + 100]
                resp = await client.post(
                    self._url("document_chunks"),
                    headers=self._headers,
                    json=batch,
                )
                resp.raise_for_status()
                inserted += len(batch)

        logger.info("Indexed %d chunks for document %s", inserted, document_id)
        return inserted

    # ── Document queries ──────────────────────────────────────────────────

    async def get_document(self, document_id: str) -> dict | None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                self._url("documents"),
                headers=self._headers,
                params={"id": f"eq.{document_id}", "select": "*"},
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def list_documents(self, user_id: str) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                self._url("documents"),
                headers=self._headers,
                params={
                    "user_id": f"eq.{user_id}",
                    "select": "id,filename,size,content_type,created_at",
                    "order": "created_at.desc",
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def delete_document(self, document_id: str) -> None:
        """Delete document and its chunks (CASCADE)."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                self._url("documents"),
                headers=self._headers,
                params={"id": f"eq.{document_id}"},
            )
            resp.raise_for_status()
        logger.info("Deleted document %s", document_id)

