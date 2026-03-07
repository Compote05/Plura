from __future__ import annotations

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings — override via env vars or .env file."""

    model_config = {"env_prefix": "RAG_", "env_file": ".env", "extra": "ignore"}

    # Ollama
    ollama_url: str = "http://localhost:11434"
    ocr_model: str = "glm-ocr:latest"
    embedding_model: str = "qwen3-embedding:4b"

    # PDF processing
    dpi: int = 200
    ocr_threshold: int = 50

    # Chunking
    chunk_size: int = 256
    chunk_overlap: int = 50
    min_chunk_size: int = 30

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""  # service role key (bypasses RLS)
    supabase_anon_key: str = ""  # anon key (for JWT verification)

    # Security
    allowed_origins: list[str] = ["http://localhost:3000"]
    rate_limit_default: int = 60  # requests per minute
    rate_limit_upload: int = 20
    rate_limit_window: int = 60  # seconds

    # API
    api_title: str = "Document Embedding API"
    api_version: str = "1.0.0"
    max_upload_size_mb: int = 100
    workers: int = 4

    # OCR prompts
    ocr_text_prompt: str = (
        "Text Recognition: Extract ALL text from this image faithfully. "
        "Preserve the structure: headings, paragraphs, bullet points. "
        "Format the output as clean Markdown. "
        "Return only the extracted text."
    )
    ocr_table_prompt: str = (
        "Table Recognition: Extract all tables from this image. "
        "Format each table as a Markdown table. "
        "Return only the tables."
    )


settings = Settings()
