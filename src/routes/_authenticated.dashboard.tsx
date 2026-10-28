import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { EngineStatus } from "@shared/types";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/hooks/useAuth";
import { useSongs } from "@/hooks/useSongs";
import { useEngines } from "@/hooks/useEngines";
import { invoke } from "@/lib/bridge";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { profile } = useAuth();
  const { songs } = useSongs();
  const { engines, loading } = useEngines();
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  useEffect(() => {
    invoke<EngineStatus>("engine:status")
      .then(setEngine)
      .catch(() => {});
  }, []);
  const ready = engines.filter((e) => e.ready);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] px-6 py-16">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
          ◐ dashboard
        </p>
        <h1 className="mb-12 font-display text-5xl font-black md:text-6xl">
          {profile?.displayName || "Producer"}
        </h1>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-sm border-2 border-primary p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Music engines
            </p>
            <p className="mt-2 font-display text-6xl font-black text-primary">
              {loading ? "…" : ready.length}
            </p>
            <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {ready.length
                ? ready
                    .map((e) => e.label)
                    .slice(0, 3)
                    .join(" · ")
                : "none set up yet"}
            </p>
            <Link
              to="/settings"
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-widest underline"
            >
              + plug in an API
            </Link>
          </div>
          <div className="rounded-sm border-2 border-border p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Local engine
            </p>
            <p className="mt-2 font-display text-3xl font-bold">
              {!engine
                ? "…"
                : engine.running
                  ? "Running"
                  : engine.installed
                    ? "Idle"
                    : "Not installed"}
            </p>
            {engine?.gpu && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {engine.gpu}
              </p>
            )}
            <Link
              to="/models"
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-widest underline"
            >
              → manage models
            </Link>
          </div>
          <div className="rounded-sm border-2 border-border p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Songs
            </p>
            <p className="mt-2 font-display text-6xl font-black">{songs.length}</p>
            <Link
              to="/library"
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-widest underline"
            >
              → library
            </Link>
          </div>
        </div>

        {/* Stems Lab Promotion Banner */}
        <div className="mt-8 relative overflow-hidden rounded-sm border border-primary/20 bg-primary/5 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 animate-fade-in">
          <div className="absolute top-0 right-0 -translate-y-12 translate-x-12 w-64 h-64 bg-primary/15 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary font-mono text-[9px] uppercase tracking-widest font-bold">
              ⚡ runs on your machine
            </div>
            <h3 className="font-display text-2xl font-black text-white">
              Split Songs with AI Stems Lab
            </h3>
            <p className="font-mono text-xs text-muted-foreground leading-relaxed">
              Extract independent acapella vocals, drums, bass, and instrumentals from any generated
              song. Load them directly into the Multitrack DAW for custom EQ, mix editing, and
              export!
            </p>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto shrink-0">
            <Link
              to="/stems"
              className="flex-1 md:flex-none text-center rounded-sm bg-primary px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-primary-foreground font-bold hover:opacity-90 transition-all whitespace-nowrap"
            >
              Open Stems Lab
            </Link>
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border border-white/5 bg-white/[0.02] px-3.5 py-3 rounded-sm text-center">
              demucs · local
            </div>
          </div>
        </div>

        <h2 className="mt-16 mb-6 font-display text-3xl font-black">Recent songs</h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {songs.slice(0, 6).map((s) => (
            <Link
              key={s.id}
              to="/song/$id"
              params={{ id: s.id }}
              className="group rounded-sm border border-border p-4 hover:border-primary transition-colors"
            >
              <div
                className="mb-3 aspect-square w-full rounded-sm"
                style={{
                  background: s.imageUrl ? `url(${s.imageUrl}) center/cover` : s.cover,
                }}
              />
              <p className="font-display text-lg font-bold truncate">{s.title}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">
                {s.style}
              </p>
            </Link>
          ))}
          {songs.length === 0 && (
            <Link
              to="/studio"
              className="col-span-full rounded-sm border-2 border-dashed border-border p-12 text-center font-mono text-xs uppercase tracking-widest hover:border-primary"
            >
              Make your first song →
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
