from __future__ import annotations

import base64
import io
import logging

import httpx
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)


class OCRService:
    """GLM-OCR via Ollama — text, table, and figure recognition."""

    def __init__(self, ollama_url: str | None = None, model: str | None = None):
        self.ollama_url = ollama_url or settings.ollama_url
        self.model = model or settings.ocr_model
        self._client = httpx.AsyncClient(base_url=self.ollama_url, timeout=300)

    async def close(self) -> None:
        await self._client.aclose()

    # ── public ───────────────────────────────────────────────────────────────

    async def recognize_text(self, image: Image.Image) -> str:
        return await self._call(image, settings.ocr_text_prompt)

    async def recognize_table(self, image: Image.Image) -> str:
        return await self._call(image, settings.ocr_table_prompt)

    async def recognize_all(self, image: Image.Image) -> str:
        """Run text + table recognition and merge results."""
        text = await self.recognize_text(image)
        tables = await self.recognize_table(image)
        parts = [p for p in (text, tables) if p.strip()]
        return "\n\n".join(parts)

    # ── private ──────────────────────────────────────────────────────────────

    async def _call(self, image: Image.Image, prompt: str) -> str:
        img_b64 = self._encode(image)
        payload = {
            "model": self.model,
            "prompt": prompt,
            "images": [img_b64],
            "stream": False,
            "options": {"temperature": 0.1},
        }
        resp = await self._client.post("/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "").strip()

    @staticmethod
    def _encode(image: Image.Image, max_size: int = 1024) -> str:
        # Resize if larger than max_size to speed up OCR
        if max(image.size) > max_size:
            image = image.copy()
            image.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
