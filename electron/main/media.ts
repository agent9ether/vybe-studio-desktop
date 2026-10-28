import { protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { getSettings } from "./settings";

// Everything the app generates or imports lives under <libraryDir>/media and
// is served to the renderer as vybe-media://local/<relative path>.

export const MEDIA_SCHEME = "vybe-media";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".zip": "application/zip",
  ".pth": "application/octet-stream",
};

export function mediaDir() {
  const dir = path.join(getSettings().libraryDir, "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true,
      },
    },
  ]);
}

export function mediaUrlFor(absPath: string) {
  const rel = path.relative(mediaDir(), absPath).split(path.sep).map(encodeURIComponent).join("/");
  return `${MEDIA_SCHEME}://local/${rel}`;
}

export function isMediaUrl(url: string | undefined | null): boolean {
  return !!url && url.startsWith(`${MEDIA_SCHEME}://`);
}

export function pathForMediaUrl(url: string): string {
  const u = new URL(url);
  const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  const abs = path.resolve(mediaDir(), rel);
  if (!abs.startsWith(path.resolve(mediaDir()))) throw new Error("Invalid media path");
  return abs;
}

export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let file: string;
    try {
      file = pathForMediaUrl(request.url);
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    };

    // Range support so <audio> can seek.
    const range = request.headers.get("range");
    const m = range?.match(/bytes=(\d*)-(\d*)/);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(stat.size - 1, end);
      if (start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      const stream = fs.createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
    const stream = fs.createReadStream(file);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: { ...headers, "Content-Length": String(stat.size) },
    });
  });
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

/** Write bytes into the media folder (optionally under a sub-folder) and return its URL. */
export function saveBytes(bytes: Uint8Array | Buffer, fileName: string, subdir = "files") {
  const dir = path.join(mediaDir(), safeName(subdir));
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(fileName) || ".bin";
  const base = safeName(path.basename(fileName, ext));
  const abs = path.join(dir, `${base}-${randomUUID().slice(0, 8)}${ext.toLowerCase()}`);
  fs.writeFileSync(abs, bytes);
  return { path: abs, url: mediaUrlFor(abs) };
}

/** Write to an exact relative path inside the media folder (used by the storage shim). */
export function saveBytesAt(relPath: string, bytes: Uint8Array | Buffer) {
  const abs = path.resolve(mediaDir(), relPath);
  if (!abs.startsWith(path.resolve(mediaDir()))) throw new Error("Invalid media path");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return { path: abs, url: mediaUrlFor(abs) };
}

export function urlForRelPath(relPath: string) {
  return mediaUrlFor(path.resolve(mediaDir(), relPath));
}

export function removeMedia(url: string) {
  if (!isMediaUrl(url)) return;
  try {
    fs.rmSync(pathForMediaUrl(url), { force: true });
  } catch {
    // already gone
  }
}

const EXT_FROM_TYPE: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/** Download a remote file (provider output URLs usually expire) into the library. */
export async function saveFromUrl(
  url: string,
  nameHint: string,
  subdir = "files",
  headers?: Record<string, string>,
) {
  if (isMediaUrl(url)) return { path: pathForMediaUrl(url), url };
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error("Invalid data URL");
    const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    const ext = EXT_FROM_TYPE[m[1] ?? ""] ?? path.extname(nameHint) ?? ".bin";
    return saveBytes(bytes, path.basename(nameHint, path.extname(nameHint)) + ext, subdir);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const urlExt = path.extname(new URL(url).pathname);
  const ext = EXT_FROM_TYPE[type] ?? (urlExt || path.extname(nameHint) || ".bin");
  const bytes = Buffer.from(await res.arrayBuffer());
  return saveBytes(bytes, path.basename(nameHint, path.extname(nameHint)) + ext, subdir);
}

/** Read a media file (local or remote) into memory, e.g. to upload it to a provider. */
export async function readMedia(
  url: string,
): Promise<{ bytes: Buffer; name: string; type: string }> {
  if (isMediaUrl(url)) {
    const p = pathForMediaUrl(url);
    return {
      bytes: fs.readFileSync(p),
      name: path.basename(p),
      type: MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream",
    };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    name: path.basename(new URL(url).pathname) || "file",
    type,
  };
}
