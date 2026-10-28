import type { ConfigField } from "@shared/types";

/**
 * A music provider turns (prompt, lyrics) into an audio file.
 *
 * Built-in providers live in this folder. Third-party providers can be dropped
 * into <userData>/plugins as CommonJS modules exporting an object of this shape
 * (see docs/PROVIDERS.md).
 */
export type MusicProviderModel = {
  id: string;
  label: string;
  description?: string;
  supportsLyrics: boolean;
  supportsInstrumental?: boolean;
  maxDurationSec?: number;
  defaultDurationSec?: number;
};

export type GenerateInput = {
  model: string;
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  durationSec?: number;
  seed?: number;
};

export type GenerateContext = {
  config: Record<string, string>;
  signal: AbortSignal;
  progress: (p: number, message?: string) => void;
  log: (line: string) => void;
  /** Absolute path to write output to, if the provider produces raw bytes. */
  outputDir: string;
};

/** Return one of: a remote URL, raw bytes, or a path to a file already on disk. */
export type GenerateResult =
  | { url: string; headers?: Record<string, string> }
  | { bytes: Uint8Array; ext: string }
  | { filePath: string };

export type MusicProvider = {
  id: string;
  name: string;
  kind?: "cloud" | "local" | "plugin";
  description: string;
  docsUrl?: string;
  fields: ConfigField[];
  /** Whether the stored config is enough to call the provider. */
  isConfigured?: (config: Record<string, string>) => boolean;
  listModels: (
    config: Record<string, string>,
  ) => MusicProviderModel[] | Promise<MusicProviderModel[]>;
  generate: (input: GenerateInput, ctx: GenerateContext) => Promise<GenerateResult>;
};

export function isInstrumentalLyrics(lyrics: string) {
  const text = lyrics.trim();
  const stripped = text.replace(/\[[^\]]+\]/g, "").trim();
  return (
    text === "" ||
    text.toLowerCase().replace(/\s+/g, "") === "[instrumental]" ||
    stripped === "" ||
    !/[a-zA-Z]{3,}/.test(stripped)
  );
}
