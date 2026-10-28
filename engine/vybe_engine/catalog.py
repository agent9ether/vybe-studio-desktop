"""Catalog of open-source models the engine knows how to download and run.

Users can add more entries (e.g. a fine-tuned MusicGen) through the app's
"Add from Hugging Face" dialog; those are stored in <models_dir>/custom-models.json.
"""

from __future__ import annotations

import json
from pathlib import Path

MUSICGEN_SAFETENSORS = ["*.json", "*.safetensors", "*.txt", "spiece.model"]
MUSICGEN_BIN = ["*.json", "pytorch_model*.bin", "*.txt", "spiece.model"]

BUILTIN: list[dict] = [
    {
        "id": "acestep-v15-xl-turbo",
        "name": "ACE-Step 1.5 XL Turbo",
        "repo": "ACE-Step/acestep-v15-xl-turbo-diffusers",
        "backend": "acestep",
        "task": "music",
        "description": "Full songs with vocals from tags + lyrics. Best open-source song model; 8-step turbo sampling.",
        "sizeGB": 11.1,
        "vramGB": 16,
        "license": "MIT",
        "supportsLyrics": True,
        "maxDurationSec": 240,
        "defaultDurationSec": 90,
        "allow": ["model_index.json", "*/*.json", "*/*.safetensors", "tokenizer/*"],
    },
    {
        "id": "musicgen-small",
        "name": "MusicGen Small",
        "repo": "facebook/musicgen-small",
        "backend": "musicgen",
        "task": "music",
        "description": "Meta's 300M MusicGen. Fast instrumentals; runs on modest GPUs or CPU.",
        "sizeGB": 2.4,
        "vramGB": 4,
        "license": "CC-BY-NC 4.0",
        "supportsLyrics": False,
        "maxDurationSec": 30,
        "defaultDurationSec": 15,
        "allow": MUSICGEN_SAFETENSORS,
    },
    {
        "id": "musicgen-stereo-medium",
        "name": "MusicGen Stereo Medium",
        "repo": "facebook/musicgen-stereo-medium",
        "backend": "musicgen",
        "task": "music",
        "description": "1.5B stereo MusicGen. Richer instrumentals.",
        "sizeGB": 4.1,
        "vramGB": 8,
        "license": "CC-BY-NC 4.0",
        "supportsLyrics": False,
        "maxDurationSec": 30,
        "defaultDurationSec": 20,
        "allow": MUSICGEN_SAFETENSORS,
    },
    {
        "id": "musicgen-stereo-large",
        "name": "MusicGen Stereo Large",
        "repo": "facebook/musicgen-stereo-large",
        "backend": "musicgen",
        "task": "music",
        "description": "3.3B stereo MusicGen. Highest-quality MusicGen instrumentals.",
        "sizeGB": 6.9,
        "vramGB": 14,
        "license": "CC-BY-NC 4.0",
        "supportsLyrics": False,
        "maxDurationSec": 30,
        "defaultDurationSec": 20,
        "allow": MUSICGEN_SAFETENSORS,
    },
    {
        "id": "musicgen-large",
        "name": "MusicGen Large (mono)",
        "repo": "facebook/musicgen-large",
        "backend": "musicgen",
        "task": "music",
        "description": "3.3B mono MusicGen.",
        "sizeGB": 6.6,
        "vramGB": 14,
        "license": "CC-BY-NC 4.0",
        "supportsLyrics": False,
        "maxDurationSec": 30,
        "defaultDurationSec": 20,
        "allow": MUSICGEN_BIN,
    },
    {
        "id": "stable-audio-open-1.0",
        "name": "Stable Audio Open 1.0",
        "repo": "stabilityai/stable-audio-open-1.0",
        "backend": "stable-audio",
        "task": "music",
        "description": "Stability AI's 44.1kHz stereo model for loops, textures and short instrumentals (≤47s). Gated: accept the license on Hugging Face and add your HF token.",
        "sizeGB": 4.9,
        "vramGB": 8,
        "license": "Stability AI Community",
        "supportsLyrics": False,
        "maxDurationSec": 47,
        "defaultDurationSec": 30,
        "gated": True,
        "allow": ["model_index.json", "*/*.json", "*/*.safetensors", "tokenizer/*"],
    },
    {
        "id": "htdemucs",
        "name": "Demucs v4 (htdemucs)",
        "repo": "demucs:htdemucs",
        "backend": "demucs",
        "task": "stems",
        "description": "Hybrid Transformer Demucs — splits a track into vocals, drums, bass and other.",
        "sizeGB": 0.08,
        "vramGB": 3,
        "license": "MIT",
        "supportsLyrics": False,
        "maxDurationSec": 0,
        "defaultDurationSec": 0,
    },
    {
        "id": "htdemucs_ft",
        "name": "Demucs v4 fine-tuned (htdemucs_ft)",
        "repo": "demucs:htdemucs_ft",
        "backend": "demucs",
        "task": "stems",
        "description": "Fine-tuned Demucs: slightly cleaner stems, ~4x slower.",
        "sizeGB": 0.32,
        "vramGB": 3,
        "license": "MIT",
        "supportsLyrics": False,
        "maxDurationSec": 0,
        "defaultDurationSec": 0,
    },
]

BACKEND_DEFAULTS = {
    "musicgen": {"supportsLyrics": False, "maxDurationSec": 30, "defaultDurationSec": 15, "allow": MUSICGEN_SAFETENSORS},
    "acestep": {"supportsLyrics": True, "maxDurationSec": 240, "defaultDurationSec": 90, "allow": None},
    "stable-audio": {"supportsLyrics": False, "maxDurationSec": 47, "defaultDurationSec": 30, "allow": None},
}


def custom_file(models_dir: Path) -> Path:
    return models_dir / "custom-models.json"


def load_custom(models_dir: Path) -> list[dict]:
    try:
        return json.loads(custom_file(models_dir).read_text("utf-8"))
    except (OSError, ValueError):
        return []


def save_custom(models_dir: Path, items: list[dict]) -> None:
    models_dir.mkdir(parents=True, exist_ok=True)
    custom_file(models_dir).write_text(json.dumps(items, indent=2), "utf-8")


def all_models(models_dir: Path) -> list[dict]:
    return BUILTIN + [{**m, "custom": True} for m in load_custom(models_dir)]


def find(models_dir: Path, model_id: str) -> dict:
    for m in all_models(models_dir):
        if m["id"] == model_id:
            return m
    raise KeyError(f"Unknown model: {model_id}")
