from __future__ import annotations

import collections
import json
import logging

import numpy as np
import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app import dependencies as deps
from app.config import settings
from app.services.stt_service import (
    CHUNK_DURATION_MS,
    MIN_SILENCE_DURATION_MS,
    MIN_SPEECH_DURATION_MS,
    SPEECH_PAD_MS,
    SPEECH_THRESHOLD,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["stt"])


async def _verify_token(token: str) -> bool:
    url = f"{settings.supabase_url}/auth/v1/user"
    logger.info(f"[stt] verifying token against {url} (anon_key={'set' if settings.supabase_anon_key else 'EMPTY'})")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                url,
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {token}",
                },
            )
        logger.info(f"[stt] token verification status: {resp.status_code}")
        return resp.status_code == 200
    except Exception as e:
        logger.error(f"[stt] token verification exception: {e}")
        return False


@router.websocket("/stt")
async def stt_websocket(websocket: WebSocket, token: str = ""):
    await websocket.accept()
    logger.info(f"[stt] WS accepted, token present: {bool(token)}")

    if not token or not await _verify_token(token):
        logger.warning("[stt] auth failed, closing")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if deps.stt_service is None or not deps.stt_service._loaded:
        logger.warning("[stt] STT service not ready, closing")
        await websocket.send_text('{"type":"error","message":"STT service not ready"}')
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    logger.info("[stt] auth OK, service ready — entering audio loop")

    svc = deps.stt_service

    min_speech_chunks = int(MIN_SPEECH_DURATION_MS / CHUNK_DURATION_MS)
    min_silence_chunks = int(MIN_SILENCE_DURATION_MS / CHUNK_DURATION_MS)
    pad_chunks = int(SPEECH_PAD_MS / CHUNK_DURATION_MS)

    speech_buffer: list[np.ndarray] = []
    silence_chunks = 0
    is_speaking = False
    pre_speech_buffer: collections.deque[np.ndarray] = collections.deque(
        maxlen=pad_chunks
    )

    try:
        while True:
            data = await websocket.receive_bytes()
            chunk = np.frombuffer(data, dtype=np.float32)

            if chunk.shape[0] != 512:
                # Ignore malformed chunks
                continue

            prob = svc.get_vad_prob(chunk)
            is_speech = prob >= SPEECH_THRESHOLD

            if is_speech:
                if not is_speaking:
                    is_speaking = True
                    silence_chunks = 0
                    speech_buffer.extend(list(pre_speech_buffer))
                speech_buffer.append(chunk)
            else:
                if is_speaking:
                    silence_chunks += 1
                    speech_buffer.append(chunk)

                    if silence_chunks >= min_silence_chunks:
                        is_speaking = False

                        if len(speech_buffer) >= min_speech_chunks:
                            audio_segment = np.concatenate(speech_buffer)
                            text = svc.transcribe(audio_segment)
                            if text:
                                await websocket.send_text(
                                    json.dumps({"type": "transcript", "text": text})
                                )

                        speech_buffer = []
                        silence_chunks = 0
                else:
                    pre_speech_buffer.append(chunk)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"STT WebSocket error: {e}")
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass
