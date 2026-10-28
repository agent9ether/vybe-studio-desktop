import type { MusicProvider } from "./types";

function friendlyError(code: number, msg: string) {
  const lower = (msg || "").toLowerCase();
  if (code === 2013 || lower.includes("sensitive")) {
    if (lower.includes("lyrics"))
      return "Your lyrics were flagged as sensitive by MiniMax. Try rewording them.";
    return "Your prompt was flagged as sensitive by MiniMax. Try rewording it (remove brand names or explicit content).";
  }
  if (code === 1004 || lower.includes("auth"))
    return "MiniMax rejected the API key. Check it in Settings → Engines.";
  if (code === 1008 || lower.includes("insufficient"))
    return "Your MiniMax account is out of quota.";
  return msg || `MiniMax generation failed (code ${code}).`;
}

export const minimax: MusicProvider = {
  id: "minimax",
  name: "MiniMax",
  kind: "cloud",
  description: "MiniMax Music — full songs with vocals from a style prompt and lyrics.",
  docsUrl: "https://platform.minimax.io/docs/api-reference/music-generation",
  fields: [
    { key: "apiKey", label: "API key", type: "secret", placeholder: "eyJhbGciOi…" },
    {
      key: "baseUrl",
      label: "API base URL",
      type: "url",
      default: "https://api.minimax.io/v1",
      help: "Use https://api.minimaxi.com/v1 for mainland-China accounts.",
    },
  ],
  isConfigured: (c) => !!c.apiKey,
  listModels: () => [
    {
      id: "music-2.6",
      label: "music-2.6",
      description: "Latest MiniMax music model",
      supportsLyrics: true,
      supportsInstrumental: true,
    },
    {
      id: "music-1.5",
      label: "music-1.5",
      description: "Faster, shorter songs",
      supportsLyrics: true,
      supportsInstrumental: true,
    },
  ],
  async generate(input, ctx) {
    const base = (ctx.config.baseUrl || "https://api.minimax.io/v1").replace(/\/+$/, "");
    const payload: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt.slice(0, 2000),
      lyrics_optimizer: false,
      output_format: "url",
      audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" },
    };
    if (input.instrumental) {
      payload.is_instrumental = true;
      payload.lyrics = "[Instrumental]";
    } else {
      payload.lyrics = input.lyrics.slice(0, 3500);
    }
    ctx.progress(-1, "Waiting for MiniMax…");
    const res = await fetch(`${base}/music_generation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`MiniMax ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as any;
    const code = json.base_resp?.status_code ?? 0;
    if (code !== 0 || !json.data?.audio)
      throw new Error(friendlyError(code, json.base_resp?.status_msg));
    const audio: string = json.data.audio;
    if (/^https?:\/\//.test(audio)) return { url: audio };
    // Some accounts return hex-encoded audio regardless of output_format.
    return { bytes: Buffer.from(audio, "hex"), ext: ".mp3" };
  },
};
