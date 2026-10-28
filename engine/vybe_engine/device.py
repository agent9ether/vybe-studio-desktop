from __future__ import annotations

import os


def pick_device(preference: str = "auto") -> str:
    import torch

    if preference == "cpu":
        return "cpu"
    if preference in ("auto", "cuda") and torch.cuda.is_available():
        override = os.environ.get("VYBE_CUDA_DEVICE")
        if override:
            return f"cuda:{override}"
        # On multi-GPU machines use the card with the most memory.
        best = max(range(torch.cuda.device_count()), key=lambda i: torch.cuda.get_device_properties(i).total_memory)
        return f"cuda:{best}"
    if preference in ("auto", "mps") and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def describe(device: str) -> dict:
    import torch

    info = {"device": device, "torch": torch.__version__, "gpu": None, "vramGB": None}
    if device.startswith("cuda"):
        idx = int(device.split(":")[1]) if ":" in device else 0
        props = torch.cuda.get_device_properties(idx)
        info["gpu"] = props.name
        info["vramGB"] = round(props.total_memory / 1024**3, 1)
    elif device == "mps":
        info["gpu"] = "Apple Silicon (MPS)"
    return info


def free_memory() -> None:
    import gc

    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
