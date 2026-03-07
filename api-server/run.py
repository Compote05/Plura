#!/usr/bin/env python3
"""Launch the Document Embedding API server."""

import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8100,
        reload=True,
        workers=1,
        log_level="info",
    )
