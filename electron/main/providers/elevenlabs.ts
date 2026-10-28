import type { MusicProvider } from "./types";

export const elevenlabs: MusicProvider = {
  id: "elevenlabs",
  name: "ElevenLabs Music",
  kind: "cloud",
  description: "ElevenLabs Eleven Music — studio-quality songs from a text prompt.",
  docsUrl: "https://elevenlabs.io/docs/api-reference/music/compose",
  fields: [{ key: "apiKey", label: "API key", type: "secret", placeholder: "sk_…" }],
  isConfigured: (c) => !!c.apiKey,
  listModels: () => [
    {
      id: "music_v1",
      label: "Eleven Music v1",
      supportsLyrics: true,
      supportsInstrumental: true,
      maxDurationSec: 300,
      defaultDurationSec: 120,
    },
  ],
  async generate(input, ctx) {
    // The compose endpoint takes a single prompt; lyrics are folded into it.
    const prompt = input.instrumental
      ? `${input.prompt}. Instrumental only, no vocals.`
      : `${input.prompt}\n\nLyrics:\n${input.lyrics}`;
    ctx.progress(-1, "Composing with ElevenLabs…");
    const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": ctx.config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.slice(0, 4000),
        model_id: input.model,
        music_length_ms: Math.round((input.durationSec ?? 120) * 1000),
      }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), ext: ".mp3" };
  },
};
