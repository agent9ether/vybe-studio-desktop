import type { Job } from "@shared/types";

type Bridge = {
  invoke: <T = unknown>(name: string, payload?: unknown) => Promise<T>;
  onJobUpdate: (cb: (job: Job) => void) => () => void;
};

declare global {
  interface Window {
    vybe: Bridge;
  }
}

export const invoke = <T = unknown>(name: string, payload?: unknown) =>
  window.vybe.invoke<T>(name, payload);

export const onJobUpdate = (cb: (job: Job) => void) => window.vybe.onJobUpdate(cb);

/** Resolve when a background job finishes; reports progress along the way. */
export function waitForJob<T = unknown>(id: string, onProgress?: (job: Job) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const settle = (job: Job | null) => {
      if (done || !job || job.id !== id) return;
      onProgress?.(job);
      if (job.status === "succeeded") {
        done = true;
        off();
        clearInterval(timer);
        resolve(job.result as T);
      } else if (job.status === "failed" || job.status === "canceled") {
        done = true;
        off();
        clearInterval(timer);
        reject(new Error(job.error ?? `Job ${job.status}`));
      }
    };
    const off = onJobUpdate(settle);
    // Polling backup in case an update was missed.
    const timer = setInterval(
      () =>
        invoke<Job | null>("jobs:get", { id })
          .then(settle)
          .catch(() => {}),
      2000,
    );
    invoke<Job | null>("jobs:get", { id })
      .then(settle)
      .catch(() => {});
  });
}
