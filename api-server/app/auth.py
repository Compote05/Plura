from __future__ import annotations

import time
import logging
from collections import defaultdict
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer()


# ── JWT verification via Supabase ─────────────────────────────────────────────


class AuthenticatedUser:
    __slots__ = ("id", "email", "role")

    def __init__(self, id: str, email: str | None, role: str):
        self.id = id
        self.email = email
        self.role = role


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
) -> AuthenticatedUser:
    """Verify Supabase JWT and return the authenticated user."""
    token = credentials.credentials

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.supabase_url}/auth/v1/user",
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="Auth service unavailable")

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    data = resp.json()
    return AuthenticatedUser(
        id=data["id"],
        email=data.get("email"),
        role=data.get("role", "authenticated"),
    )


# ── Rate limiting ─────────────────────────────────────────────────────────────

_buckets: dict[str, list[float]] = defaultdict(list)


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"


def rate_limit(max_requests: int | None = None, window: int | None = None):
    """Returns a dependency that enforces per-IP rate limiting."""
    _max = max_requests or settings.rate_limit_default
    _window = window or settings.rate_limit_window

    async def _check(request: Request) -> None:
        ip = _get_client_ip(request)
        key = f"{ip}:{request.url.path}"
        now = time.monotonic()

        # Purge expired entries
        _buckets[key] = [t for t in _buckets[key] if now - t < _window]

        if len(_buckets[key]) >= _max:
            raise HTTPException(status_code=429, detail="Too many requests")

        _buckets[key].append(now)

    return _check
