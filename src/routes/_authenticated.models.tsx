import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { AppSettings, EngineStatus, Job, LocalModel } from "@shared/types";
import { SiteHeader } from "@/components/SiteHeader";
import { invoke, onJobUpdate, waitForJob } from "@/lib/bridge";

export const Route = createFileRoute("/_authenticated/models")({
  component: ModelsPage,
});

const input =
  "w-full rounded-sm border border-border bg-background px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none";
const label = "mb-1 block font-mono text-[9px] uppercase tracking-widest text-muted-foreground";
const btn =
  "rounded-sm border border-border px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary disabled:opacity-40";

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={`h-full bg-primary transition-all ${value < 0 ? "w-full animate-pulse" : ""}`}
        style={value >= 0 ? { width: `${Math.round(value * 100)}%` } : undefined}
      />
    </div>
  );
}

function EnginePanel({ status, onChange }: { status: EngineStatus | null; onChange: () => void }) {
  const [installJob, setInstallJob] = useState<Job | null>(null);
  const [torch, setTorch] = useState<"auto" | "cuda" | "cpu">("auto");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    invoke<AppSettings>("settings:get").then(setSettings);
    invoke<Job[]>("jobs:list", { kind: "engine-install" }).then((jobs) => {
      const running = jobs.find((j) => j.status === "running");
      if (running) setInstallJob(running);
    });
    return onJobUpdate((job) => {
      if (job.kind === "engine-install") {
        setInstallJob(job);
        if (job.status !== "running") onChange();
      }
    });
  }, [onChange]);

  const install = async () => {
    const job = await invoke<Job>("engine:install", { torch });
    setInstallJob(job);
    setShowLog(true);
  };

  const installing = installJob?.status === "running";

  return (
    <section className="mb-10 rounded-sm border-2 border-border bg-card p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            local engine
          </p>
          <h2 className="mt-1 font-display text-3xl font-black">
            {!status
              ? "…"
              : status.running
                ? "Running"
                : status.starting
                  ? "Starting…"
                  : status.installed
                    ? "Installed · idle"
                    : "Not installed"}
          </h2>
          {status?.running && (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-primary">
              {status.gpu ?? "CPU"} · {status.device} · torch {status.torch}
            </p>
          )}
          {status?.error && (
            <p className="mt-2 max-w-xl font-mono text-[11px] text-destructive">{status.error}</p>
          )}
          <p className="mt-3 max-w-xl font-mono text-[11px] leading-relaxed text-muted-foreground">
            A private Python environment that runs open-source models on your GPU (NVIDIA CUDA,
            Apple MPS) or CPU. First install downloads PyTorch (~3 GB) — needs{" "}
            <button
              className="text-primary underline"
              onClick={() =>
                invoke("app:openExternal", {
                  url: "https://docs.astral.sh/uv/getting-started/installation/",
                })
              }
            >
              uv
            </button>{" "}
            or Python 3.10–3.12.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!status?.installed || installing ? (
            <>
              <select
                value={torch}
                onChange={(e) => setTorch(e.target.value as typeof torch)}
                className={`${input} w-auto`}
              >
                <option value="auto">auto-detect GPU</option>
                <option value="cuda">NVIDIA CUDA</option>
                <option value="cpu">CPU only</option>
              </select>
              <button
                onClick={install}
                disabled={installing}
                className="rounded-sm bg-primary px-5 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
              >
                {installing ? "installing…" : "install engine"}
              </button>
            </>
          ) : status.starting ? (
            <button disabled className={btn}>
              starting…
            </button>
          ) : status.running ? (
            <>
              <button
                className={btn}
                onClick={() =>
                  invoke("models:unload").then(() => toast("Model unloaded from memory"))
                }
              >
                free vram
              </button>
              <button
                className={btn}
                onClick={() =>
                  invoke("engine:restart")
                    .then(onChange)
                    .catch((e) => toast.error(e.message))
                }
              >
                restart
              </button>
              <button className={btn} onClick={() => invoke("engine:stop").then(onChange)}>
                stop
              </button>
            </>
          ) : (
            <button
              className="rounded-sm bg-primary px-5 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary-foreground"
              onClick={() =>
                invoke("engine:start")
                  .then(onChange)
                  .catch((e) => {
                    toast.error(e.message);
                    onChange();
                  })
              }
            >
              start engine
            </button>
          )}
          {status?.installed && !installing && (
            <button className={btn} onClick={install} title="Reinstall dependencies">
              repair
            </button>
          )}
          <button
            className={btn}
            onClick={async () => {
              setLog(await invoke<string[]>("engine:log"));
              setShowLog((v) => !v);
            }}
          >
            logs
          </button>
        </div>
      </div>

      {installJob && installing && (
        <div className="mt-6 space-y-2">
          <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="truncate pr-4">{installJob.message}</span>
            {installJob.progress >= 0 && <span>{Math.round(installJob.progress * 100)}%</span>}
          </div>
          <ProgressBar value={installJob.progress} />
        </div>
      )}
      {installJob?.status === "failed" && (
        <p className="mt-4 font-mono text-xs text-destructive">
          Install failed: {installJob.error}
        </p>
      )}
      {showLog && (
        <pre className="mt-6 max-h-64 overflow-auto rounded-sm border border-border bg-background p-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {(installing || installJob?.status === "failed" ? installJob?.log : log)?.join("\n") ||
            "no output yet"}
        </pre>
      )}

      {settings && (
        <div className="mt-8 grid gap-4 border-t border-border pt-6 md:grid-cols-[1fr_180px_auto]">
          <div>
            <label className={label}>
              Hugging Face token (for gated models like Stable Audio Open)
            </label>
            <input
              type="password"
              className={input}
              value={settings.huggingFaceToken}
              onChange={(e) => setSettings({ ...settings, huggingFaceToken: e.target.value })}
              placeholder="hf_…"
            />
          </div>
          <div>
            <label className={label}>Device</label>
            <select
              className={input}
              value={settings.engineDevice}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  engineDevice: e.target.value as AppSettings["engineDevice"],
                })
              }
            >
              <option value="auto">auto</option>
              <option value="cuda">cuda</option>
              <option value="mps">mps (Apple)</option>
              <option value="cpu">cpu</option>
            </select>
          </div>
          <button
            className={`${btn} self-end`}
            onClick={async () => {
              await invoke("settings:set", {
                huggingFaceToken: settings.huggingFaceToken,
                engineDevice: settings.engineDevice,
              });
              if (status?.running) await invoke("engine:restart").catch(() => {});
              toast.success("Engine settings saved");
              onChange();
            }}
          >
            save
          </button>
        </div>
      )}
    </section>
  );
}

function ModelCard({
  model,
  job,
  onChanged,
}: {
  model: LocalModel;
  job?: Job;
  onChanged: () => void;
}) {
  const busy = job?.status === "running" || model.installing;
  return (
    <div
      className={`flex flex-col rounded-sm border p-5 ${model.installed ? "border-primary/40 bg-primary/[0.03]" : "border-border bg-card"}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="font-display text-xl font-bold leading-tight">{model.name}</p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-widest ${model.task === "stems" ? "border-ember/50 text-ember" : model.supportsLyrics ? "border-primary/50 text-primary" : "border-border text-muted-foreground"}`}
        >
          {model.task === "stems"
            ? "stems"
            : model.supportsLyrics
              ? "vocals + lyrics"
              : "instrumental"}
        </span>
      </div>
      <p className="flex-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {model.description}
      </p>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        <span>{model.sizeGB ? `${model.sizeGB} GB` : "size varies"}</span>
        <span>~{model.vramGB} GB vram</span>
        {model.maxDurationSec > 0 && <span>≤ {model.maxDurationSec}s</span>}
        <span>{model.license}</span>
        {model.gated && <span className="text-ember">gated · needs HF token</span>}
      </div>
      <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/60">{model.repo}</p>

      {busy && job && (
        <div className="mt-4 space-y-1">
          <p className="truncate font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {job.message || "downloading…"}
          </p>
          <ProgressBar value={job.progress} />
        </div>
      )}
      {job?.status === "failed" && (
        <p className="mt-3 font-mono text-[10px] text-destructive">{job.error}</p>
      )}

      <div className="mt-4 flex gap-2">
        {model.installed ? (
          <>
            <span className="flex-1 rounded-sm bg-primary/10 px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-primary">
              ✓ installed
            </span>
            <button
              className={btn}
              onClick={async () => {
                if (!confirm(`Delete ${model.name} from disk?`)) return;
                await invoke("models:delete", { id: model.id });
                onChanged();
              }}
            >
              delete
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={async () => {
              try {
                const j = await invoke<Job>("models:download", { id: model.id });
                await waitForJob(j.id);
                toast.success(`${model.name} is ready`);
              } catch (e) {
                toast.error((e as Error).message);
              }
              onChanged();
            }}
            className="flex-1 rounded-sm bg-primary px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
          >
            {busy ? "downloading…" : "↓ download"}
          </button>
        )}
      </div>
    </div>
  );
}

