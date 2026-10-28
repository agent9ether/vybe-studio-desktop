import { Link } from "@tanstack/react-router";
import type { MusicEngine } from "@shared/types";

type Props = {
  engines: MusicEngine[];
  value: string | null;
  onChange: (id: string) => void;
  duration?: number;
  onDurationChange?: (sec: number) => void;
  disabled?: boolean;
  loading?: boolean;
};

const KIND_LABEL: Record<MusicEngine["kind"], string> = {
  local: "local",
  cloud: "api",
  plugin: "plugin",
};

/** Picks which provider/model generates the audio, plus duration where supported. */
export function EngineSelect({
  engines,
  value,
  onChange,
  duration,
  onDurationChange,
  disabled,
  loading,
}: Props) {
  const selected = engines.find((e) => e.id === value) ?? null;

  if (!loading && engines.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-primary/40 bg-primary/5 p-4 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-muted-foreground">
        No music engine yet.{" "}
        <Link to="/models" className="text-primary underline">
          download an open-source model
        </Link>{" "}
        or{" "}
        <Link to="/settings" className="text-primary underline">
          plug in an API
        </Link>
        .
      </div>
    );
  }

  const groups = engines.reduce<Record<string, MusicEngine[]>>((acc, e) => {
    (acc[e.providerName] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        className="w-full rounded-sm border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-40"
      >
        {loading && <option>loading engines…</option>}
        {Object.entries(groups).map(([provider, list]) => (
          <optgroup key={provider} label={provider}>
            {list.map((e) => (
              <option key={e.id} value={e.id} disabled={!e.ready}>
                {e.label} · {KIND_LABEL[e.kind]}
                {e.supportsLyrics ? "" : " · instrumental"}
                {e.ready ? "" : " · needs setup"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {selected && (
        <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {selected.description ?? selected.providerName}
          {!selected.supportsLyrics && " · lyrics are ignored by this model"}
          {selected.notReadyReason && (
            <span className="text-destructive"> · {selected.notReadyReason}</span>
          )}
        </p>
      )}

      {selected?.maxDurationSec && onDurationChange ? (
        <label className="block">
          <div className="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            <span>length</span>
            <span>{Math.round(duration ?? selected.defaultDurationSec ?? 30)}s</span>
          </div>
          <input
            type="range"
            min={5}
            max={selected.maxDurationSec}
            step={5}
            value={duration ?? selected.defaultDurationSec ?? 30}
            onChange={(e) => onDurationChange(Number(e.target.value))}
            disabled={disabled}
            className="w-full accent-primary"
          />
        </label>
      ) : null}
    </div>
  );
}
