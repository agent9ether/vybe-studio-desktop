import type { ImageEndpoint } from "@shared/types";
import { getSettings, IMAGE_PRESETS, providerConfig } from "./settings";
import { createPrediction, firstOutputUrl, waitForPrediction } from "./replicate";
import { saveFromUrl } from "./media";

// Image generation for cover art and AI-artist portfolios. The active preset
// (Settings → Image generation) decides which request format is used.

function activeEndpoint(): { id: string; endpoint: ImageEndpoint } | null {
  const { images } = getSettings();
  const preset = IMAGE_PRESETS[images.provider];
  if (!preset) return null;
  const stored = images.configs?.[images.provider];
  return {
    id: images.provider,
    endpoint: {
      baseUrl: (stored?.baseUrl || preset.baseUrl).replace(/\/+$/, ""),
      model: stored?.model || preset.model,
      apiKey:
        stored?.apiKey ||
        (preset.kind === "replicate" ? providerConfig("replicate").config.apiKey || "" : ""),
    },
  };
}

export function imagesEnabled() {
  const active = activeEndpoint();
  if (!active) return false;
  // Custom OpenAI-compatible servers may not need a key; everything else does.
  return active.id === "custom" ? !!active.endpoint.baseUrl : !!active.endpoint.apiKey;
}

async function fail(res: Response, label: string): Promise<never> {
  throw new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function nvidia(e: ImageEndpoint, prompt: string, subdir: string) {
  const headers = {
    Authorization: `Bearer ${e.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const url = `${e.baseUrl}/${e.model}`;
  // FLUX endpoints take width/height; Stable Diffusion endpoints take
  // aspect_ratio. Try the FLUX shape first and fall back on a 4xx.
  let res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      seed: 0,
      steps: e.model.includes("schnell") ? 4 : 30,
    }),
  });
  if (res.status === 422 || res.status === 400) {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, aspect_ratio: "1:1", cfg_scale: 5, mode: "text-to-image" }),
    });
  }
  if (!res.ok) await fail(res, "NVIDIA NIM");
  const json = (await res.json()) as { artifacts?: { base64?: string }[]; image?: string };
  const b64 = json.artifacts?.[0]?.base64 ?? json.image;
  if (!b64) throw new Error("NVIDIA NIM returned no image");
  const mime = b64.startsWith("/9j/") ? "image/jpeg" : "image/png";
  return (await saveFromUrl(`data:${mime};base64,${b64}`, "image.png", subdir)).url;
}

async function openaiCompatible(e: ImageEndpoint, prompt: string, subdir: string) {
  if (!e.baseUrl) throw new Error("Set a base URL for the image endpoint in Settings.");
  const res = await fetch(`${e.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(e.apiKey ? { Authorization: `Bearer ${e.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: e.model || undefined, prompt, n: 1, size: "1024x1024" }),
  });
  if (!res.ok) await fail(res, "Image API");
  const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = json.data?.[0];
  if (item?.b64_json) {
    return (await saveFromUrl(`data:image/png;base64,${item.b64_json}`, "image.png", subdir)).url;
  }
  if (item?.url) return (await saveFromUrl(item.url, "image.png", subdir)).url;
  throw new Error("Image API returned no image");
}

async function replicate(e: ImageEndpoint, prompt: string, subdir: string) {
  if (!e.apiKey) throw new Error("Add a Replicate token in Settings → Image generation.");
  const isFlux = e.model.includes("flux");
  const pred = await createPrediction(e.apiKey, e.model, {
    prompt,
    aspect_ratio: "1:1",
    ...(isFlux ? { go_fast: true, megapixels: "1", num_outputs: 1, output_format: "webp" } : {}),
  });
  const done = await waitForPrediction(e.apiKey, pred, {
    intervalMs: 1500,
    timeoutMs: 3 * 60 * 1000,
  });
  const url = firstOutputUrl(done.output);
  if (!url) throw new Error("Replicate returned no image");
  return (await saveFromUrl(url, "image.webp", subdir)).url;
}

async function stability(e: ImageEndpoint, prompt: string, subdir: string) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("aspect_ratio", "1:1");
  form.append("output_format", "png");
  const res = await fetch(`${e.baseUrl}/v2beta/stable-image/generate/${e.model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.apiKey}`, Accept: "application/json" },
    body: form,
  });
  if (!res.ok) await fail(res, "Stability AI");
  const json = (await res.json()) as { image?: string };
  if (!json.image) throw new Error("Stability AI returned no image");
  return (await saveFromUrl(`data:image/png;base64,${json.image}`, "image.png", subdir)).url;
}

export async function generateImage(prompt: string, subdir = "images"): Promise<string> {
  const active = activeEndpoint();
  if (!active) {
    throw new Error("Image generation is off. Choose a provider in Settings → Image generation.");
  }
  const { kind } = IMAGE_PRESETS[active.id];
  if (kind !== "replicate" && active.id !== "custom" && !active.endpoint.apiKey) {
    throw new Error(
      `Add your ${IMAGE_PRESETS[active.id].label} API key in Settings → Image generation.`,
    );
  }
  switch (kind) {
    case "nvidia":
      return nvidia(active.endpoint, prompt, subdir);
    case "replicate":
      return replicate(active.endpoint, prompt, subdir);
    case "stability":
      return stability(active.endpoint, prompt, subdir);
    default:
      return openaiCompatible(active.endpoint, prompt, subdir);
  }
}

export async function generateCoverArt(data: { prompt: string; style?: string }) {
  if (!imagesEnabled()) return { imageUrl: undefined };
  const fullPrompt = `High quality album cover art. Style: ${data.style || "Artistic"}. Theme: ${data.prompt}. No text, no distorted faces, professional digital art.`;
  try {
    return { imageUrl: await generateImage(fullPrompt, "covers") };
  } catch (e) {
    // A failed cover should never block making the song.
    console.warn("[images] cover art failed:", e);
    return { imageUrl: undefined };
  }
}