function AddCustomModel({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    repo: "",
    backend: "musicgen",
    description: "",
  });
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-[200px] items-center justify-center rounded-sm border-2 border-dashed border-border font-mono text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
      >
        + add from hugging face
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-sm border border-primary/40 bg-card p-5">
      <p className="font-display text-lg font-bold">Add a model</p>
      <p className="font-mono text-[10px] text-muted-foreground">
        Any Hugging Face repo compatible with one of the engine's backends (e.g. a fine-tuned
        MusicGen).
      </p>
      <div>
        <label className={label}>Hugging Face repo</label>
        <input
          className={input}
          placeholder="facebook/musicgen-melody"
          value={form.repo}
          onChange={(e) => {
            const repo = e.target.value;
            const slug =
              repo
                .split("/")
                .pop()
                ?.toLowerCase()
                .replace(/[^a-z0-9._-]/g, "-") ?? "";
            setForm((f) => ({ ...f, repo, id: f.id || slug, name: f.name || slug }));
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Name</label>
          <input
            className={input}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>Backend</label>
          <select
            className={input}
            value={form.backend}
            onChange={(e) => setForm({ ...form, backend: e.target.value })}
          >
            <option value="musicgen">MusicGen (transformers)</option>
            <option value="acestep">ACE-Step (diffusers)</option>
            <option value="stable-audio">Stable Audio (diffusers)</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 rounded-sm bg-primary px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
          disabled={!form.repo.includes("/") || !form.id}
          onClick={async () => {
            try {
              await invoke("models:addCustom", {
                ...form,
                id: form.id.replace(/[^a-z0-9._-]/gi, "-"),
              });
              setOpen(false);
              setForm({ id: "", name: "", repo: "", backend: "musicgen", description: "" });
              onAdded();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          add
        </button>
        <button className={btn} onClick={() => setOpen(false)}>
          cancel
        </button>
      </div>
    </div>
  );
}

function ModelsPage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  const refresh = useCallback(async () => {
    const s = await invoke<EngineStatus>("engine:status");
    setStatus(s);
    if (!s.installed) return;
    setLoadingModels(true);
    // Poll status while Python boots so the panel does not look stuck.
    const poll = setInterval(
      () =>
        invoke<EngineStatus>("engine:status")
          .then(setStatus)
          .catch(() => {}),
      1000,
    );
    try {
      setModels(await invoke<LocalModel[]>("models:list"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearInterval(poll);
      setLoadingModels(false);
      setStatus(await invoke<EngineStatus>("engine:status"));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onJobUpdate((job) => {
      if (job.kind.startsWith("model-download:")) {
        setJobs((prev) => ({ ...prev, [job.kind.slice("model-download:".length)]: job }));
      }
    });
  }, [refresh]);

  const music = models.filter((m) => m.task === "music");
  const stems = models.filter((m) => m.task === "stems");

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] px-6 py-16">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
          ◐ open-source models
        </p>
        <h1 className="mb-4 font-display text-6xl font-black md:text-7xl">
          Run it <span className="italic text-primary">locally</span>.
        </h1>
        <p className="mb-12 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
          Download open-source music models once and generate offline, privately, as much as you
          like. Models are saved to your models folder (change it in Settings).
        </p>

        <EnginePanel status={status} onChange={refresh} />

        {error && (
          <div className="mb-8 rounded-sm border border-destructive/50 bg-destructive/10 p-4 font-mono text-xs text-destructive">
            {error}
          </div>
        )}

        {status?.installed && loadingModels && models.length === 0 && (
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            starting the engine and loading the model catalog…
          </p>
        )}

        {status?.installed && models.length > 0 && (
          <>
            <h2 className="mb-6 font-display text-3xl font-black">Music generation</h2>
            <div className="mb-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {music.map((m) => (
                <ModelCard key={m.id} model={m} job={jobs[m.id]} onChanged={refresh} />
              ))}
              <AddCustomModel onAdded={refresh} />
            </div>

            <h2 className="mb-6 font-display text-3xl font-black">Stem separation</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {stems.map((m) => (
                <ModelCard key={m.id} model={m} job={jobs[m.id]} onChanged={refresh} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
