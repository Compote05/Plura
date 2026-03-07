from __future__ import annotations

import logging
from typing import Sequence

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Qwen3-Embedding via Ollama. Auto-detects /api/embed vs /api/embeddings."""

    def __init__(self, ollama_url: str | None = None, model: str | None = None):
        self.ollama_url = ollama_url or settings.ollama_url
        self.model = model or settings.embedding_model
        self._client = httpx.AsyncClient(base_url=self.ollama_url, timeout=120)
        self._endpoint: str | None = None  # resolved on first call

    async def close(self) -> None:
        await self._client.aclose()

    async def _resolve_endpoint(self) -> None:
        """Detect which embedding endpoint Ollama supports."""
        try:
            resp = await self._client.post(
                "/api/embed",
                json={"model": self.model, "input": "test"},
            )
            if resp.status_code != 404:
                self._endpoint = "/api/embed"
                logger.info("Using Ollama /api/embed endpoint")
                return
        except Exception:
            pass
        self._endpoint = "/api/embeddings"
        logger.info("Using Ollama /api/embeddings endpoint (legacy)")

    async def _call(self, text: str) -> list[float]:
        if self._endpoint is None:
            await self._resolve_endpoint()

        if self._endpoint == "/api/embed":
            payload = {"model": self.model, "input": text}
        else:
            payload = {"model": self.model, "prompt": text}

        resp = await self._client.post(self._endpoint, json=payload)
        resp.raise_for_status()
        data = resp.json()

        # /api/embed returns {"embeddings": [[...]]}
        # /api/embeddings returns {"embedding": [...]}
        embeddings = data.get("embeddings", [])
        if embeddings:
            return embeddings[0]
        return data.get("embedding", [])

    async def embed(self, text: str) -> list[float]:
        return await self._call(text)

    async def embed_batch(self, texts: Sequence[str]) -> list[list[float]]:
        results: list[list[float]] = []
        for text in texts:
            results.append(await self._call(text))
        return results

    async def embed_batch_concurrent(
        self, texts: Sequence[str], max_concurrency: int = 4
    ) -> list[list[float]]:
        import asyncio

        sem = asyncio.Semaphore(max_concurrency)
        results: list[list[float]] = [[] for _ in texts]

        async def _embed_one(idx: int, text: str) -> None:
            async with sem:
                results[idx] = await self._call(text)

        await asyncio.gather(*[_embed_one(i, t) for i, t in enumerate(texts)])
        return results
