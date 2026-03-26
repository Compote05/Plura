from __future__ import annotations

import threading
import logging
from pathlib import Path

import numpy as np
import torch

logger = logging.getLogger(__name__)

HF_MODEL_ID = "kyutai/stt-1b-en_fr-trfs"
LOCAL_MODEL_DIR = Path(__file__).parent.parent.parent / "stt" / "models" / "stt-1b-en_fr-trfs"

SAMPLE_RATE = 24000
VAD_SAMPLE_RATE = 16000
CHUNK_SIZE = 512
CHUNK_DURATION_MS = int(CHUNK_SIZE / VAD_SAMPLE_RATE * 1000)  # ~32ms
SPEECH_THRESHOLD = 0.5
MIN_SPEECH_DURATION_MS = 400
MIN_SILENCE_DURATION_MS = 500
SPEECH_PAD_MS = 200


class STTService:
    def __init__(self):
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._lock = threading.Lock()
        self._processor = None
        self._model = None
        self._vad_model = None
        self._loaded = False

    def load(self) -> None:
        if self._loaded:
            return
        from transformers import (
            KyutaiSpeechToTextProcessor,
            KyutaiSpeechToTextForConditionalGeneration,
        )

        model_id = str(LOCAL_MODEL_DIR) if LOCAL_MODEL_DIR.is_dir() else HF_MODEL_ID
        logger.info(f"Loading STT model from: {model_id}")

        self._processor = KyutaiSpeechToTextProcessor.from_pretrained(model_id)
        self._model = KyutaiSpeechToTextForConditionalGeneration.from_pretrained(
            model_id, device_map=self._device, torch_dtype="auto"
        )

        logger.info("Loading VAD model...")
        vad_model, _ = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
        )
        self._vad_model = vad_model
        self._vad_model.eval()

        self._loaded = True
        logger.info("STT + VAD models ready.")

    def get_vad_prob(self, chunk: np.ndarray) -> float:
        tensor = torch.from_numpy(chunk.copy()).float()
        with torch.no_grad():
            return self._vad_model(tensor, VAD_SAMPLE_RATE).item()  # type: ignore

    def transcribe(self, audio_16k: np.ndarray) -> str:
        import librosa

        audio_24k = librosa.resample(
            audio_16k, orig_sr=VAD_SAMPLE_RATE, target_sr=SAMPLE_RATE
        ).astype(np.float32)
        inputs = self._processor.feature_extractor(  # type: ignore
            audio_24k, sampling_rate=SAMPLE_RATE, return_tensors="pt"
        )
        inputs = {k: v.to(self._device) for k, v in inputs.items()}
        with self._lock:
            output_tokens = self._model.generate(**inputs)  # type: ignore
        return self._processor.batch_decode(output_tokens, skip_special_tokens=True)[0].strip()  # type: ignore
