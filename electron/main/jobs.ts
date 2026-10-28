import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { Job } from "@shared/types";

// In-memory registry of long-running work (generation, downloads, installs).
// The renderer can poll jobs:get or listen for "jobs:update" broadcasts.

const jobs = new Map<string, Job>();
const controllers = new Map<string, AbortController>();

export type JobContext = {
  id: string;
  signal: AbortSignal;
  progress: (p: number, message?: string) => void;
  log: (line: string) => void;
};

function broadcast(job: Job) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("jobs:update", job);
  }
}

function touch(job: Job, patch: Partial<Job>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  broadcast(job);
}

export function startJob<T>(
  kind: string,
  run: (ctx: JobContext) => Promise<T>,
  opts: { onDone?: (result: T) => void; onError?: (err: Error) => void } = {},
): Job<T> {
  const id = randomUUID();
  const now = Date.now();
  const job: Job<T> = {
    id,
    kind,
    status: "running",
    progress: -1,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  const controller = new AbortController();
  controllers.set(id, controller);

  const ctx: JobContext = {
    id,
    signal: controller.signal,
    progress: (p, message) => touch(job, { progress: p, ...(message ? { message } : {}) }),
    log: (line) => {
      job.log = [...(job.log ?? []).slice(-400), line];
      touch(job, { message: line.slice(0, 300) });
    },
  };

  queueMicrotask(async () => {
    try {
      const result = await run(ctx);
      touch(job, { status: "succeeded", progress: 1, result });
      opts.onDone?.(result);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const canceled = controller.signal.aborted;
      touch(job, {
        status: canceled ? "canceled" : "failed",
        error: canceled ? "Canceled" : err.message,
      });
      opts.onError?.(err);
    } finally {
      controllers.delete(id);
      // Forget finished jobs after an hour.
      setTimeout(() => jobs.delete(id), 60 * 60 * 1000);
    }
  });
  broadcast(job);
  return job;
}

export function getJob(id: string) {
  return jobs.get(id) ?? null;
}

export function listJobs(kind?: string) {
  return [...jobs.values()].filter((j) => !kind || j.kind === kind);
}

export function cancelJob(id: string) {
  controllers.get(id)?.abort();
  return true;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Canceled"));
    });
  });
