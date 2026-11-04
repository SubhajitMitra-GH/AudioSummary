"""Audio decoding for Whisper (independent of faster-whisper's PyAV call)."""
import av
import numpy as np

from app.audio_processor import AudioProcessor, decode_audio


def _write_tone(path, codec="pcm_s16le", rate=44100, seconds=1.0):
    with av.open(str(path), "w") as out:
        stream = out.add_stream(codec, rate=rate)
        stream.layout = "stereo"
        t = np.arange(int(rate * seconds)) / rate
        pcm = (np.sin(2 * np.pi * 440 * t) * 0.5 * 32767).astype(np.int16)
        frame = av.AudioFrame.from_ndarray(np.vstack([pcm, pcm]).T.reshape(1, -1), format="s16", layout="stereo")
        frame.sample_rate = rate
        for packet in stream.encode(frame):
            out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)


def test_decodes_to_mono_16k_float(tmp_path):
    path = tmp_path / "tone.wav"
    _write_tone(path)
    audio = decode_audio(str(path))
    assert audio.dtype == np.float32
    assert abs(len(audio) - 16000) < 400  # ~1 s at 16 kHz
    assert 0.4 < np.abs(audio).max() <= 1.0


def test_transcribe_passes_decoded_samples_to_whisper(tmp_path):
    path = tmp_path / "tone.wav"
    _write_tone(path, seconds=0.5)
    seen = {}

    class FakeModel:
        def transcribe(self, audio, **kwargs):
            seen["audio"] = audio
            info = type("Info", (), {"language": "en", "language_probability": 0.99})()
            return iter([]), info

    proc = AudioProcessor()
    proc.model = FakeModel()
    result = proc.transcribe(str(path))
    assert isinstance(seen["audio"], np.ndarray)  # not the file path (which hit the PyAV bug)
    assert result["text"] == ""
