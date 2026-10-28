import { contextBridge, ipcRenderer } from "electron";

// The only bridge between the UI and the main process.

const api = {
  invoke: async <T = unknown>(name: string, payload?: unknown): Promise<T> => {
    const res = (await ipcRenderer.invoke("vybe:invoke", name, payload)) as {
      data?: T;
      error?: string;
    };
    if (res?.error) throw new Error(res.error);
    return res.data as T;
  },
  onJobUpdate: (cb: (job: unknown) => void) => {
    const listener = (_: unknown, job: unknown) => cb(job);
    ipcRenderer.on("jobs:update", listener);
    return () => ipcRenderer.removeListener("jobs:update", listener);
  },
};

contextBridge.exposeInMainWorld("vybe", api);

export type VybeBridge = typeof api;
