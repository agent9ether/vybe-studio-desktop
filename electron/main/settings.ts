import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AppSettings, ImagePreset } from "@shared/types";

// Settings live in userData/settings.json. Secret values (API keys, tokens)
// are encrypted with the OS keychain via safeStorage when it is available.

const SECRET_PREFIX = "enc:";
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

export const LLM_PRESETS: Record<
  string,
  { label: string; baseUrl: string; model: string; needsKey: boolean }
> = {
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    needsKey: false,
  },
  lmstudio: {
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    needsKey: false,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    needsKey: true,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.1-70b-instruct",
    needsKey: true,
  },
  minimax: {
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    model: "MiniMax-M2.5",
    needsKey: true,
  },
  nvidia: {
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.1-70b-instruct",
    needsKey: true,
  },
  custom: { label: "Custom (OpenAI-compatible)", baseUrl: "", model: "", needsKey: false },
  none: { label: "None — use built-in templates", baseUrl: "", model: "", needsKey: false },
};

export const IMAGE_PRESETS: Record<string, ImagePreset> = {
  nvidia: {
    label: "NVIDIA NIM",
    kind: "nvidia",
    baseUrl: "https://ai.api.nvidia.com/v1/genai",
    model: "black-forest-labs/flux.1-schnell",
    models: [
      "black-forest-labs/flux.1-schnell",
      "black-forest-labs/flux.1-dev",
      "stabilityai/stable-diffusion-3-medium",
      "stabilityai/stable-diffusion-xl",
    ],
    keyPlaceholder: "nvapi-…",
    docsUrl: "https://build.nvidia.com/search?q=image",
    help: "Free API keys at build.nvidia.com. Self-hosted NIM: set the base URL to your server.",
  },
  openai: {
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-1",
    models: ["gpt-image-1", "dall-e-3", "dall-e-2"],
    keyPlaceholder: "sk-…",
    docsUrl: "https://platform.openai.com/docs/guides/image-generation",
  },
  replicate: {
    label: "Replicate",
    kind: "replicate",
    baseUrl: "https://api.replicate.com/v1",
    model: "black-forest-labs/flux-schnell",
    models: [
      "black-forest-labs/flux-schnell",
      "black-forest-labs/flux-dev",
      "black-forest-labs/flux-1.1-pro",
      "ideogram-ai/ideogram-v3-turbo",
    ],
    keyPlaceholder: "r8_… (empty = reuse your Replicate music token)",
    docsUrl: "https://replicate.com/collections/text-to-image",
  },
  together: {
    label: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    model: "black-forest-labs/FLUX.1-schnell",
    models: ["black-forest-labs/FLUX.1-schnell", "black-forest-labs/FLUX.1-dev"],
    docsUrl: "https://docs.together.ai/docs/images-overview",
  },
  stability: {
    label: "Stability AI",
    kind: "stability",
    baseUrl: "https://api.stability.ai",
    model: "core",
    models: ["core", "ultra", "sd3"],
    keyPlaceholder: "sk-…",
    docsUrl: "https://platform.stability.ai/docs/api-reference",
  },
  custom: {
    label: "Custom (OpenAI-compatible /images endpoint)",
    kind: "openai",
    baseUrl: "",
    model: "",
    models: [],
    help: "Any server implementing POST {base}/images/generations — e.g. LocalAI, a ComfyUI bridge or a proxy.",
  },
};

function defaults(): AppSettings {
  const userData = app.getPath("userData");
  return {
    libraryDir: path.join(userData, "library"),
    modelsDir: path.join(userData, "models"),
    defaultEngineId: null,
    llm: { preset: "ollama", ...pick(LLM_PRESETS.ollama), apiKey: "" },
    images: { provider: "none", configs: {} },
    stemsProvider: "local",
    providers: {},
    huggingFaceToken: "",
    engineDevice: "auto",
    profile: { displayName: "Producer", username: "producer", bio: "" },
    onboarded: false,
  };
}

function pick(p: { baseUrl: string; model: string }) {
  return { baseUrl: p.baseUrl, model: p.model };
}

// Keys whose values are treated as secrets anywhere in the settings tree.
const SECRET_KEYS = new Set(["apiKey", "token", "apiToken", "huggingFaceToken", "secret"]);

function mapSecrets(value: unknown, fn: (s: string) => string, key?: string): unknown {
  if (typeof value === "string") return key && SECRET_KEYS.has(key) && value ? fn(value) : value;
  if (Array.isArray(value)) return value.map((v) => mapSecrets(v, fn));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapSecrets(v, fn, k);
    return out;
  }
  return value;
}

function encrypt(s: string) {
  if (s.startsWith(SECRET_PREFIX) || !safeStorage.isEncryptionAvailable()) return s;
  return SECRET_PREFIX + safeStorage.encryptString(s).toString("base64");
}

function decrypt(s: string) {
  if (!s.startsWith(SECRET_PREFIX)) return s;
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(SECRET_PREFIX.length), "base64"));
  } catch {
    return "";
  }
}

let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cache) return cache;
  const base = defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    const loaded = mapSecrets(raw, decrypt) as Partial<AppSettings>;
    cache = {
      ...base,
      ...loaded,
      llm: { ...base.llm, ...loaded.llm },
      images: { ...base.images, ...loaded.images },
      profile: { ...base.profile, ...loaded.profile },
      providers: { ...loaded.providers },
    };
  } catch {
    cache = base;
  }
  return cache;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    llm: { ...current.llm, ...patch.llm },
    images: { ...current.images, ...patch.images },
    profile: { ...current.profile, ...patch.profile },
    providers: { ...current.providers, ...patch.providers },
  };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  const tmp = settingsFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(mapSecrets(next, encrypt), null, 2));
  fs.renameSync(tmp, settingsFile());
  cache = next;
  return next;
}

export function providerConfig(id: string): { enabled: boolean; config: Record<string, string> } {
  return getSettings().providers[id] ?? { enabled: false, config: {} };
}
