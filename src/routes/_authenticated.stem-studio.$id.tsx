import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { useSongs, type Song } from "@/hooks/useSongs";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ArrowLeft,
  Mic,
  Drum,
  Music2,
  Guitar,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/stem-studio/$id")({
  component: StemStudioPage,
});

// Demo stem fallback for expired Replicate URLs
const DEMO_STEMS: Record<string, string> = {
  vocals:
    "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/Vocals30.mp3",
  drums:
    "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/BassDrums30.mp3",
  bass: "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/BassDrums30.mp3",
  other:
    "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/Guitar30.mp3",
};

const STEM_ORDER = ["drums", "bass", "other", "vocals"] as const;
const STEM_META: Record<string, { label: string; Icon: any; accent: string; color: string }> = {
  drums: { label: "Drums", Icon: Drum, accent: "text-primary", color: "#c8e64c" },
  bass: { label: "Bass", Icon: Music2, accent: "text-blue-400", color: "#60a5fa" },
  other: { label: "Synths", Icon: Guitar, accent: "text-amber-400", color: "#fbbf24" },
  vocals: { label: "Vocals", Icon: Mic, accent: "text-pink-400", color: "#f472b6" },
};

function healUrl(_name: string, url: string) {
  // Fresh replicate.delivery URLs are valid for ~1h. Use them as-is; only the
  // actual fetch/decode path should fall back on a real error.
  return url;
}

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function StemStudioPage() {
  const { id } = useParams({ from: "/_authenticated/stem-studio/$id" });
  const navigate = useNavigate();
  const { songs, loading, fetchFullSong } = useSongs();
  const [song, setSong] = useState<Song | null>(null);

  useEffect(() => {
    const cached = songs.find((s) => s.id === id);
    if (cached?.stems) setSong(cached);
    else fetchFullSong(id).then((s) => s && setSong(s));
  }, [id, songs, fetchFullSong]);

  const stems = useMemo(() => {
    const raw = song?.stems ?? {};
    const list: { name: string; url: string }[] = [];
    STEM_ORDER.forEach((n) => {
      if (raw[n]) list.push({ name: n, url: healUrl(n, raw[n]) });
    });
    Object.entries(raw).forEach(([n, u]) => {
      if (!STEM_ORDER.includes(n as any)) list.push({ name: n, url: healUrl(n, u) });
    });
    return list;
  }, [song]);

  // Player state — Web Audio keeps all stems locked to one shared clock.
  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<string, AudioBuffer>>({});
  const bufferUrlsRef = useRef<Record<string, string>>({});
  const gainRefs = useRef<Record<string, GainNode>>({});
  const sourceRefs = useRef<Record<string, AudioBufferSourceNode>>({});
  const playStartedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const loadRunRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [soloed, setSoloed] = useState<Record<string, boolean>>({});

  // Init defaults when stems change
  useEffect(() => {
    const v: Record<string, number> = {};
    const m: Record<string, boolean> = {};
    const s: Record<string, boolean> = {};
    stems.forEach(({ name }) => {
      v[name] = 0.8;
      m[name] = false;
      s[name] = false;
    });
    setVolumes(v);
    setMuted(m);
    setSoloed(s);
    setTime(0);
    setDuration(0);
    setPlaying(false);
    pausedAtRef.current = 0;
    Object.values(sourceRefs.current).forEach((source) => {
      try {
        source.stop();
      } catch {}
      try {
        source.disconnect();
      } catch {}
    });
    sourceRefs.current = {};
    gainRefs.current = {};
    buffersRef.current = {};
    bufferUrlsRef.current = {};
  }, [stems.map((s) => s.url).join("|")]);

  const getAudioContext = () => {
    if (audioContextRef.current) return audioContextRef.current;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor();
    audioContextRef.current = ctx;
    return ctx;
  };

  const stopSources = () => {
    Object.values(sourceRefs.current).forEach((source) => {
      try {
        source.stop();
      } catch {}
      try {
        source.disconnect();
      } catch {}
    });
    sourceRefs.current = {};
  };

  const applyGains = () => {
    const ctx = audioContextRef.current;
    const anySolo = Object.values(soloed).some(Boolean);
    stems.forEach(({ name }) => {
      const gain = gainRefs.current[name];
      if (!gain) return;
      const effectiveMuted = muted[name] || (anySolo && !soloed[name]);
      const target = effectiveMuted ? 0 : (volumes[name] ?? 0.8);
      if (ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
      } else {
        gain.gain.value = target;
      }
    });
  };

  const loadBuffers = async () => {
    const run = ++loadRunRef.current;
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    await Promise.all(
      stems.map(async ({ name, url }) => {
        if (buffersRef.current[name] && bufferUrlsRef.current[name] === url) return;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load ${name}`);
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        if (run !== loadRunRef.current) return;
        buffersRef.current[name] = decoded;
        bufferUrlsRef.current[name] = url;
      }),
    );
    if (run !== loadRunRef.current) return;
    setDuration(Math.max(0, ...stems.map(({ name }) => buffersRef.current[name]?.duration ?? 0)));
  };

  const startSources = (offset: number) => {
    const ctx = getAudioContext();
    stopSources();
    const startAt = ctx.currentTime + 0.03;
    stems.forEach(({ name }) => {
      const buffer = buffersRef.current[name];
      if (!buffer) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.start(startAt, Math.min(offset, Math.max(0, buffer.duration - 0.01)));
      gainRefs.current[name] = gain;
      sourceRefs.current[name] = source;
    });
    playStartedAtRef.current = startAt - offset;
    applyGains();
  };

  // Apply mute/solo/volume as Web Audio gain only — sources never pause, so stems stay locked.
  useEffect(() => {
    applyGains();
  }, [muted, soloed, volumes, stems]);

  // Sync UI time from the shared Web Audio clock.
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const ctx = audioContextRef.current;
      const nextTime = ctx
        ? Math.max(0, ctx.currentTime - playStartedAtRef.current)
        : pausedAtRef.current;
      const bounded = duration ? Math.min(nextTime, duration) : nextTime;
      setTime(bounded);
      pausedAtRef.current = bounded;
      if (duration && bounded >= duration) {
        setPlaying(false);
        pausedAtRef.current = 0;
        setTime(0);
        stopSources();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, duration]);

  const togglePlay = async () => {
    if (!stems.length) return;
    if (playing) {
      const ctx = audioContextRef.current;
      pausedAtRef.current = ctx ? Math.max(0, ctx.currentTime - playStartedAtRef.current) : time;
      stopSources();
      setPlaying(false);
      return;
    }
    setBuffering(true);
    try {
      await loadBuffers();
      startSources(pausedAtRef.current);
      setPlaying(true);
    } finally {
      setBuffering(false);
    }
  };

  const seek = (pct: number) => {
    const t = pct * (duration || 0);
    pausedAtRef.current = t;
    if (playing) startSources(t);
    setTime(t);
  };

  const toggleSolo = (name: string) => setSoloed((s) => ({ ...s, [name]: !s[name] }));
  const toggleMute = (name: string) => setMuted((m) => ({ ...m, [name]: !m[name] }));

  // ---------- Render ----------
  if (loading && !song) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-md px-6 py-24 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Loading stem studio…
        </main>
      </div>
    );
  }

  if (!song) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-md px-6 py-24 text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Song not found.
          </p>
          <Link
            to="/stems"
            className="mt-4 inline-block font-mono text-[10px] uppercase tracking-widest text-primary underline"
          >
            ← Back to stems
          </Link>
        </main>
      </div>
    );
  }

  if (!stems.length) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-md px-6 py-24 text-center">
          <h1 className="font-display text-2xl font-black mb-3">No stems yet</h1>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-6">
            Extract stems for "{song.title}" first.
          </p>
          <Link
            to="/daw/$id"
            params={{ id: song.id }}
            className="rounded-sm border border-primary/30 bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-primary"
          >
            🎛️ Open DAW to extract
          </Link>
        </main>
      </div>
    );
  }

  const progress = duration ? time / duration : 0;
  const cover = song.imageUrl;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-6 sm:max-w-lg">
        {/* Back */}
        <button
          onClick={() => navigate({ to: "/stems" })}
          className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3 w-3" /> Stems Lab
        </button>

        {/* Cover + EQ bars */}
        <div className="relative overflow-hidden rounded-md border border-border bg-card">
          <div className="relative aspect-[4/3] w-full">
            {cover ? (
              <img
                src={cover}
                alt={song.title}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0" style={{ background: song.cover }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
            {/* Animated EQ bars */}
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-1 px-4 pb-2 h-2/3 pointer-events-none">
              {Array.from({ length: 28 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.6)]"
                  style={{
                    height: `${20 + Math.abs(Math.sin((i + time * 4) * 0.6)) * 80}%`,
                    opacity: playing ? 0.9 : 0.35,
                    transition: "height 120ms ease-out",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Now playing strip */}
          <div className="border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-primary">
              Now Playing
            </p>
            <h1 className="mt-1 font-display text-xl font-black leading-tight">
              {song.title.toUpperCase()}
            </h1>
            <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{song.style || "—"}</span>
              <span className="text-primary">
                {formatTime(time)} / {formatTime(duration)}
              </span>
            </div>
          </div>
        </div>

        {/* Scrubber */}
        <div className="mt-3 px-1">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={progress}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        {/* Transport */}
        <div className="mt-2 flex items-center justify-center gap-8 py-4">
          <button
            onClick={() => seek(0)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Restart"
          >
            <SkipBack className="h-6 w-6" />
          </button>
          <button
            onClick={togglePlay}
            disabled={buffering}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_30px_hsl(var(--primary)/0.5)] hover:scale-105 transition disabled:opacity-60"
            aria-label={playing ? "Pause" : "Play"}
          >
            {buffering ? (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            ) : playing ? (
              <Pause className="h-7 w-7" />
            ) : (
              <Play className="h-7 w-7 ml-1" />
            )}
          </button>
          <button
            onClick={() => seek(Math.min(1, progress + 0.1))}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Skip forward"
          >
            <SkipForward className="h-6 w-6" />
          </button>
        </div>

        {/* Stem channels — vertical fader strips */}
        <div className="mt-2 grid grid-cols-4 gap-2">
          {stems.map(({ name }) => {
            const meta = STEM_META[name] ?? {
              label: name,
              Icon: Music2,
              accent: "text-emerald-400",
              color: "#34d399",
            };
            const Icon = meta.Icon;
            const isMute = muted[name];
            const isSolo = soloed[name];
            const vol = volumes[name] ?? 0.8;
            return (
              <div
                key={name}
                className="flex flex-col items-center rounded-md border border-border bg-card/80 px-2 py-3"
                style={{ borderTopWidth: 3, borderTopColor: meta.color }}
              >
                <Icon className="h-4 w-4" style={{ color: meta.color }} />
                <span
                  className="mt-1 font-mono text-[9px] uppercase tracking-widest truncate max-w-full"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </span>

                {/* Vertical fader */}
                <div className="relative my-3 flex h-40 w-10 items-center justify-center">
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full bg-secondary overflow-hidden flex flex-col justify-end">
                    <div
                      className="w-full rounded-full transition-all"
                      style={{
                        height: `${vol * 100}%`,
                        backgroundColor: isMute ? "hsl(var(--muted-foreground))" : meta.color,
                        opacity: isMute ? 0.3 : 0.85,
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={vol}
                    onChange={(e) => setVolumes((v) => ({ ...v, [name]: Number(e.target.value) }))}
                    className="absolute h-40 w-40 cursor-pointer -rotate-90 z-10"
                    style={{ accentColor: meta.color, opacity: 0.7 }}
                  />
                </div>

                <span
                  className="font-mono text-[9px] tabular-nums"
                  style={{ color: isMute ? "hsl(var(--muted-foreground))" : meta.color }}
                >
                  {Math.round(vol * 100)}
                </span>

                <div className="mt-3 flex w-full flex-col gap-1">
                  <button
                    onClick={() => toggleSolo(name)}
                    className={`rounded-sm border py-1 font-mono text-[9px] uppercase tracking-widest transition ${
                      isSolo
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    S
                  </button>
                  <button
                    onClick={() => toggleMute(name)}
                    className={`rounded-sm border py-1 font-mono text-[9px] uppercase tracking-widest transition ${
                      isMute
                        ? "border-destructive bg-destructive/20 text-destructive"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    M
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/daw/$id"
            params={{ id: song.id }}
            className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary underline"
          >
            Open in full DAW workspace →
          </Link>
        </div>
      </main>
    </div>
  );
}
