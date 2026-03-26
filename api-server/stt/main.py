import argparse
import torch
import numpy as np
import sounddevice as sd
import soundfile as sf
import collections
import queue
import threading
from transformers import KyutaiSpeechToTextProcessor, KyutaiSpeechToTextForConditionalGeneration
import warnings
warnings.filterwarnings("ignore", category=FutureWarning)

MODEL_PATH = "./models/stt-1b-en_fr-trfs"
SAMPLE_RATE = 24000
VAD_SAMPLE_RATE = 16000  # Silero tourne à 16kHz
device = "cuda" if torch.cuda.is_available() else "cpu"

# --- VAD Config ---
CHUNK_SIZE = 512              # exactement 512 samples pour Silero à 16kHz
CHUNK_DURATION_MS = int(CHUNK_SIZE / VAD_SAMPLE_RATE * 1000)  # ~32ms
SPEECH_THRESHOLD = 0.5        # probabilité min pour considérer comme parole
MIN_SPEECH_DURATION_MS = 400  # ignore les sons < 400ms (heu, hmm, claquements)
MIN_SILENCE_DURATION_MS = 800 # silence de 800ms = fin de phrase
SPEECH_PAD_MS = 200           # padding autour de la parole détectée

def load_model():
    print("⏳ Chargement du modèle STT...")
    processor = KyutaiSpeechToTextProcessor.from_pretrained(MODEL_PATH)
    model = KyutaiSpeechToTextForConditionalGeneration.from_pretrained(
        MODEL_PATH, device_map=device, torch_dtype="auto"
    )
    print("✅ Modèle STT chargé")
    return processor, model

def load_vad():
    print("⏳ Chargement du VAD (Silero)...")
    vad_model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False
    )
    print("✅ VAD chargé")
    return vad_model

def resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    import librosa
    return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr)

def transcribe_audio(processor, model, audio: np.ndarray):
    """Transcrit un segment audio numpy float32 @ 24kHz"""
    audio_24k = resample(audio, VAD_SAMPLE_RATE, SAMPLE_RATE).astype(np.float32)
    inputs = processor.feature_extractor(audio_24k, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    output_tokens = model.generate(**inputs)
    text = processor.batch_decode(output_tokens, skip_special_tokens=True)[0].strip()
    return text

def transcribe_file(processor, model, audio_path: str):
    audio, sr = sf.read(audio_path)
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        audio = resample(audio, sr, SAMPLE_RATE)
    audio = audio.astype(np.float32)
    inputs = processor.feature_extractor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    output_tokens = model.generate(**inputs)
    print(processor.batch_decode(output_tokens, skip_special_tokens=True)[0])

def transcribe_mic(processor, model):
    vad_model = load_vad()
    vad_model.eval()

    audio_queue = queue.Queue()
    speech_buffer = []       # chunks de parole accumulés
    silence_chunks = 0       # compteur de chunks silencieux consécutifs
    is_speaking = False

    min_speech_chunks = int(MIN_SPEECH_DURATION_MS / CHUNK_DURATION_MS)
    min_silence_chunks = int(MIN_SILENCE_DURATION_MS / CHUNK_DURATION_MS)
    pad_chunks = int(SPEECH_PAD_MS / CHUNK_DURATION_MS)
    pre_speech_buffer = collections.deque(maxlen=pad_chunks)  # buffer circulaire pour le padding avant

    def audio_callback(indata, frames, time, status):
        """Callback sounddevice : envoie les chunks dans la queue"""
        audio_queue.put(indata.copy())

    def get_vad_prob(chunk: np.ndarray) -> float:
        """Retourne la probabilité de parole pour un chunk 16kHz"""
        tensor = torch.from_numpy(chunk).float()
        with torch.no_grad():
            prob = vad_model(tensor, VAD_SAMPLE_RATE).item()
        return prob

    print("🎙️  Micro actif — parlez quand vous voulez (Ctrl+C pour quitter)\n")

    with sd.InputStream(
        samplerate=VAD_SAMPLE_RATE,
        channels=1,
        dtype="float32",
        blocksize=512,
        callback=audio_callback
    ):
        while True:
            chunk = audio_queue.get().squeeze()  # (CHUNK_SIZE,)
            prob = get_vad_prob(chunk)
            is_speech = prob >= SPEECH_THRESHOLD

            if is_speech:
                if not is_speaking:
                    # Début de prise de parole : on ajoute le padding avant
                    is_speaking = True
                    silence_chunks = 0
                    speech_buffer.extend(list(pre_speech_buffer))
                    print("🔴 Parole détectée...")
                speech_buffer.append(chunk)

            else:
                if is_speaking:
                    silence_chunks += 1
                    speech_buffer.append(chunk)  # on garde un peu de silence pour ne pas couper

                    if silence_chunks >= min_silence_chunks:
                        # Fin de phrase détectée
                        is_speaking = False

                        if len(speech_buffer) >= min_speech_chunks:
                            audio_segment = np.concatenate(speech_buffer)
                            print("⏳ Transcription...")
                            text = transcribe_audio(processor, model, audio_segment)
                            if text:
                                print(f"📝 {text}\n")
                        else:
                            print("⏭️  Segment trop court, ignoré\n")

                        speech_buffer = []
                        silence_chunks = 0
                else:
                    # Pas en train de parler : garder dans le pre-buffer (padding)
                    pre_speech_buffer.append(chunk)

def main():
    parser = argparse.ArgumentParser(description="STT local Kyutai + VAD Silero")
    parser.add_argument("--source", choices=["file", "mic"], required=True)
    parser.add_argument("--file", help="Chemin du fichier audio")
    args = parser.parse_args()

    processor, model = load_model()

    if args.source == "file":
        if not args.file:
            print("❌ --file requis")
            exit(1)
        transcribe_file(processor, model, args.file)

    elif args.source == "mic":
        try:
            transcribe_mic(processor, model)
        except KeyboardInterrupt:
            print("\n👋 Arrêt")

if __name__ == "__main__":
    main()