"""HTTP API the desktop app talks to. Bound to 127.0.0.1 only."""

from __future__ import annotations

import fnmatch
import os
import shutil
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import catalog
from .backends import get_backend
from .device import describe, free_memory, pick_device
from .jobs import Job, JobRunner

MARKER = ".vybe-complete"


# Request bodies live at module level so FastAPI can resolve the
# (postponed) annotations.
class CustomModel(BaseModel):
    id: str
    name: str
    repo: str
    backend: str
    description: str = ""
    sizeGB: float = 0
    vramGB: float = 8
    license: str = "see model card"


class GenerateBody(BaseModel):
    model: str
    prompt: str
    lyrics: str = ""
    duration: float | None = None
    seed: int | None = None
    out_path: str


class StemsBody(BaseModel):
    model: str = "htdemucs"
    input_path: str
    out_dir: str


class State:
    def __init__(self, models_dir: Path, device_pref: str):
        self.models_dir = models_dir
        self.device = pick_device(device_pref)
        self.runner = JobRunner()
        self.loaded_id: str | None = None
        self.loaded = None
        self.load_lock = threading.Lock()


def create_app(models_dir: str, device_pref: str = "auto") -> FastAPI:
    state = State(Path(models_dir), device_pref)
    state.models_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="Vybe Engine")

    def model_dir(model_id: str) -> Path:
        return state.models_dir / model_id

    def is_installed(entry: dict) -> bool:
        return (model_dir(entry["id"]) / MARKER).exists()

    def get_loaded(entry: dict, job: Job):
        with state.load_lock:
            if state.loaded_id == entry["id"] and state.loaded is not None:
                return state.loaded
            if state.loaded is not None:
                job.update(message="Unloading previous model…")
                state.loaded = None
                state.loaded_id = None
                free_memory()
            job.update(0.01, f"Loading {entry['name']} onto {state.device}…")
            backend = get_backend(entry["backend"])
            state.loaded = backend.load(str(model_dir(entry["id"])), state.device, entry)
            state.loaded_id = entry["id"]
            return state.loaded

    @app.get("/health")
    def health():
        return {"ok": True, "pid": os.getpid(), **describe(state.device)}

    @app.get("/models")
    def list_models():
        downloading = {j.result_id for j in state.runner.active("download") if hasattr(j, "result_id")}
        items = []
        for m in catalog.all_models(state.models_dir):
            public = {k: v for k, v in m.items() if k != "allow"}
            items.append({**public, "installed": is_installed(m), "installing": m["id"] in downloading})
        return items

    @app.post("/models/custom")
    def add_custom(body: CustomModel):
        if body.backend not in catalog.BACKEND_DEFAULTS:
            raise HTTPException(400, f"Backend must be one of {list(catalog.BACKEND_DEFAULTS)}")
        items = [m for m in catalog.load_custom(state.models_dir) if m["id"] != body.id]
        if any(m["id"] == body.id for m in catalog.BUILTIN):
            raise HTTPException(400, "That id is already used by a built-in model")
        entry = {**catalog.BACKEND_DEFAULTS[body.backend], **body.model_dump(), "task": "music"}
        items.append(entry)
        catalog.save_custom(state.models_dir, items)
        return entry

    @app.post("/models/{model_id}/download")
    def download(model_id: str):
        try:
            entry = catalog.find(state.models_dir, model_id)
        except KeyError as e:
            raise HTTPException(404, str(e)) from e

        def run(job: Job):
            target = model_dir(model_id)
            target.mkdir(parents=True, exist_ok=True)
            if entry["backend"] == "demucs":
                job.update(-1, "Downloading Demucs weights…")
                get_backend("demucs").download(entry)
            else:
                _hf_download(entry, target, job)
            (target / MARKER).write_text(str(time.time()))
            return {"id": model_id}

        job = state.runner.submit("download", run, pool="io")
        job.result_id = model_id  # type: ignore[attr-defined]
        return {"jobId": job.id}

    @app.delete("/models/{model_id}")
    def delete(model_id: str):
        if state.loaded_id == model_id:
            state.loaded = None
            state.loaded_id = None
            free_memory()
        shutil.rmtree(model_dir(model_id), ignore_errors=True)
        items = [m for m in catalog.load_custom(state.models_dir) if m["id"] != model_id]
        catalog.save_custom(state.models_dir, items)
        return {"ok": True}

    @app.post("/generate")
    def generate(body: GenerateBody):
        entry = _installed_entry(body.model, "music")

        def run(job: Job):
            model = get_loaded(entry, job)
            duration = body.duration or entry.get("defaultDurationSec", 30)
            duration = max(1.0, min(float(duration), float(entry.get("maxDurationSec") or duration)))
            Path(body.out_path).parent.mkdir(parents=True, exist_ok=True)
            return model.generate(body.prompt, body.lyrics, duration, body.seed, body.out_path, job)

        return {"jobId": state.runner.submit("generate", run).id}

    @app.post("/stems")
    def stems(body: StemsBody):
        entry = _installed_entry(body.model, "stems")

        def run(job: Job):
            model = get_loaded(entry, job)
            return model.separate(body.input_path, body.out_dir, job)

        return {"jobId": state.runner.submit("stems", run).id}

    @app.get("/jobs/{job_id}")
    def job_status(job_id: str):
        job = state.runner.get(job_id)
        if not job:
            raise HTTPException(404, "Unknown job")
        return job.to_dict()

    @app.post("/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        job = state.runner.get(job_id)
        if job:
            job.cancel_requested = True
        return {"ok": True}

    @app.post("/unload")
    def unload():
        state.loaded = None
        state.loaded_id = None
        free_memory()
        return {"ok": True}

    def _installed_entry(model_id: str, task: str) -> dict:
        try:
            entry = catalog.find(state.models_dir, model_id)
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        if entry["task"] != task:
            raise HTTPException(400, f"{entry['name']} is not a {task} model")
        if not is_installed(entry):
            raise HTTPException(409, f"{entry['name']} is not downloaded yet")
        return entry

    return app


def _dir_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def _hf_download(entry: dict, target: Path, job: Job) -> None:
    from huggingface_hub import HfApi, snapshot_download

    token = os.environ.get("HF_TOKEN") or None
    allow = entry.get("allow")
    job.update(0.0, "Resolving files…")
    expected = 0
    try:
        info = HfApi().model_info(entry["repo"], files_metadata=True, token=token)
        for s in info.siblings or []:
            if not allow or any(fnmatch.fnmatch(s.rfilename, p) for p in allow):
                expected += s.size or 0
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "401" in msg or "403" in msg or "gated" in msg.lower():
            raise RuntimeError(
                f"{entry['repo']} is gated. Accept its license on huggingface.co and add your "
                "Hugging Face token in Settings → Local engine."
            ) from e

    done = threading.Event()
    baseline = _dir_size(target)

    def watch():
        while not done.wait(1.0):
            if expected:
                got = _dir_size(target) - baseline
                job.progress = min(0.99, got / expected)
                job.message = f"Downloading… {got / 1e9:.2f} / {expected / 1e9:.2f} GB"

    threading.Thread(target=watch, daemon=True).start()
    try:
        snapshot_download(entry["repo"], local_dir=str(target), allow_patterns=allow, token=token)
    finally:
        done.set()
