import fs from "node:fs";
import path from "node:path";
import type { MusicRequest } from "@shared/types";
import { db } from "./db";
import { startJob } from "./jobs";
import { mediaDir, mediaUrlFor, saveBytes, saveFromUrl } from "./media";
import { getProvider, resolvedConfig, splitEngineId } from "./providers";
import { isInstrumentalLyrics } from "./providers/types";

// Runs a music generation as a background job and writes the result onto the song row.

const activeBySong = new Map<string, string>();

export function startMusicGeneration(req: MusicRequest) {
  const { providerId, modelId } = splitEngineId(req.engineId);
  const provider = getProvider(providerId);
  const config = resolvedConfig(provider);
  if (provider.isConfigured && !provider.isConfigured(config)) {
    throw new Error(
      `${provider.name} is not configured. Add your credentials in Settings → Engines.`,
    );
  }

  const instrumental = req.instrumental ?? isInstrumentalLyrics(req.lyrics);
  db.update("songs", req.songId, {
    generation_status: "generating",
    extraction_status: "generating_audio",
    generation_error: null,
    engine_id: req.engineId,
  });

  const outputDir = path.join(mediaDir(), "songs");
  fs.mkdirSync(outputDir, { recursive: true });

  const job = startJob(
    "music",
    async (ctx) => {
      ctx.progress(-1, `Starting ${provider.name} · ${modelId}…`);
      const result = await provider.generate(
        {
          model: modelId,
          prompt: req.prompt,
          lyrics: req.lyrics,
          instrumental,
          durationSec: req.durationSec,
          seed: req.seed,
        },
        { config, signal: ctx.signal, progress: ctx.progress, log: ctx.log, outputDir },
      );
      ctx.progress(0.98, "Saving to your library…");
      let audioUrl: string;
      if ("url" in result) {
        audioUrl = (await saveFromUrl(result.url, `${req.songId}.mp3`, "songs", result.headers))
          .url;
      } else if ("bytes" in result) {
        audioUrl = saveBytes(result.bytes, `${req.songId}${result.ext}`, "songs").url;
      } else {
        audioUrl = mediaUrlFor(result.filePath);
      }
      db.update("songs", req.songId, {
        audio_url: audioUrl,
        generation_status: "completed",
        extraction_status: "none",
        stems: null,
        instrumental_url: null,
      });
      return { audioUrl };
    },
    {
      onError: (err) => {
        db.update("songs", req.songId, {
          generation_status: "failed",
          extraction_status: "failed",
          generation_error: err.message,
        });
      },
    },
  );
  activeBySong.set(req.songId, job.id);
  return { jobId: job.id };
}

export function activeJobForSong(songId: string) {
  return activeBySong.get(songId) ?? null;
}
