from __future__ import annotations

import os

import numpy as np
import soundfile as sf

from . import write_wav


def _load_audio(path: str, samplerate: int, channels: int):
    import julius
    import torch

    data, sr = sf.read(path, always_2d=True, dtype="float32")  # (samples, channels)
    wav = torch.from_numpy(np.ascontiguousarray(data.T))
    if wav.shape[0] == 1 and channels == 2:
        wav = wav.repeat(2, 1)
    elif wav.shape[0] > channels:
        wav = wav[:channels]
    if sr != samplerate:
        wav = julius.resample_frac(wav, sr, samplerate)
    return wav


class Demucs:
    def __init__(self, name: str, device: str):
        from demucs.pretrained import get_model

        self.device = device
        self.model = get_model(name)
        self.model.to(device)
        self.model.eval()

    def separate(self, input_path: str, out_dir: str, job) -> dict:
        import torch
        from demucs.apply import apply_model

        job.update(0.05, "Loading audio…")
        wav = _load_audio(input_path, self.model.samplerate, self.model.audio_channels)
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        job.update(0.15, "Separating stems…")
        with torch.inference_mode():
            sources = apply_model(
                self.model,
                ((wav - mean) / std)[None].to(self.device),
                device=self.device,
                shifts=1,
                split=True,
                overlap=0.25,
                progress=False,
            )[0]
        sources = sources * std + mean
        os.makedirs(out_dir, exist_ok=True)
        stems: dict[str, str] = {}
        for source, name in zip(sources, self.model.sources):
            path = os.path.join(out_dir, f"{name}.wav")
            write_wav(path, source.cpu().numpy(), self.model.samplerate)
            stems[name] = path
        job.update(0.9, "Mixing instrumental…")
        # Instrumental = everything except vocals.
        if "vocals" in self.model.sources:
            inst = sum(s for s, n in zip(sources, self.model.sources) if n != "vocals")
            path = os.path.join(out_dir, "instrumental.wav")
            write_wav(path, inst.cpu().numpy(), self.model.samplerate)
            stems["instrumental"] = path
        return {"stems": stems}


def load(path: str, device: str, entry: dict):
    name = entry["repo"].split(":", 1)[1]
    return Demucs(name, device)


def download(entry: dict) -> None:
    from demucs.pretrained import get_model

    get_model(entry["repo"].split(":", 1)[1])
