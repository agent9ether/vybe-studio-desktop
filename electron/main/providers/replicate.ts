import type { MusicProvider, MusicProviderModel } from "./types";
import { createPrediction, firstOutputUrl, waitForPrediction } from "../replicate";

type ReplicateModel = MusicProviderModel & {
  slug: string;
  buildInput: (i: {
    prompt: string;
    lyrics: string;
    instrumental: boolean;
    durationSec?: number;
    seed?: number;
  }) => Record<string, unknown>;
};

const MODELS: ReplicateModel[] = [
  {
    id: "minimax/music-1.5",
    slug: "minimax/music-1.5",
    label: "MiniMax music-1.5",
    description: "Songs with vocals, up to ~4 min",
    supportsLyrics: true,
    supportsInstrumental: true,
    buildInput: ({ prompt, lyrics, instrumental }) => ({
      prompt: prompt.slice(0, 600),
      lyrics: instrumental ? "[instrumental]" : lyrics.slice(0, 600),
    }),
  },
  {
    id: "minimax/music-2.6",
    slug: "minimax/music-2.6",
    label: "MiniMax music-2.6",
    description: "Latest MiniMax model via Replicate",
    supportsLyrics: true,
    supportsInstrumental: true,
    buildInput: ({ prompt, lyrics, instrumental }) => ({
      prompt: prompt.slice(0, 2000),
      lyrics: instrumental ? "[instrumental]" : lyrics.slice(0, 3000),
      lyrics_optimizer: false,
    }),
  },
  {
    id: "meta/musicgen",
    slug: "meta/musicgen",
    label: "MusicGen (stereo large)",
    description: "Instrumentals only",
    supportsLyrics: false,
    supportsInstrumental: true,
    maxDurationSec: 30,
    defaultDurationSec: 20,
    buildInput: ({ prompt, durationSec, seed }) => ({
      prompt,
      model_version: "stereo-large",
      duration: Math.min(30, Math.max(1, Math.round(durationSec ?? 20))),
      output_format: "wav",
      ...(seed != null ? { seed } : {}),
    }),
  },
];

export const replicate: MusicProvider = {
  id: "replicate",
  name: "Replicate",
  kind: "cloud",
  description: "Run hosted music models on Replicate (MiniMax, MusicGen, or any model you add).",
  docsUrl: "https://replicate.com/collections/ai-music-generation",
  fields: [
    { key: "apiKey", label: "API token", type: "secret", placeholder: "r8_…" },
    {
      key: "customModels",
      label: "Extra models",
      type: "textarea",
      placeholder: "owner/model  (one per line, optionally owner/model:version)",
      help: "Each extra model receives { prompt, lyrics, duration }. Use this for any Replicate model that accepts those inputs.",
    },
  ],
  isConfigured: (c) => !!c.apiKey,
  listModels(config) {
    const extra = (config.customModels ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map<MusicProviderModel>((slug) => ({
        id: slug,
        label: slug,
        supportsLyrics: true,
        supportsInstrumental: true,
      }));
    return [...MODELS, ...extra].map(
      ({
        id,
        label,
        description,
        supportsLyrics,
        supportsInstrumental,
        maxDurationSec,
        defaultDurationSec,
      }) => ({
        id,
        label,
        description,
        supportsLyrics,
        supportsInstrumental,
        maxDurationSec,
        defaultDurationSec,
      }),
    );
  },
  async generate(input, ctx) {
    const known = MODELS.find((m) => m.id === input.model);
    const body = known
      ? known.buildInput(input)
      : {
          prompt: input.prompt,
          lyrics: input.instrumental ? "[instrumental]" : input.lyrics,
          ...(input.durationSec ? { duration: Math.round(input.durationSec) } : {}),
        };
    const token = ctx.config.apiKey;
    ctx.progress(-1, "Queued on Replicate…");
    const pred = await createPrediction(token, known?.slug ?? input.model, body);
    const done = await waitForPrediction(token, pred, {
      signal: ctx.signal,
      timeoutMs: 15 * 60 * 1000,
      onTick: (p) =>
        ctx.progress(
          -1,
          p.status === "processing" ? "Generating on Replicate…" : "Starting model…",
        ),
    });
    const url = firstOutputUrl(done.output);
    if (!url) throw new Error("Replicate returned no audio");
    return { url };
  },
};
