import { readMedia, isMediaUrl } from "./media";
import { sleep } from "./jobs";

// Minimal Replicate client shared by the music provider, stems, voice and image code.

const API = "https://api.replicate.com/v1";

export type Prediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: any;
  error?: string | null;
  logs?: string;
};

async function call(token: string, pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replicate ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Create a prediction. `model` may be "owner/name" (official or latest version is
 * resolved automatically) or "owner/name:version".
 */
export async function createPrediction(
  token: string,
  model: string,
  input: Record<string, unknown>,
): Promise<Prediction> {
  const [slug, version] = model.split(":");
  if (version) {
    return call(token, "/predictions", {
      method: "POST",
      body: JSON.stringify({ version, input }),
    });
  }
  try {
    return await call(token, `/models/${slug}/predictions`, {
      method: "POST",
      body: JSON.stringify({ input }),
    });
  } catch (e) {
    // Community models need an explicit version.
    const info = await call(token, `/models/${slug}`);
    const latest = info?.latest_version?.id;
    if (!latest) throw e;
    return call(token, "/predictions", {
      method: "POST",
      body: JSON.stringify({ version: latest, input }),
    });
  }
}

export function getPrediction(token: string, id: string): Promise<Prediction> {
  return call(token, `/predictions/${id}`);
}

export async function waitForPrediction(
  token: string,
  pred: Prediction,
  opts: {
    signal?: AbortSignal;
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (p: Prediction) => void;
  } = {},
): Promise<Prediction> {
  const started = Date.now();
  let current = pred;
  while (
    current.status !== "succeeded" &&
    current.status !== "failed" &&
    current.status !== "canceled"
  ) {
    if (opts.timeoutMs && Date.now() - started > opts.timeoutMs)
      throw new Error("Replicate prediction timed out");
    await sleep(opts.intervalMs ?? 2500, opts.signal);
    current = await getPrediction(token, current.id);
    opts.onTick?.(current);
  }
  if (current.status !== "succeeded")
    throw new Error(current.error || `Prediction ${current.status}`);
  return current;
}

/** Local files are not reachable from Replicate, so upload them first. */
export async function toReplicateUrl(token: string, url: string): Promise<string> {
  if (!isMediaUrl(url)) return url;
  const { bytes, name, type } = await readMedia(url);
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await fetch(`${API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok)
    throw new Error(`Replicate upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as any;
  const fileUrl = json?.urls?.get;
  if (!fileUrl) throw new Error("Replicate upload did not return a URL");
  return fileUrl;
}

export function firstOutputUrl(output: any): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return firstOutputUrl(output[0]);
  if (typeof output === "object")
    return output.audio || output.url || output.wav || output.mp3 || null;
  return null;
}
