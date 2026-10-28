import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { MusicEngine, ProviderInfo } from "@shared/types";
import { getSettings, providerConfig } from "../settings";
import type { MusicProvider } from "./types";
import { minimax } from "./minimax";
import { replicate } from "./replicate";
import { elevenlabs } from "./elevenlabs";
import { customHttp } from "./custom-http";
import { localEngine } from "./local-engine";

const BUILTIN: MusicProvider[] = [localEngine, minimax, replicate, elevenlabs, customHttp];
let plugins: MusicProvider[] = [];

export function pluginsDir() {
  return path.join(app.getPath("userData"), "plugins");
}

/**
 * Load third-party providers from <userData>/plugins/*.js (or *.cjs).
 * Plugins run with full Node access inside the app — only install ones you trust.
 */
export function loadPlugins() {
  const dir = pluginsDir();
  fs.mkdirSync(dir, { recursive: true });
  const require = createRequire(import.meta.url);
  plugins = [];
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(c?js)$/.test(file)) continue;
    const full = path.join(dir, file);
    try {
      delete require.cache[full];
      const mod = require(full);
      const provider: MusicProvider = mod.default ?? mod;
      if (
        !provider?.id ||
        typeof provider.generate !== "function" ||
        typeof provider.listModels !== "function"
      ) {
        console.warn(`[plugins] ${file} does not export a music provider`);
        continue;
      }
      plugins.push({ ...provider, kind: "plugin", fields: provider.fields ?? [] });
    } catch (e) {
      console.error(`[plugins] failed to load ${file}:`, e);
    }
  }
  return plugins.map((p) => p.id);
}

export function allProviders(): MusicProvider[] {
  return [...BUILTIN, ...plugins];
}

export function getProvider(id: string) {
  const p = allProviders().find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** Config with field defaults filled in. */
export function resolvedConfig(p: MusicProvider) {
  const stored = providerConfig(p.id).config;
  const out: Record<string, string> = {};
  for (const f of p.fields) {
    const v = stored[f.key];
    out[f.key] = v === undefined || v === "" ? (f.default ?? "") : v;
  }
  return { ...stored, ...out };
}

function isEnabled(p: MusicProvider) {
  // The local engine is always on; cloud providers are opt-in.
  if (p.id === "local") return true;
  return providerConfig(p.id).enabled;
}

export function providerInfos(): ProviderInfo[] {
  return allProviders().map((p) => {
    const config = resolvedConfig(p);
    return {
      id: p.id,
      name: p.name,
      kind: p.kind ?? "cloud",
      description: p.description,
      docsUrl: p.docsUrl,
      fields: p.fields,
      enabled: isEnabled(p),
      configured: p.isConfigured ? p.isConfigured(config) : true,
    };
  });
}

export async function listEngines(): Promise<MusicEngine[]> {
  const out: MusicEngine[] = [];
  for (const p of allProviders()) {
    if (!isEnabled(p)) continue;
    const config = resolvedConfig(p);
    const configured = p.isConfigured ? p.isConfigured(config) : true;
    let models: Awaited<ReturnType<MusicProvider["listModels"]>> = [];
    try {
      models = await p.listModels(config);
    } catch (e) {
      console.warn(`[providers] ${p.id} listModels failed`, e);
    }
    for (const m of models) {
      out.push({
        id: `${p.id}:${m.id}`,
        providerId: p.id,
        providerName: p.name,
        modelId: m.id,
        label: m.label,
        description: m.description,
        kind: p.kind ?? "cloud",
        supportsLyrics: m.supportsLyrics,
        supportsInstrumental: m.supportsInstrumental ?? true,
        maxDurationSec: m.maxDurationSec,
        defaultDurationSec: m.defaultDurationSec,
        ready: configured,
        notReadyReason: configured
          ? undefined
          : `Add your ${p.name} credentials in Settings → Engines`,
      });
    }
  }
  const preferred = getSettings().defaultEngineId;
  return out.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
}

export function splitEngineId(engineId: string) {
  const i = engineId.indexOf(":");
  if (i < 0) throw new Error(`Invalid engine id: ${engineId}`);
  return { providerId: engineId.slice(0, i), modelId: engineId.slice(i + 1) };
}
