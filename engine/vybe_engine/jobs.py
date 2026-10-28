from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable


class Canceled(Exception):
    pass


class Job:
    def __init__(self, kind: str):
        self.id = uuid.uuid4().hex
        self.kind = kind
        self.status = "queued"
        self.progress = -1.0
        self.message = ""
        self.result: Any = None
        self.error: str | None = None
        self.cancel_requested = False
        self.created = time.time()

    def update(self, progress: float | None = None, message: str | None = None) -> None:
        if self.cancel_requested:
            raise Canceled()
        if progress is not None:
            self.progress = float(progress)
        if message is not None:
            self.message = message

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "result": self.result,
            "error": self.error,
        }


class JobRunner:
    """GPU work runs one job at a time; downloads run in parallel on a separate pool."""

    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.gpu = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gpu")
        self.io = ThreadPoolExecutor(max_workers=3, thread_name_prefix="io")
        self.lock = threading.Lock()

    def submit(self, kind: str, fn: Callable[[Job], Any], pool: str = "gpu") -> Job:
        job = Job(kind)
        with self.lock:
            self.jobs[job.id] = job

        def run() -> None:
            if job.cancel_requested:
                job.status = "canceled"
                return
            job.status = "running"
            try:
                job.result = fn(job)
                job.status = "succeeded"
                job.progress = 1.0
            except Canceled:
                job.status = "canceled"
                job.error = "Canceled"
            except Exception as e:  # noqa: BLE001 - report anything to the app
                traceback.print_exc()
                job.status = "failed"
                job.error = f"{type(e).__name__}: {e}"

        (self.io if pool == "io" else self.gpu).submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def active(self, kind: str) -> list[Job]:
        return [j for j in self.jobs.values() if j.kind == kind and j.status in ("queued", "running")]
