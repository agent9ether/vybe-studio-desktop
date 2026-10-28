// Types shared between the Electron main process and the renderer.

export type SongRecord = {
  id: string;
  title: string;
  style: string;
  lyrics: string;
  prompt: string;
  createdAt: number;
  cover: string; // gradient seed used when there is no image
  audioUrl?: string;
  imageUrl?: string;
  instrumentalUrl?: string;
  extractionStatus?: "none" | "processing" | "completed" | "failed";
  generationStatus?: "idle" | "generating" | "completed" | "failed";
  generationError?: string | null;
  engineId?: string;
  stems?: Record<string, string>;
  voiceCoverOf?: string;
  voiceName?: string;
  voiceReferenceId?: string;
};

export type VoiceRecord = {
  id: string;
  name: string;
  featureId: string;
  audioUrl: string;
  trainingStatus?: string | null;
  rvcModelUrl?: string | null;
  trainingPredictionId?: string | null;
  createdAt: number;
};

export type ArtistRecord = {
  id: string;
  name: string;
  genre?: string;
  bio?: string;
  styleDescription?: string;
  voiceProfile?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  signatureStyle?: string;
  visualPrompt?: string;
  createdAt: number;
  [key: string]: unknown;
};

export type PortfolioItem = {
  id: string;
  artistId: string;
  imageUrl: string;
  caption?: string;
  kind?: string;
  createdAt: number;
};

export type Profile = {
  displayName: string;
  username: string;
  bio: string;
  avatarUrl?: string;
};

// ── Providers ────────────────────────────────────────────────────

export type ConfigField = {
  key: string;
  label: string;
  type: "secret" | "text" | "url" | "select" | "number" | "textarea";
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string;
};

export type ProviderInfo = {
  id: string;
  name: string;
  kind: "cloud" | "local" | "plugin";
  description: string;
  docsUrl?: string;
  fields: ConfigField[];
  enabled: boolean;
  configured: boolean;
};

export type MusicEngine = {
  /** `${providerId}:${modelId}` */
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  description?: string;
  kind: "cloud" | "local" | "plugin";
  supportsLyrics: boolean;
  supportsInstrumental: boolean;
  maxDurationSec?: number;
  defaultDurationSec?: number;
  ready: boolean;
  notReadyReason?: string;
};

export type MusicRequest = {
  songId: string;
  engineId: string;
  prompt: string;
  lyrics: string;
  durationSec?: number;
  instrumental?: boolean;
  seed?: number;
};

// ── Jobs ─────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type Job<T = unknown> = {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number; // 0..1, -1 when unknown
  message?: string;
  log?: string[];
  result?: T;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

// ── Local engine / models ───────────────────────────────────────

export type LocalModel = {
  id: string;
  name: string;
  repo: string;
  backend: "musicgen" | "acestep" | "stable-audio" | "demucs";
  task: "music" | "stems";
  description: string;
  sizeGB: number;
  vramGB: number;
  license: string;
  supportsLyrics: boolean;
  maxDurationSec: number;
  defaultDurationSec: number;
  gated?: boolean;
  custom?: boolean;
  installed: boolean;
  installing?: boolean;
};

export type EngineStatus = {
  installed: boolean;
  running: boolean;
  starting: boolean;
  url?: string;
  device?: string;
  gpu?: string | null;
  torch?: string | null;
  error?: string | null;
  pythonDir: string;
  modelsDir: string;
};

// ── Settings ────────────────────────────────────────────────────

export type LlmSettings = {
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ImageEndpoint = { baseUrl: string; apiKey: string; model: string };

export type ImageSettings = {
  /** Id of an image preset (see IMAGE_PRESETS) or "none". */
  provider: string;
  /** Per-preset endpoint settings, so switching providers keeps each key. */
  configs: Record<string, ImageEndpoint>;
};

export type ImagePreset = {
  label: string;
  /** Which request format to use. */
  kind: "nvidia" | "openai" | "replicate" | "stability";
  baseUrl: string;
  model: string;
  models: string[];
  keyPlaceholder?: string;
  docsUrl?: string;
  help?: string;
};

export type AppSettings = {
  libraryDir: string;
  modelsDir: string;
  defaultEngineId: string | null;
  llm: LlmSettings;
  images: ImageSettings;
  stemsProvider: "local" | "replicate";
  providers: Record<string, { enabled: boolean; config: Record<string, string> }>;
  huggingFaceToken: string;
  engineDevice: "auto" | "cuda" | "cpu" | "mps";
  profile: Profile;
  onboarded: boolean;
};
