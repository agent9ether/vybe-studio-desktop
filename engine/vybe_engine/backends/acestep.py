from __future__ import annotations

from . import write_wav


class AceStep:
    def __init__(self, path: str, device: str, entry: dict):
        import torch

        try:
            from diffusers import AceStepPipeline
        except ImportError as e:  # pragma: no cover - depends on diffusers version
            raise RuntimeError(
                "This diffusers build has no AceStepPipeline. Update the engine "
                "(Settings → Local engine → Repair) or run: pip install -U diffusers"
            ) from e

        self.device = device
        dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32

        offload = False
        if device.startswith("cuda"):
            idx = int(device.split(":")[1]) if ":" in device else 0
            vram = torch.cuda.get_device_properties(idx).total_memory / 1024**3
            offload = vram < entry.get("vramGB", 16) + 4
        # disable_mmap: memory-mapping weight shards larger than 4 GB crashes
        # on Windows (safetensors + torch), so read them normally instead.
        self.pipe = AceStepPipeline.from_pretrained(path, torch_dtype=dtype, disable_mmap=True)
        if offload:
            self.pipe.enable_model_cpu_offload(device=device)
        else:
            self.pipe = self.pipe.to(device)
        try:
            self.pipe.vae.enable_tiling()
        except Exception:  # noqa: BLE001 - optional optimisation
            pass

    def generate(self, prompt: str, lyrics: str, duration: float, seed: int | None, out_path: str, job) -> dict:
        import torch

        gen_device = "cpu" if self.device == "mps" else self.device
        generator = torch.Generator(device=gen_device).manual_seed(seed if seed is not None else torch.seed() % 2**31)
        steps = {"n": 0}

        def on_step(pipe, step, timestep, kwargs):
            steps["n"] = step + 1
            total = getattr(pipe, "num_timesteps", None) or 8
            job.update(min(0.9, (step + 1) / total), f"Diffusion step {step + 1}/{total}")
            return kwargs

        job.update(0.02, "Composing…")
        call = dict(
            prompt=prompt,
            lyrics=lyrics if lyrics.strip() else "[Instrumental]",
            audio_duration=float(duration),
            generator=generator,
        )
        with torch.inference_mode():
            try:
                out = self.pipe(**call, callback_on_step_end=on_step)
            except TypeError:
                out = self.pipe(**call)
        audio = out.audios[0]
        wav = audio.float().cpu().numpy() if hasattr(audio, "cpu") else audio
        sr = int(getattr(self.pipe, "sample_rate", 48000))
        job.update(0.97, "Writing file…")
        write_wav(out_path, wav, sr)
        return {"sampleRate": sr, "duration": wav.shape[-1] / sr}


def load(path: str, device: str, entry: dict):
    return AceStep(path, device, entry)
