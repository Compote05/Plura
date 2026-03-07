from __future__ import annotations

import hashlib
import re
from typing import Optional

from app.config import settings
from app.models import Chunk


class ChunkingService:
    """
    Semantic chunking with multi-level strategy:
      1. Split by Markdown sections (## / ###)
      2. If section too long, split by paragraphs and merge
      3. If paragraph too long, sliding window with overlap
    """

    def __init__(
        self,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
        min_chunk_size: int | None = None,
    ):
        self.chunk_size = chunk_size or settings.chunk_size
        self.chunk_overlap = chunk_overlap or settings.chunk_overlap
        self.min_chunk_size = min_chunk_size or settings.min_chunk_size

    def chunk(
        self,
        text: str,
        source: str,
        extra_metadata: Optional[dict] = None,
    ) -> list[Chunk]:
        sections = self._split_by_sections(text)
        # Merge small leading section into the next one
        if (
            len(sections) > 1
            and len(sections[0][1].split()) < self.min_chunk_size
        ):
            intro_title, intro_text = sections[0]
            next_title, next_text = sections[1]
            sections[1] = (next_title, intro_text + "\n\n" + next_text)
            sections = sections[1:]

        chunks: list[Chunk] = []

        for section_title, section_text in sections:
            section_chunks = self._chunk_section(section_text)

            for i, chunk_text in enumerate(section_chunks):
                if len(chunk_text.split()) < self.min_chunk_size:
                    continue

                chunk_id = _make_id(source, section_title, i)
                meta = {"source": source, "section": section_title, "chunk_index": i}
                if extra_metadata:
                    meta.update(extra_metadata)

                page_match = re.search(r"Page (\d+)", section_title)
                if page_match:
                    meta["page"] = int(page_match.group(1))

                chunks.append(Chunk(id=chunk_id, text=chunk_text, metadata=meta))

        return chunks

    def _split_by_sections(self, text: str) -> list[tuple[str, str]]:
        pattern = r"^(#{1,3})\s+(.+)$"
        lines = text.split("\n")
        sections: list[tuple[str, str]] = []
        current_title = "Introduction"
        current_lines: list[str] = []

        for line in lines:
            match = re.match(pattern, line)
            if match:
                if current_lines:
                    content = "\n".join(current_lines).strip()
                    if content:
                        sections.append((current_title, content))
                current_title = match.group(2).strip()
                current_lines = []
            else:
                current_lines.append(line)

        if current_lines:
            content = "\n".join(current_lines).strip()
            if content:
                sections.append((current_title, content))

        return sections if sections else [("Document", text)]

    def _chunk_section(self, text: str) -> list[str]:
        words = text.split()
        if len(words) <= self.chunk_size:
            return [text]

        paragraphs = re.split(r"\n\s*\n", text)
        if len(paragraphs) > 1:
            return self._merge_paragraphs(paragraphs)

        return self._sliding_window(text)

    def _merge_paragraphs(self, paragraphs: list[str]) -> list[str]:
        chunks: list[str] = []
        current_chunk: list[str] = []
        current_size = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            para_size = len(para.split())

            if current_size + para_size > self.chunk_size and current_chunk:
                chunks.append("\n\n".join(current_chunk))
                overlap_text = current_chunk[-1] if current_chunk else ""
                current_chunk = [overlap_text] if overlap_text else []
                current_size = len(overlap_text.split())

            current_chunk.append(para)
            current_size += para_size

        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return chunks

    def _sliding_window(self, text: str) -> list[str]:
        words = text.split()
        chunks: list[str] = []
        step = max(self.chunk_size - self.chunk_overlap, self.chunk_size // 2)

        for start in range(0, len(words), step):
            end = start + self.chunk_size
            chunks.append(" ".join(words[start:end]))
            if end >= len(words):
                break

        return chunks


def _make_id(source: str, section: str, index: int) -> str:
    raw = f"{source}::{section}::{index}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]
