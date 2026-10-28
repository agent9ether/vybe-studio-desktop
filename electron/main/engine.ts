import { app } from "electron";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { EngineStatus } from "@shared/types";
import { getSettings } from "./settings";
import { startJob, sleep, type JobContext } from "./jobs";

// Manages the Python inference engine (engine/ folder): creating its private
// virtualenv, installing PyTorch + deps, starting/stopping the server and
// proxying requests to it.

let proc: ChildProcess | null = null;
let baseUrl: string | null = null;
let starting: Promise<string> | null = null;
let lastError: string | null = null;
let health: { device?: string; gpu?: string | null; torch?: string | null } = {};
const recentLog: string[] = [];

export function engineSourceDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "engine")
    : path.join(app.getAppPath(), "engine");
}

// The virtualenv lives next to the models so one folder on a big drive holds
// everything heavy (PyTorch alone is several GB).
function venvDir() {
  return path.join(getSettings().modelsDir, "_engine-venv");
}

export function enginePython(): string {
  if (process.env.VYBE_ENGINE_PYTHON) return process.env.VYBE_ENGINE_PYTHON;
  return process.platform === "win32"
    ? path.join(venvDir(), "Scripts", "python.exe")
    : path.join(venvDir(), "bin", "python");
}

export function isEngineInstalled() {
  if (process.env.VYBE_ENGINE_PYTHON) return true;
  return fs.existsSync(enginePython()) && fs.existsSync(path.join(venvDir(), ".vybe-ready"));
}

export function engineStatus(): EngineStatus {
  const s = getSettings();
  return {
    installed: isEngineInstalled(),
    running: !!baseUrl,
    starting: !!starting,
    url: baseUrl ?? undefined,
    device: health.device,
    gpu: health.gpu ?? null,
    torch: health.torch ?? null,
    error: lastError,
    pythonDir: process.env.VYBE_ENGINE_PYTHON ? path.dirname(enginePython()) : venvDir(),
    modelsDir: s.modelsDir,
  };
}

export function engineLog() {
  return recentLog.slice(-200);
}

function which(cmd: string): string | null {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null;
}

function hasNvidiaGpu() {
  return spawnSync("nvidia-smi", ["-L"], { encoding: "utf8" }).status === 0;
}

