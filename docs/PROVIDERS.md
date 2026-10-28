# Plugging in a music-generation API

Vybe Studio talks to music models through **providers**. There are three ways to add one,
from zero code to full control.

| Option | Code? | Use it when |
| --- | --- | --- |
| Built-in providers | none | You have a MiniMax, Replicate or ElevenLabs key |
| **Custom HTTP API** | none | You run your own server, or an API can return audio over HTTP |
| **Provider plugin** | a small JS file | The API needs its own request format, polling or auth |

All of them show up in the engine picker on the Studio and Song pages once enabled in
**Settings → Music engines**.

---

## 1. Built-in providers

| Provider | Models | Notes |
| --- | --- | --- |
| Local models | ACE-Step 1.5, MusicGen, Stable Audio Open | Download on the **Models** page; runs on your GPU/CPU |
| MiniMax | `music-2.6`, `music-1.5` | Full songs with vocals |
| Replicate | MiniMax music-1.5 / 2.6, MusicGen, plus any model slug you add | Also used for cloud stems, voice cloning and artwork |
| ElevenLabs Music | `music_v1` | Up to 5 minutes |
| Custom HTTP API | anything | See below |

API keys are stored encrypted with your OS keychain (Electron `safeStorage`) in
`settings.json` inside the app's data folder. They are only sent to the provider they belong to.

---

## 2. Custom HTTP API (no code)

Enable **Custom HTTP API** in Settings and point it at your endpoint. Vybe sends:

```http
POST <your url>
Content-Type: application/json
Authorization: Bearer <token>        # only if you set one

{
  "model": "default",                # one of the model names you configured
  "prompt": "dreamy synthwave, female vocals",
  "lyrics": "[Verse]\n…",
  "instrumental": false,
  "duration": 60,                    # seconds, may be omitted
  "seed": null
}
```

Your endpoint can answer in any of these shapes:

- the audio itself, with an `audio/*` content type (`audio/mpeg`, `audio/wav`, `audio/flac`);
- JSON with a URL: `{ "audio_url": "https://…/song.mp3" }`;
- JSON with base64 audio: `{ "audio_base64": "…", "format": "wav" }`.

The request may take as long as it needs (there is no client timeout), so a simple blocking
server is fine. A minimal FastAPI example:

```python
from fastapi import FastAPI
from fastapi.responses import FileResponse

app = FastAPI()

@app.post("/generate")
def generate(body: dict):
    path = my_model.render(body["prompt"], body.get("lyrics", ""), body.get("duration") or 30)
    return FileResponse(path, media_type="audio/wav")
```

---

## 3. Provider plugins (JavaScript)

Drop a `.js` or `.cjs` file into the plugins folder
(**Settings → Music engines → Open plugins folder**, or `<app data>/plugins`),
then click **Reload plugins**. Each file exports one provider:

```js
// my-provider.cjs
module.exports = {
  id: "my-provider",                       // unique, lowercase
  name: "My Provider",
  description: "What it does, shown in Settings.",
  docsUrl: "https://example.com/docs",     // optional

  // Settings form. Keys named apiKey / token / secret are stored encrypted.
  fields: [
    { key: "apiKey", label: "API key", type: "secret" },
    { key: "region", label: "Region", type: "select", default: "us",
      options: [{ value: "us", label: "US" }, { value: "eu", label: "EU" }] },
  ],

  isConfigured: (config) => !!config.apiKey,

  listModels: (config) => [
    { id: "v1", label: "My Model v1", supportsLyrics: true, maxDurationSec: 180, defaultDurationSec: 60 },
  ],

  // input:  { model, prompt, lyrics, instrumental, durationSec?, seed? }
  // ctx:    { config, signal, progress(p, message), log(line), outputDir }
  // return: { url } | { bytes: Uint8Array, ext: ".mp3" } | { filePath }
  async generate(input, ctx) {
    ctx.progress(-1, "Submitting…");          // -1 = indeterminate
    const res = await fetch(`https://${ctx.config.region}.example.com/v1/music`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: input.prompt, lyrics: input.lyrics, seconds: input.durationSec }),
      signal: ctx.signal,                     // lets the user cancel
    });
    if (!res.ok) throw new Error(`My Provider ${res.status}: ${await res.text()}`);
    const { audio_url } = await res.json();
    return { url: audio_url };                // Vybe downloads it into your library
  },
};
```

A complete, working example lives in [`examples/plugins/echo-provider.cjs`](../examples/plugins/echo-provider.cjs).

Thrown errors are shown to the user as-is, so make them readable.

> **Security:** plugins run inside the app's main process with full Node.js access.
> Only install plugins you have read or trust.

### Built-in provider code

Built-in providers live in [`electron/main/providers/`](../electron/main/providers). If you write a
provider that others would find useful, a pull request adding it there is very welcome. Follow
`minimax.ts` or `elevenlabs.ts` as templates and register it in `providers/index.ts`.

---

## Adding open-source models

The local engine (`engine/`, Python) supports these backends:

| Backend | Library | Examples |
| --- | --- | --- |
| `acestep` | diffusers `AceStepPipeline` | `ACE-Step/acestep-v15-xl-turbo-diffusers` |
| `musicgen` | transformers `MusicgenForConditionalGeneration` | `facebook/musicgen-*`, fine-tunes |
| `stable-audio` | diffusers `StableAudioPipeline` | `stabilityai/stable-audio-open-1.0` |
| `demucs` | demucs | stem separation |

Any compatible Hugging Face repo can be added from the **Models** page
(**+ Add from Hugging Face**). To support a new model family, add a module in
`engine/vybe_engine/backends/` exposing `load(path, device, entry)` that returns an object with
`generate(prompt, lyrics, duration, seed, out_path, job)`, register it in `backends/__init__.py`,
and add catalog entries in `catalog.py`.
