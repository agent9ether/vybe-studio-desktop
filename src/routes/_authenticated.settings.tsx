import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type {
  AppSettings,
  ConfigField,
  ImageEndpoint,
  ImagePreset,
  ProviderInfo,
} from "@shared/types";
import { SiteHeader } from "@/components/SiteHeader";
import { invoke } from "@/lib/bridge";
import { importFile } from "@/lib/local-db";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

type Preset = { label: string; baseUrl: string; model: string; needsKey: boolean };
type AppInfo = { version: string; userData: string; pluginsDir: string; platform: string };

const input =
  "w-full rounded-sm border border-border bg-background px-4 py-3 font-mono text-sm focus:border-primary focus:outline-none";
const label = "mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground";
const smallBtn =
  "rounded-sm border border-border px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary disabled:opacity-40";

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-8 scroll-mt-32 rounded-sm border border-border bg-card p-8">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      {subtitle && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{subtitle}</p>}
      <div className="mt-6 space-y-6">{children}</div>
    </section>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === "select") {
    return (
      <select
        value={value || field.default || ""}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      >
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        value={value}
        rows={3}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${input} resize-y`}
      />
    );
  }
  return (
    <input
      type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
      value={value}
      placeholder={field.placeholder ?? field.default}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      spellCheck={false}
      className={input}
    />
  );
}

function ProviderCard({
  info,
  stored,
  onSave,
}: {
  info: ProviderInfo;
  stored: { enabled: boolean; config: Record<string, string> } | undefined;
  onSave: (id: string, v: { enabled: boolean; config: Record<string, string> }) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(info.enabled);
  const [config, setConfig] = useState<Record<string, string>>(stored?.config ?? {});
  const [saving, setSaving] = useState(false);
  const dirty =
    enabled !== info.enabled || JSON.stringify(config) !== JSON.stringify(stored?.config ?? {});

  return (
    <div
      className={`rounded-sm border p-5 ${enabled ? "border-primary/40 bg-primary/[0.03]" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold">
            {info.name}
            {info.kind === "plugin" && (
              <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-mono text-[8px] uppercase tracking-widest text-muted-foreground">
                plugin
              </span>
            )}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{info.description}</p>
          {info.docsUrl && (
            <button
              type="button"
              onClick={() => invoke("app:openExternal", { url: info.docsUrl })}
              className="mt-1 font-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
            >
              api docs ↗
            </button>
          )}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {enabled ? (info.configured ? "on · ready" : "on") : "off"}
        </label>
      </div>

      {info.fields.length > 0 && (
        <div className="mt-5 grid gap-4">
          {info.fields.map((f) => (
            <div key={f.key}>
              <label className={label}>{f.label}</label>
              <FieldInput
                field={f}
                value={config[f.key] ?? ""}
                onChange={(v) => {
                  setConfig((c) => ({ ...c, [f.key]: v }));
                  // Pasting a key is a clear signal the provider should be on.
                  if (f.type === "secret" && v.trim()) setEnabled(true);
                }}
              />
              {f.help && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{f.help}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {dirty && (
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(info.id, { enabled, config });
            setSaving(false);
          }}
          className="mt-5 rounded-sm bg-primary px-5 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
        >
          {saving ? "saving…" : "save"}
        </button>
      )}
    </div>
  );
}

function ImageSection({
  settings,
  onSave,
}: {
  settings: AppSettings;
  onSave: (patch: Partial<AppSettings>, message?: string) => Promise<AppSettings | undefined>;
}) {
  const [presets, setPresets] = useState<Record<string, ImagePreset>>({});
  const [provider, setProvider] = useState(settings.images.provider);
  const [configs, setConfigs] = useState<Record<string, ImageEndpoint>>(
    settings.images.configs ?? {},
  );
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    invoke<Record<string, ImagePreset>>("settings:imagePresets").then(setPresets);
  }, []);

  const preset = presets[provider];
  const current: ImageEndpoint = {
    baseUrl: configs[provider]?.baseUrl ?? "",
    apiKey: configs[provider]?.apiKey ?? "",
    model: configs[provider]?.model ?? "",
  };
  const setField = (key: keyof ImageEndpoint, value: string) =>
    setConfigs((c) => ({ ...c, [provider]: { ...current, [key]: value } }));
  const persist = (message: string) => onSave({ images: { provider, configs } }, message);

  return (
    <Section
      id="image-apis"
      title="Image generation APIs"
      subtitle="Cover art and AI-artist portfolios. Optional — without a provider, songs get gradient covers."
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          ["none", "Off (gradient covers)"] as const,
          ...Object.entries(presets).map(([id, p]) => [id, p.label] as const),
        ].map(([id, name]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setProvider(id);
              setPreview(null);
            }}
            className={`rounded-sm border px-3 py-3 text-left font-mono text-[10px] uppercase tracking-widest ${
              provider === id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {name}
            {configs[id]?.apiKey ? <span className="ml-1 text-primary">●</span> : null}
          </button>
        ))}
      </div>

      {preset && (
        <div className="grid gap-4 rounded-sm border border-border p-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={label}>
              API key
              {preset.kind === "replicate" ? " (optional — reuses your Replicate music token)" : ""}
            </label>
            <input
              type="password"
              value={current.apiKey}
              placeholder={preset.keyPlaceholder}
              onChange={(e) => setField("apiKey", e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Model</label>
            <input
              list={`image-models-${provider}`}
              value={current.model}
              placeholder={preset.model || "model name"}
              onChange={(e) => setField("model", e.target.value)}
              className={input}
            />
            <datalist id={`image-models-${provider}`}>
              {preset.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={label}>Base URL</label>
            <input
              value={current.baseUrl}
              placeholder={preset.baseUrl || "https://your-server/v1"}
              onChange={(e) => setField("baseUrl", e.target.value)}
              className={input}
            />
          </div>
          {(preset.help || preset.docsUrl) && (
            <p className="font-mono text-[10px] text-muted-foreground md:col-span-2">
              {preset.help}{" "}
              {preset.docsUrl && (
                <button
                  type="button"
                  onClick={() => invoke("app:openExternal", { url: preset.docsUrl })}
                  className="uppercase tracking-widest text-primary hover:underline"
                >
                  docs ↗
                </button>
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => persist("Image settings saved")}
          className="rounded-sm bg-primary px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground"
        >
          save
        </button>
        {preset && (
          <button
            className={smallBtn}
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setPreview(null);
              try {
                await persist("Saved — generating a test image…");
                setPreview(
                  await invoke<string>("images:generate", {
                    prompt: "album cover art, neon city at night, synthwave, no text",
                  }),
                );
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "generating…" : "test"}
          </button>
        )}
        {preview && (
          <img src={preview} alt="Test result" className="h-20 w-20 rounded-sm object-cover" />
        )}
      </div>
    </Section>
  );
}

function Settings() {
  const { refreshProfile } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [s, p, pr, i] = await Promise.all([
      invoke<AppSettings>("settings:get"),
      invoke<ProviderInfo[]>("providers:list"),
      invoke<Record<string, Preset>>("settings:llmPresets"),
      invoke<AppInfo>("app:info"),
    ]);
    setSettings(s);
    setDraft(s);
    setProviders(p);
    setPresets(pr);
    setInfo(i);
  };

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, []);

  if (!settings || !draft) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="p-12 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
          loading settings…
        </div>
      </div>
    );
  }

  const save = async (patch: Partial<AppSettings>, message = "Saved") => {
    setSaving(true);
    try {
      const next = await invoke<AppSettings>("settings:set", patch);
      setSettings(next);
      setDraft(next);
      toast.success(message);
      return next;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveProvider = async (
    id: string,
    value: { enabled: boolean; config: Record<string, string> },
  ) => {
    await save({ providers: { [id]: value } }, "Engine saved");
    setProviders(await invoke<ProviderInfo[]>("providers:list"));
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const chooseDir = async (key: "libraryDir" | "modelsDir") => {
    const dir = await invoke<string | null>("settings:chooseDir", {
      title: key === "libraryDir" ? "Choose library folder" : "Choose models folder",
    });
    if (dir) await save({ [key]: dir } as Partial<AppSettings>, "Folder updated");
  };

  const llmPreset = presets[draft.llm.preset];
  const cloudProviders = providers.filter((p) => p.id !== "local");

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[860px] px-6 py-12">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
          ◐ settings
        </p>
        <h1 className="mb-6 font-display text-5xl font-black">Settings</h1>
        <nav className="sticky top-16 z-30 -mx-2 mb-8 flex flex-wrap gap-2 bg-background/90 px-2 py-3 backdrop-blur">
          {[
            ["profile", "Profile"],
            ["music-apis", "Music APIs"],
            ["image-apis", "Image APIs"],
            ["lyrics", "Lyrics model"],
            ["stems", "Stems"],
            ["storage", "Storage"],
          ].map(([id, name]) => (
            <button
              key={id}
              type="button"
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}
              className="rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
            >
              {name}
            </button>
          ))}
        </nav>

        <Section
          id="profile"
          title="Profile"
          subtitle="Shown on your artist pages. Stays on this computer."
        >
          <div className="flex items-center gap-6">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-border bg-background">
              {draft.profile.avatarUrl ? (
                <img
                  src={draft.profile.avatarUrl}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-display text-2xl text-muted-foreground">
                  {draft.profile.displayName?.charAt(0) || "V"}
                </div>
              )}
            </div>
            <label className={`${smallBtn} cursor-pointer`}>
              change avatar
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const url = await importFile(file, file.name, "avatars");
                  set("profile", { ...draft.profile, avatarUrl: url });
                }}
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={label}>Display name</label>
              <input
                value={draft.profile.displayName}
                onChange={(e) => set("profile", { ...draft.profile, displayName: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Username</label>
              <input
                value={draft.profile.username}
                onChange={(e) => set("profile", { ...draft.profile, username: e.target.value })}
                className={input}
              />
            </div>
          </div>
          <div>
            <label className={label}>Bio</label>
            <textarea
              value={draft.profile.bio}
              rows={3}
              onChange={(e) => set("profile", { ...draft.profile, bio: e.target.value })}
              className={`${input} resize-none`}
            />
          </div>
          <button
            disabled={saving}
            onClick={async () => {
              await save({ profile: draft.profile }, "Profile saved");
              await refreshProfile();
            }}
            className="rounded-sm bg-primary px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
          >
            save profile
          </button>
        </Section>

        <Section
          id="music-apis"
          title="Music generation APIs"
          subtitle={
            <>
              Plug in any music-generation API. Open-source models are managed on the{" "}
              <Link to="/models" className="text-primary underline">
                Models
              </Link>{" "}
              page. Keys are encrypted with your OS keychain and never leave this machine except to
              call that provider.
            </>
          }
        >
          {cloudProviders.map((p) => (
            <ProviderCard
              key={p.id}
              info={p}
              stored={settings.providers[p.id]}
              onSave={saveProvider}
            />
          ))}
          <div className="rounded-sm border border-dashed border-border p-5">
            <p className="font-display text-lg font-bold">Provider plugins</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Drop a <code>.js</code> provider into the plugins folder to add any other API. See
              docs/PROVIDERS.md. Plugins run with full access to your computer — only install ones
              you trust.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                className={smallBtn}
                onClick={() => info && invoke("app:openPath", { path: info.pluginsDir })}
              >
                open plugins folder
              </button>
              <button
                className={smallBtn}
                onClick={async () => {
                  const ids = await invoke<string[]>("providers:reloadPlugins");
                  setProviders(await invoke<ProviderInfo[]>("providers:list"));
                  toast.success(ids.length ? `Loaded: ${ids.join(", ")}` : "No plugins found");
                }}
              >
                reload plugins
              </button>
            </div>
          </div>
        </Section>

        <Section
          id="lyrics"
          title="Lyrics model"
          subtitle="Writes titles, styles and lyrics. Any OpenAI-compatible chat API works — including fully local Ollama or LM Studio."
        >
          <div>
            <label className={label}>Provider</label>
            <select
              value={draft.llm.preset}
              onChange={(e) => {
                const p = presets[e.target.value];
                set("llm", {
                  ...draft.llm,
                  preset: e.target.value,
                  baseUrl: p?.baseUrl || draft.llm.baseUrl,
                  model: p?.model || draft.llm.model,
                });
              }}
              className={input}
            >
              {Object.entries(presets).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {draft.llm.preset !== "none" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={label}>Base URL</label>
                <input
                  value={draft.llm.baseUrl}
                  onChange={(e) => set("llm", { ...draft.llm, baseUrl: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Model</label>
                <input
                  value={draft.llm.model}
                  onChange={(e) => set("llm", { ...draft.llm, model: e.target.value })}
                  className={input}
                />
              </div>
              {(llmPreset?.needsKey || draft.llm.preset === "custom") && (
                <div className="md:col-span-2">
                  <label className={label}>API key</label>
                  <input
                    type="password"
                    value={draft.llm.apiKey}
                    onChange={(e) => set("llm", { ...draft.llm, apiKey: e.target.value })}
                    className={input}
                  />
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <button
              disabled={saving}
              onClick={() => save({ llm: draft.llm }, "Lyrics model saved")}
              className="rounded-sm bg-primary px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
            >
              save
            </button>
            <button
              className={smallBtn}
              onClick={async () => {
                await save({ llm: draft.llm }, "Saved — testing…");
                try {
                  const r = await invoke<{ title: string; usedFallback?: boolean }>(
                    "lyrics:generate",
                    {
                      prompt: "a short test song about coffee",
                      compact: true,
                    },
                  );
                  if (r.usedFallback) toast("No model configured — templates will be used");
                  else toast.success(`Works! Got "${r.title}"`);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              test
            </button>
          </div>
        </Section>

        <ImageSection settings={settings} onSave={save} />

        <Section id="stems" title="Stem separation">
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                [
                  "local",
                  "Local Demucs",
                  "Free, private, runs on your GPU/CPU via the local engine.",
                ],
                ["replicate", "Replicate Demucs", "Runs in the cloud with your Replicate token."],
              ] as const
            ).map(([value, title, desc]) => (
              <button
                key={value}
                onClick={() => save({ stemsProvider: value }, "Stem provider saved")}
                className={`rounded-sm border p-4 text-left ${draft.stemsProvider === value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <p className="font-display text-lg font-bold">{title}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>
        </Section>

        <Section
          id="storage"
          title="Storage"
          subtitle="Everything you make is plain files on disk."
        >
          {(
            [
              ["libraryDir", "Library (songs, stems, artwork, database)"],
              ["modelsDir", "Downloaded models"],
            ] as const
          ).map(([key, title]) => (
            <div key={key}>
              <label className={label}>{title}</label>
              <div className="flex gap-3">
                <input
                  readOnly
                  value={settings[key]}
                  className={`${input} text-muted-foreground`}
                />
                <button className={smallBtn} onClick={() => chooseDir(key)}>
                  change
                </button>
                <button
                  className={smallBtn}
                  onClick={() => invoke("app:openPath", { path: settings[key] })}
                >
                  open
                </button>
              </div>
            </div>
          ))}
          <p className="font-mono text-[10px] text-muted-foreground">
            Changing a folder does not move existing files — copy them over yourself first. Restart
            the local engine after changing the models folder.
          </p>
        </Section>

        {info && (
          <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Vybe Studio desktop v{info.version} · open source ·{" "}
            <button
              className="underline hover:text-primary"
              onClick={() =>
                invoke("app:openExternal", {
                  url: "https://github.com/agent9ether/vybe-studio-desktop",
                })
              }
            >
              github
            </button>
          </p>
        )}
      </main>
    </div>
  );
}
