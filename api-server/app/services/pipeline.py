from __future__ import annotations

import logging
import re
from pathlib import Path

from app.models import PageContent
from app.services.chunker import ChunkingService
from app.services.embedder import EmbeddingService
from app.services.extractor import DocumentExtractor
from app.services.ocr import OCRService
from app.services.vectorstore import VectorStoreService

logger = logging.getLogger(__name__)


class DocumentPipeline:
    """Orchestrates: extract -> structure -> chunk -> embed -> store."""

    def __init__(
        self,
        ocr: OCRService,
        embedder: EmbeddingService,
        vectorstore: VectorStoreService,
        chunker: ChunkingService,
    ):
        self.extractor = DocumentExtractor(ocr)
        self.chunker = chunker
        self.embedder = embedder
        self.vectorstore = vectorstore

    async def process_file(
        self,
        file_path: Path,
        user_id: str,
        original_name: str | None = None,
    ) -> dict:
        """Full pipeline. Returns {document_id, chunks_created}."""
        source_name = original_name or file_path.stem
        if original_name and "." in source_name:
            source_name = Path(source_name).stem
        logger.info("Processing %s", source_name)

        # 1. Extract
        pages = await self.extractor.extract(file_path)
        pages = [_clean_page(p) for p in pages]
        logger.info(
            "Extracted %d pages (%d native, %d ocr)",
            len(pages),
            sum(1 for p in pages if p.extraction_method == "native"),
            sum(1 for p in pages if p.extraction_method == "ocr"),
        )

        # 2. Structure as markdown
        markdown = _structure(pages, source_name)

        # 3. Chunk
        filename = f"{source_name}{file_path.suffix}" if original_name else file_path.name
        chunks = self.chunker.chunk(
            markdown,
            source=source_name,
            extra_metadata={"filename": filename},
        )
        logger.info("Created %d chunks", len(chunks))

        # 4. Create document in Supabase
        content_type = _guess_content_type(file_path)
        document_id = await self.vectorstore.create_document(
            user_id=user_id,
            filename=filename,
            storage_path=f"documents/{user_id}/{filename}",
            size=file_path.stat().st_size,
            content_type=content_type,
            extracted_text=markdown,
        )

        # 5. Embed + store chunks
        count = await self.vectorstore.add_chunks(chunks, document_id=document_id)
        return {"document_id": document_id, "chunks_created": count}

    async def preview_file(self, file_path: Path, original_name: str | None = None) -> dict:
        """Extract and chunk without embedding — for debugging."""
        source_name = original_name or file_path.stem
        if original_name and "." in source_name:
            source_name = Path(source_name).stem
        pages = await self.extractor.extract(file_path)
        pages = [_clean_page(p) for p in pages]
        markdown = _structure(pages, source_name)
        filename = f"{source_name}{file_path.suffix}" if original_name else file_path.name
        chunks = self.chunker.chunk(
            markdown,
            source=source_name,
            extra_metadata={"filename": filename},
        )
        return {
            "source": source_name,
            "pages": len(pages),
            "pages_detail": [
                {
                    "page": p.page_number,
                    "method": p.extraction_method,
                    "words": len(p.text.split()),
                    "text_preview": p.text[:500],
                }
                for p in pages
            ],
            "markdown_length": len(markdown),
            "markdown_words": len(markdown.split()),
            "chunks_count": len(chunks),
            "chunks": [
                {
                    "id": c.id,
                    "words": len(c.text.split()),
                    "text_preview": c.text[:300],
                    "metadata": c.metadata,
                }
                for c in chunks
            ],
        }


def _clean_page(page: PageContent) -> PageContent:
    """Remove garbage characters and empty markdown tables from extracted text."""
    text = page.text

    # Remove null bytes and control characters (common in PDF figure artifacts)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+", "", text)

    # Remove lines that are mostly non-printable / encoded garbage
    # (high ratio of non-alphanumeric, non-space, non-punctuation chars)
    cleaned_lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            cleaned_lines.append(line)
            continue
        printable = sum(1 for c in stripped if c.isalnum() or c in " .,;:!?()-_'/\"")
        ratio = printable / len(stripped) if stripped else 1
        if ratio > 0.3:
            cleaned_lines.append(line)
    text = "\n".join(cleaned_lines)

    # Remove empty markdown tables (only separators, no real content)
    text = re.sub(
        r"(?:(?:\|\s*)+\|\s*\n(?:\|\s*---\s*)+\|\s*\n(?:(?:\|\s*)+\|\s*\n)*)",
        "",
        text,
    )

    # Collapse excessive blank lines
    text = re.sub(r"\n{4,}", "\n\n\n", text)

    return PageContent(
        page_number=page.page_number,
        text=text.strip(),
        extraction_method=page.extraction_method,
        has_tables=page.has_tables,
        tables_markdown=page.tables_markdown,
    )


def _guess_content_type(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")


def _structure(pages: list[PageContent], source_name: str) -> str:
    # If single page and content already has markdown headings, use content directly
    if len(pages) == 1 and pages[0].text.strip():
        text = pages[0].text.strip()
        if re.search(r"^#{1,3}\s+", text, re.MULTILINE):
            return text

    parts = [f"# {source_name}\n"]
    for page in pages:
        if not page.text.strip():
            continue
        parts.append(f"\n## Page {page.page_number}\n")
        parts.append(page.text)
    return "\n".join(parts)
