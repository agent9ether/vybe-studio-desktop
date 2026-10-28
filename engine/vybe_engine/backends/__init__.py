"""Model backends. Each backend exposes `load(path, device)` returning an object
with `generate(prompt, lyrics, duration, seed, out_path, job)` (music) or
`separate(input_path, out_dir, job)` (stems)."""

from __future__ import annotations

import numpy as np
import soundfile as sf


def write_wav(path: str, audio: np.ndarray, sample_rate: int) -> None:
    """audio: (channels, samples) or (samples,) float array."""
    if audio.ndim == 2:
        audio = audio.T  # soundfile wants (samples, channels)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    sf.write(path, audio, sample_rate, subtype="PCM_16")


def get_backend(name: str):
    if name == "musicgen":
        from . import musicgen

        return musicgen
    if name == "acestep":
        from . import acestep

        return acestep
    if name == "stable-audio":
        from . import stable_audio

        return stable_audio
    if name == "demucs":
        from . import demucs_stems

        return demucs_stems
    raise ValueError(f"Unknown backend: {name}")
