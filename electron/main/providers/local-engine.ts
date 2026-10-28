import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LocalModel } from "@shared/types";
import type { MusicProvider } from "./types";
import {
  engineFetch,
  engineStatus,
  isEngineInstalled,
  startEngine,
  waitEngineJob,
} from "../engine";
import { getSettings } from "../settings";

// The model catalog lives in the Python engine. We cache its last answer on
// disk so the UI can list local engines instantly while Python is starting.

const cacheFile = () => path.join(getSettings().modelsDir, ".catalog-cache.json");

export async function listLocalModels(): Promise<LocalModel[]> {
  if (!isEngineInstalled()) return [];
  const models = await engineFetch<LocalModel[]>("/models");
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(models));
  } catch {
    // cache is best-effort
  }
  return models;
}

function cachedLocalModels(): LocalModel[] {
  try {
    const models = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as LocalModel[];
    const dir = getSettings().modelsDir;
    return models.map((m) => ({
      ...m,
      installed: fs.existsSync(path.join(dir, m.id, ".vybe-complete")),
    }));
  } catch {
    return [];
  }
}

export const localEngine: MusicProvider = {
  id: "local",
  name: "Local models",
  kind: "local",
  description: "Open-source models running on your own GPU/CPU through the bundled Python engine.",
  fields: [],
  isConfigured: () => isEngineInstalled(),
  async listModels() {
    if (!isEngineInstalled()) return [];
    let models: LocalModel[] = [];
    if (engineStatus().running) {
      models = await listLocalModels().catch(() => cachedLocalModels());
    } else if (!fs.existsSync(cacheFile())) {
      // First run: nothing cached yet, so wait for the engine once.
      models = await listLocalModels().catch(() => []);
    } else {
      models = cachedLocalModels();
      // Warm the engine up so the first generation starts quickly.
      void startEngine()
        .then(() => listLocalModels())
        .catch(() => {});
    }
    return models
      .filter((m) => m.task === "music" && m.installed)
      .map((m) => ({
        id: m.id,
        label: m.name,
        description: m.description,
        supportsLyrics: m.supportsLyrics,
        supportsInstrumental: true,
        maxDurationSec: m.maxDurationSec,
        defaultDurationSec: m.defaultDurationSec,
      }));
  },
  async generate(input, ctx) {
    const outPath = path.join(ctx.outputDir, `${input.model}-${randomUUID().slice(0, 8)}.wav`);
    const { jobId } = await engineFetch<{ jobId: string }>("/generate", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        lyrics: input.instrumental ? "" : input.lyrics,
        duration: input.durationSec,
        seed: input.seed,
        out_path: outPath,
      }),
    });
    await waitEngineJob(jobId, ctx);
    return { filePath: outPath };
  },
};
