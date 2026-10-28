from __future__ import annotations

from . import write_wav

STEPS = 100


class StableAudio:
    def __init__(self, path: str, device: str):
        import torch
        from diffusers import StableAudioPipeline

        self.device = device
        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        self.pipe = StableAudioPipeline.from_pretrained(path, torch_dtype=dtype, disable_mmap=True).to(device)

    def generate(self, prompt: str, lyrics: str, duration: float, seed: int | None, out_path: str, job) -> dict:
        import torch

        gen_device = "cpu" if self.device == "mps" else self.device
        generator = torch.Generator(device=gen_device).manual_seed(seed if seed is not None else torch.seed() % 2**31)

        def on_step(pipe, step, timestep, kwargs):
            job.update(min(0.95, (step + 1) / STEPS), f"Diffusion step {step + 1}/{STEPS}")
            return kwargs

        call = dict(
            prompt=prompt,
            negative_prompt="Low quality, distorted.",
            num_inference_steps=STEPS,
            audio_end_in_s=float(min(duration, 47)),
            num_waveforms_per_prompt=1,
            generator=generator,
        )
        with torch.inference_mode():
            try:
                out = self.pipe(**call, callback_on_step_end=on_step)
            except TypeError:
                out = self.pipe(**call)
        wav = out.audios[0].float().cpu().numpy()
        sr = int(self.pipe.vae.sampling_rate)
        write_wav(out_path, wav, sr)
        return {"sampleRate": sr, "duration": wav.shape[-1] / sr}


def load(path: str, device: str, entry: dict):
    return StableAudio(path, device)
