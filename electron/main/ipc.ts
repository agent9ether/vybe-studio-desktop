import { app, dialog, ipcMain, shell, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AppSettings } from "@shared/types";
import { reloadDb, runQuery, type Query } from "./db";
import { getSettings, saveSettings, IMAGE_PRESETS, LLM_PRESETS } from "./settings";
import {
  isMediaUrl,
  pathForMediaUrl,
  removeMedia,
  saveBytes,
  saveBytesAt,
  saveFromUrl,
  urlForRelPath,
} from "./media";
import { cancelJob, getJob, listJobs } from "./jobs";
import { listEngines, loadPlugins, pluginsDir, providerInfos } from "./providers";
import { startMusicGeneration, activeJobForSong } from "./music";
import { generateLyrics } from "./llm";
import { generateCoverArt, generateImage } from "./images";
import { clearStems, startStemExtraction } from "./stems";
import { resetVoiceTrainingStatus, startRvcTraining, startVocalTransform } from "./voice";
import { generatePortfolio, generateScene } from "./artists";
import {
  engineFetch,
  engineLog,
  engineStatus,
  installEngine,
  restartEngine,
  startEngine,
  stopEngine,
} from "./engine";
import { waitEngineJob } from "./engine";
import { listLocalModels } from "./providers/local-engine";
import { startJob } from "./jobs";

type Handler = (payload: any) => unknown;

// Every renderer call goes through one channel: invoke(name, payload).
// Errors are returned as { error } so their messages survive the IPC boundary.
const handlers: Record<string, Handler> = {
  // Data
  "db:query": (q: Query) => runQuery(q),
  "storage:upload": ({ path: rel, bytes }: { path: string; bytes: ArrayBuffer }) =>
    saveBytesAt(rel, Buffer.from(bytes)).url,
  "storage:url": ({ path: rel }: { path: string }) => urlForRelPath(rel),
  "storage:remove": ({ urls }: { urls: string[] }) => urls.forEach(removeMedia),
  "media:import": ({
    name,
    bytes,
    subdir,
  }: {
    name: string;
    bytes: ArrayBuffer;
    subdir?: string;
  }) => saveBytes(Buffer.from(bytes), name, subdir ?? "imports").url,
  "media:fetch": async ({ url, name, subdir }: { url: string; name: string; subdir?: string }) =>
    (await saveFromUrl(url, name, subdir ?? "imports")).url,
  "media:export": async ({ url, name }: { url: string; name: string }) => {
    const win = BrowserWindow.getFocusedWindow();
    const opts = { defaultPath: path.join(app.getPath("music"), name) };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    if (isMediaUrl(url)) fs.copyFileSync(pathForMediaUrl(url), res.filePath);
    else fs.writeFileSync(res.filePath, Buffer.from(await (await fetch(url)).arrayBuffer()));
    return res.filePath;
  },
  "media:reveal": ({ url }: { url: string }) => {
    if (isMediaUrl(url)) shell.showItemInFolder(pathForMediaUrl(url));
  },

  // Settings
  "settings:get": () => getSettings(),
  "settings:set": (patch: Partial<AppSettings>) => {
    const before = getSettings().libraryDir;
    const next = saveSettings(patch);
    if (next.libraryDir !== before) reloadDb();
    return next;
  },
  "settings:llmPresets": () => LLM_PRESETS,
  "settings:imagePresets": () => IMAGE_PRESETS,
  "settings:chooseDir": async ({ title }: { title?: string }) => {
    const res = await dialog.showOpenDialog({
      title,
      properties: ["openDirectory", "createDirectory"],
    });
    return res.canceled ? null : res.filePaths[0];
  },
  "app:info": () => ({
    version: app.getVersion(),
    userData: app.getPath("userData"),
    pluginsDir: pluginsDir(),
    platform: process.platform,
  }),
  "app:openPath": ({ path: p }: { path: string }) => shell.openPath(p),
  "app:openExternal": ({ url }: { url: string }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  },

  // Providers & generation
  "providers:list": () => providerInfos(),
  "providers:reloadPlugins": () => loadPlugins(),
  "music:engines": () => listEngines(),
  "music:start": (req) => startMusicGeneration(req),
  "music:activeJob": ({ songId }: { songId: string }) => activeJobForSong(songId),
  "lyrics:generate": (req) => generateLyrics(req),
  "images:cover": (req) => generateCoverArt(req),
  "images:generate": ({ prompt }: { prompt: string }) => generateImage(prompt),
  "stems:start": (data) => startStemExtraction(data),
  "stems:clear": ({ songId }: { songId: string }) => clearStems(songId),
  "voice:train": ({ voiceRefId }: { voiceRefId: string }) => startRvcTraining(voiceRefId),
  "voice:transform": (data) => startVocalTransform(data),
  "voice:reset": ({ voiceRefId }: { voiceRefId: string }) => resetVoiceTrainingStatus(voiceRefId),
  "artists:portfolio": (body) => generatePortfolio(body),
  "artists:scene": (body) => generateScene(body),

  // Jobs
  "jobs:get": ({ id }: { id: string }) => getJob(id),
  "jobs:list": ({ kind }: { kind?: string } = {}) => listJobs(kind),
  "jobs:cancel": ({ id }: { id: string }) => cancelJob(id),

  // Local engine
  "engine:status": () => engineStatus(),
  "engine:log": () => engineLog(),
  "engine:install": (opts) => installEngine(opts ?? { torch: "auto" }),
  "engine:start": async () => {
    await startEngine();
    return engineStatus();
  },
  "engine:stop": async () => {
    await stopEngine();
    return engineStatus();
  },
  "engine:restart": async () => {
    await restartEngine();
    return engineStatus();
  },
  "models:list": () => listLocalModels(),
  "models:download": ({ id }: { id: string }) =>
    startJob(`model-download:${id}`, async (ctx) => {
      const { jobId } = await engineFetch<{ jobId: string }>(
        `/models/${encodeURIComponent(id)}/download`,
        {
          method: "POST",
        },
      );
      return waitEngineJob(jobId, ctx);
    }),
  "models:delete": ({ id }: { id: string }) =>
    engineFetch(`/models/${encodeURIComponent(id)}`, { method: "DELETE" }),
  "models:addCustom": (body) =>
    engineFetch("/models/custom", { method: "POST", body: JSON.stringify(body) }),
  "models:unload": () => engineFetch("/unload", { method: "POST" }),
};

export function registerIpc() {
  ipcMain.handle("vybe:invoke", async (_e, name: string, payload: unknown) => {
    const fn = handlers[name];
    if (!fn) return { error: `Unknown command: ${name}` };
    try {
      return { data: await fn(payload) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}
