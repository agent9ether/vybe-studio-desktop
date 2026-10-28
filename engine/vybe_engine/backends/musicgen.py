from __future__ import annotations

from . import write_wav


class _ProgressStreamer:
    """transformers streamer that turns generated tokens into job progress."""

    def __init__(self, job, total_tokens: int):
        self.job = job
        self.total = max(1, total_tokens)
        self.seen = 0
        self.first = True

    def put(self, value):
        if self.first:  # the prompt is pushed first
            self.first = False
            return
        self.seen += 1
        if self.seen % 10 == 0:
            self.job.update(min(0.95, self.seen / self.total), f"Generating audio tokens {self.seen}/{self.total}")

    def end(self):
        pass


class MusicGen:
    def __init__(self, path: str, device: str):
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration

        self.device = device
        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        self.processor = AutoProcessor.from_pretrained(path)
        self.model = MusicgenForConditionalGeneration.from_pretrained(path, torch_dtype=dtype).to(device)
        self.model.eval()

    def generate(self, prompt: str, lyrics: str, duration: float, seed: int | None, out_path: str, job) -> dict:
        import torch

        if seed is not None:
            torch.manual_seed(seed)
        inputs = self.processor(text=[prompt], padding=True, return_tensors="pt").to(self.device)
        frame_rate = self.model.config.audio_encoder.frame_rate
        tokens = int(duration * frame_rate)
        job.update(0.02, "Generating…")
        with torch.inference_mode():
            audio = self.model.generate(
                **inputs,
                do_sample=True,
                guidance_scale=3.0,
                max_new_tokens=tokens,
                streamer=_ProgressStreamer(job, tokens),
            )
        sr = self.model.config.audio_encoder.sampling_rate
        wav = audio[0].float().cpu().numpy()
        write_wav(out_path, wav, sr)
        return {"sampleRate": sr, "duration": wav.shape[-1] / sr}


def load(path: str, device: str, entry: dict):
    return MusicGen(path, device)
