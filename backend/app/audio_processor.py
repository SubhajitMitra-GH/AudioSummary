import os
import logging

import numpy as np
from faster_whisper import WhisperModel

logger = logging.getLogger("uvicorn.error")

SAMPLE_RATE = 16000  # what Whisper expects


def decode_audio(file_path: str, sampling_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Decode any audio/video file to mono float32 PCM at `sampling_rate`.

    faster-whisper has its own decoder, but it passes an option (`metadata_errors`) that newer
    PyAV releases removed, which makes every transcription fail. Decoding here keeps transcription
    working regardless of the installed PyAV version.
    """
    import av

    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=sampling_rate)
    chunks = []
    with av.open(file_path, mode="r") as container:
        if not container.streams.audio:
            return np.zeros(0, dtype=np.float32)
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):  # flush buffered samples
            chunks.append(resampled.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0

class AudioProcessor:
    def __init__(self):
        self.model: WhisperModel | None = None
        self.model_size: str | None = None

    def load_model(self, model_size: str = "base"):
        """Load the Whisper model on CPU optimized for Apple Silicon."""
        if self.model is not None and self.model_size == model_size:
            logger.info(f"Whisper model '{model_size}' already loaded.")
            return

        try:
            logger.info(f"Loading Whisper model '{model_size}' on CPU (optimized for Apple Silicon)...")
            # CTranslate2 / faster-whisper optimizations for CPU:
            # - device="cpu"
            # - compute_type="int8" (quantized format, highly performant on CPU)
            self.model = WhisperModel(
                model_size,
                device="cpu",
                compute_type="int8"
            )
            self.model_size = model_size
            logger.info(f"Whisper model '{model_size}' loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            raise e

    def transcribe(self, file_path: str) -> dict:
        """Transcribe audio file to text.
        
        Args:
            file_path: Path to the audio file.
            
        Returns:
            dict containing:
                - text: The complete raw transcript.
                - segments: List of individual transcript segments with timestamps.
                - language: Detected language.
                - language_probability: Probability of detected language.
        """
        if self.model is None:
            raise RuntimeError("Whisper model is not loaded. Call load_model() first.")

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Audio file not found: {file_path}")

        logger.info(f"Transcribing audio file: {file_path}")
        
        audio = decode_audio(file_path)
        if audio.size == 0:
            logger.info("No audio samples found in the file.")
            return {"text": "", "segments": [], "language": None, "language_probability": 0.0}

        # transcribe returns a generator of segments, and transcription info
        segments, info = self.model.transcribe(
            audio,
            beam_size=5,
            vad_filter=True, # Use Voice Activity Detection to filter out silence
        )

        full_text = []
        transcribed_segments = []

        # The segments generator must be consumed to execute transcription
        for segment in segments:
            full_text.append(segment.text)
            transcribed_segments.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": segment.text.strip()
            })

        complete_text = " ".join(full_text).strip()
        logger.info(f"Transcription finished. Detected language: {info.language} ({info.language_probability:.2f})")
        
        return {
            "text": complete_text,
            "segments": transcribed_segments,
            "language": info.language,
            "language_probability": info.language_probability
        }

audio_processor = AudioProcessor()
