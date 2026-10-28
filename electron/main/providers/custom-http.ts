import type { MusicProvider } from "./types";

/**
 * "Bring your own API". POSTs JSON to any endpoint and accepts several common
 * response shapes, so self-hosted servers or other SaaS can be plugged in
 * without writing code. Contract is documented in docs/PROVIDERS.md.
 */
export const customHttp: MusicProvider = {
  id: "custom-http",
  name: "Custom HTTP API",
  kind: "cloud",
  description: "Point Vybe at any HTTP endpoint that returns audio (self-hosted or third-party).",
  fields: [
    {
      key: "url",
      label: "Endpoint URL",
      type: "url",
      placeholder: "http://localhost:8000/generate",
    },
    { key: "apiKey", label: "Bearer token (optional)", type: "secret" },
    {
      key: "models",
      label: "Model names",
      type: "text",
      placeholder: "default",
      help: "Comma-separated; sent as `model`.",
    },
    {
      key: "lyrics",
      label: "Supports lyrics",
      type: "select",
      default: "yes",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No (instrumental only)" },
      ],
    },
  ],
  isConfigured: (c) => !!c.url,
  listModels(config) {
    const names = (config.models || "default")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return names.map((id) => ({
      id,
      label: id,
      supportsLyrics: config.lyrics !== "no",
      supportsInstrumental: true,
      maxDurationSec: 600,
      defaultDurationSec: 60,
    }));
  },
  async generate(input, ctx) {
    ctx.progress(-1, "Calling custom endpoint…");
    const res = await fetch(ctx.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ctx.config.apiKey ? { Authorization: `Bearer ${ctx.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        lyrics: input.lyrics,
        instrumental: input.instrumental,
        duration: input.durationSec,
        seed: input.seed,
      }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`Endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("audio/")) {
      const ext = type.includes("wav") ? ".wav" : type.includes("flac") ? ".flac" : ".mp3";
      return { bytes: new Uint8Array(await res.arrayBuffer()), ext };
    }
    const json = (await res.json()) as any;
    const url = json.audio_url ?? json.audioUrl ?? json.url ?? json.output?.audio_url;
    if (typeof url === "string") return { url };
    const b64 = json.audio_base64 ?? json.audioBase64;
    if (typeof b64 === "string")
      return { bytes: Buffer.from(b64, "base64"), ext: `.${json.format ?? "mp3"}` };
    throw new Error("Endpoint response had no audio_url or audio_base64");
  },
};
