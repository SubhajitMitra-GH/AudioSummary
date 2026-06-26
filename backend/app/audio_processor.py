import os
import logging
from faster_whisper import WhisperModel

logger = logging.getLogger("uvicorn.error")

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
        
        # transcribe returns a generator of segments, and transcription info
        segments, info = self.model.transcribe(
            file_path,
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
