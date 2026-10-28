import path from "node:path";
import { db } from "./db";
import { startJob, type JobContext } from "./jobs";
import { isMediaUrl, mediaDir, mediaUrlFor, pathForMediaUrl, saveFromUrl } from "./media";
import { engineFetch, isEngineInstalled, waitEngineJob } from "./engine";
import { getSettings, providerConfig } from "./settings";
import { createPrediction, toReplicateUrl, waitForPrediction } from "./replicate";
import type { LocalModel } from "@shared/types";

// Stem separation: Demucs on the local engine, or Demucs on Replicate.

const DEMUCS_VERSION =
  "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953";

type StemResult = { instrumentalUrl: string; stems: Record<string, string> };

async function ensureLocalFile(url: string, songId: string) {
  if (isMediaUrl(url)) return pathForMediaUrl(url);
  return (await saveFromUrl(url, `${songId}-source.mp3`, "imports")).path;
}

async function separateLocally(
  audioUrl: string,
  songId: string,
  ctx: JobContext,
): Promise<StemResult> {
  if (!isEngineInstalled()) {
    throw new Error(
      "Local stem separation needs the local engine. Install it from the Models page, or switch Stems to Replicate in Settings.",
    );
  }
  const models = await engineFetch<LocalModel[]>("/models");
  const preferred =
    models.find((m) => m.id === "htdemucs_ft" && m.installed) ??
    models.find((m) => m.id === "htdemucs");
  if (!preferred) throw new Error("Demucs is missing from the engine catalog");
  if (!preferred.installed) {
    ctx.progress(-1, "Downloading Demucs (first run only)…");
    const { jobId } = await engineFetch<{ jobId: string }>(`/models/${preferred.id}/download`, {
      method: "POST",
    });
    await waitEngineJob(jobId, ctx);
  }
  const input = await ensureLocalFile(audioUrl, songId);
  const outDir = path.join(mediaDir(), "stems", `${songId}-${Date.now()}`);
  const { jobId } = await engineFetch<{ jobId: string }>("/stems", {
    method: "POST",
    body: JSON.stringify({ model: preferred.id, input_path: input, out_dir: outDir }),
  });
  const result = await waitEngineJob<{ stems: Record<string, string> }>(jobId, ctx);
  const stems: Record<string, string> = {};
  for (const [name, file] of Object.entries(result.stems)) stems[name] = mediaUrlFor(file);
  const instrumentalUrl = stems.instrumental ?? stems.other;
  delete stems.instrumental;
  return { instrumentalUrl, stems };
}

async function separateOnReplicate(
  audioUrl: string,
  songId: string,
  ctx: JobContext,
): Promise<StemResult> {
  const token = providerConfig("replicate").config.apiKey;
  if (!token)
    throw new Error(
      "Add your Replicate token in Settings → Engines to separate stems in the cloud.",
    );
  ctx.progress(-1, "Uploading audio to Replicate…");
  const input = await toReplicateUrl(token, audioUrl);
  const pred = await createPrediction(token, DEMUCS_VERSION, {
    audio: input,
    model: "htdemucs",
    jobs: 1,
  });
  const done = await waitForPrediction(token, pred, {
    signal: ctx.signal,
    timeoutMs: 15 * 60 * 1000,
    onTick: () => ctx.progress(-1, "Separating on Replicate…"),
  });
  const output = done.output ?? {};
  const remote: Record<string, string> = {};
  for (const key of ["vocals", "drums", "bass", "other"])
    if (output[key]) remote[key] = output[key];
  const stems: Record<string, string> = {};
  for (const [key, url] of Object.entries(remote)) {
    ctx.progress(-1, `Saving ${key}…`);
    stems[key] = (await saveFromUrl(url, `${songId}-${key}.mp3`, "stems")).url;
  }
  if (!stems.other) throw new Error("Replicate returned no instrumental stem");
  return { instrumentalUrl: stems.other, stems };
}

export function startStemExtraction(data: { audioUrl: string; songId: string }) {
  const song = db.get("songs", data.songId);
  if (song) db.update("songs", data.songId, { extraction_status: "processing" });
  const job = startJob(
    "stems",
    async (ctx) => {
      const res =
        getSettings().stemsProvider === "replicate"
          ? await separateOnReplicate(data.audioUrl, data.songId, ctx)
          : await separateLocally(data.audioUrl, data.songId, ctx);
      if (song) {
        db.update("songs", data.songId, {
          instrumental_url: res.instrumentalUrl,
          stems: res.stems,
          extraction_status: "completed",
        });
      }
      return res;
    },
    {
      onError: () => {
        if (song) db.update("songs", data.songId, { extraction_status: "failed" });
      },
    },
  );
  return { isDemo: false, predictionId: job.id };
}

export function clearStems(songId: string) {
  db.update("songs", songId, { stems: null, instrumental_url: null, extraction_status: "none" });
  return { ok: true };
}