function run(ctx: JobContext, cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<void>((resolve, reject) => {
    ctx.log(`$ ${path.basename(cmd)} ${args.join(" ")}`);
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    ctx.signal.addEventListener("abort", () => child.kill());
    const onData = (d: Buffer) =>
      d
        .toString()
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .forEach((l) => ctx.log(l));
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`)),
    );
  });
}

export type InstallOptions = { torch: "auto" | "cuda" | "cpu" };

/** Create the virtualenv and install everything. Runs as a job so the UI can stream logs. */
export function installEngine(opts: InstallOptions) {
  return startJob("engine-install", async (ctx) => {
    await stopEngine();
    const venv = venvDir();
    const py = enginePython();
    const uv = which("uv");
    const src = engineSourceDir();

    let variant = opts.torch;
    if (variant === "auto")
      variant = process.platform !== "darwin" && hasNvidiaGpu() ? "cuda" : "cpu";
    const torchIndex =
      process.platform === "darwin"
        ? null
        : variant === "cuda"
          ? "https://download.pytorch.org/whl/cu128"
          : "https://download.pytorch.org/whl/cpu";

    fs.rmSync(path.join(venv, ".vybe-ready"), { force: true });
    ctx.progress(0.05, "Creating Python environment…");
    if (uv) {
      await run(ctx, uv, ["venv", venv, "--python", "3.12", "--allow-existing"]);
    } else {
      const sysPy = which("python3") ?? which("python") ?? which("py");
      if (!sysPy) {
        throw new Error(
          "Python 3.10–3.12 (or uv) is required. Install uv from https://docs.astral.sh/uv/ or Python from python.org, then retry.",
        );
      }
      await run(ctx, sysPy, ["-m", "venv", venv]);
      await run(ctx, py, ["-m", "pip", "install", "--upgrade", "pip"]);
    }
    const pip = (args: string[]) =>
      uv
        ? run(ctx, uv, ["pip", "install", "--python", py, ...args])
        : run(ctx, py, ["-m", "pip", "install", ...args]);

    ctx.progress(
      0.15,
      `Installing PyTorch (${process.platform === "darwin" ? "MPS" : variant}) — this is a large download…`,
    );
    await pip(["torch", "torchaudio", ...(torchIndex ? ["--index-url", torchIndex] : [])]);
    ctx.progress(0.7, "Installing engine dependencies…");
    await pip(["-r", path.join(src, "requirements.txt")]);
    fs.writeFileSync(path.join(venv, ".vybe-ready"), JSON.stringify({ variant, at: Date.now() }));
    ctx.progress(0.95, "Starting engine…");
    await startEngine();
    return engineStatus();
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function startEngine(): Promise<string> {
  if (baseUrl) return baseUrl;
  if (starting) return starting;
  if (!isEngineInstalled())
    throw new Error("The local engine is not installed yet. Open Models → Install engine.");
  starting = (async () => {
    lastError = null;
    const s = getSettings();
    const port = await freePort();
    fs.mkdirSync(s.modelsDir, { recursive: true });
    const child = spawn(
      enginePython(),
      [
        "-m",
        "vybe_engine",
        "--port",
        String(port),
        "--models-dir",
        s.modelsDir,
        "--device",
        s.engineDevice,
      ],
      {
        cwd: engineSourceDir(),
        env: {
          ...process.env,
          PYTHONPATH: engineSourceDir(),
          PYTHONUNBUFFERED: "1",
          ...(s.huggingFaceToken ? { HF_TOKEN: s.huggingFaceToken } : {}),
        },
        windowsHide: true,
      },
    );
    proc = child;
    const capture = (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/).filter(Boolean)) {
        recentLog.push(line);
        if (recentLog.length > 500) recentLog.shift();
      }
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("exit", (code) => {
      if (proc === child) {
        proc = null;
        baseUrl = null;
        if (code && code !== 0)
          lastError = `Engine exited with code ${code}. ${recentLog.slice(-3).join(" ")}`;
      }
    });

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (!proc) throw new Error(lastError ?? "Engine failed to start");
      try {
        const res = await fetch(`${url}/health`);
        if (res.ok) {
          health = (await res.json()) as typeof health;
          baseUrl = url;
          return url;
        }
      } catch {
        // not up yet
      }
      await sleep(500);
    }
    child.kill();
    throw new Error("Engine did not start within 2 minutes");
  })();
  try {
    return await starting;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    starting = null;
  }
}

export async function stopEngine() {
  const child = proc;
  proc = null;
  baseUrl = null;
  if (!child) return;
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
}

export async function restartEngine() {
  await stopEngine();
  return startEngine();
}

/** Call the engine HTTP API, starting the engine on demand. */
export async function engineFetch<T = any>(pathname: string, init: RequestInit = {}): Promise<T> {
  const url = await startEngine();
  const res = await fetch(`${url}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail).detail ?? detail;
    } catch {
      // plain text
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

/** Poll an engine job until it settles, mirroring progress into an app job. */
export async function waitEngineJob<T = any>(
  jobId: string,
  ctx: Pick<JobContext, "signal" | "progress">,
): Promise<T> {
  for (;;) {
    if (ctx.signal.aborted) {
      await engineFetch(`/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => {});
      throw new Error("Canceled");
    }
    const j = await engineFetch<{
      status: string;
      progress: number;
      message: string;
      result: T;
      error: string | null;
    }>(`/jobs/${jobId}`);
    if (j.status === "succeeded") return j.result;
    if (j.status === "failed" || j.status === "canceled")
      throw new Error(j.error ?? `Engine job ${j.status}`);
    ctx.progress(j.progress, j.message || undefined);
    await sleep(1000);
  }
}
