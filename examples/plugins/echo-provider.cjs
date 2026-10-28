// Example Vybe Studio provider plugin.
//
// Copy this file into the plugins folder (Settings → Music engines → Open plugins
// folder) and click "Reload plugins". It needs no API key: it synthesises a short
// chord progression locally, which makes it handy for testing the pipeline and as
// a template for real providers. See docs/PROVIDERS.md.

const SAMPLE_RATE = 44100;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 0x7fff, i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Pick a chord progression from the prompt so different prompts sound different.
function progression(prompt) {
  const sad = /sad|rain|lonely|dark|melanchol/i.test(prompt);
  return sad
    ? [
        [57, 60, 64],
        [53, 57, 60],
        [48, 52, 55],
        [55, 59, 62],
      ] // Am F C G
    : [
        [48, 52, 55],
        [55, 59, 62],
        [57, 60, 64],
        [53, 57, 60],
      ]; // C G Am F
}

module.exports = {
  id: "echo-example",
  name: "Example: Chord Synth",
  description: "Demo plugin that renders a simple chord loop locally. Use it as a template.",
  fields: [
    {
      key: "bpm",
      label: "Tempo (BPM)",
      type: "number",
      default: "96",
    },
  ],
  listModels: () => [
    {
      id: "chords",
      label: "Chord loop",
      description: "Instant, offline, no vocals",
      supportsLyrics: false,
      maxDurationSec: 60,
      defaultDurationSec: 16,
    },
  ],
  async generate(input, ctx) {
    const bpm = Number(ctx.config.bpm) || 96;
    const seconds = input.durationSec || 16;
    const beat = 60 / bpm;
    const chords = progression(input.prompt);
    const samples = new Float32Array(Math.floor(seconds * SAMPLE_RATE));
    for (let i = 0; i < samples.length; i++) {
      const t = i / SAMPLE_RATE;
      const chord = chords[Math.floor(t / (beat * 4)) % chords.length];
      const env = Math.exp(-3 * ((t % beat) / beat));
      samples[i] =
        chord.reduce(
          (sum, midi) => sum + Math.sin(2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * t),
          0,
        ) *
        0.15 *
        env;
      if (i % SAMPLE_RATE === 0) ctx.progress(i / samples.length, `Rendering ${Math.floor(t)}s…`);
      if (ctx.signal.aborted) throw new Error("Canceled");
    }
    return { bytes: wav(samples), ext: ".wav" };
  },
};
