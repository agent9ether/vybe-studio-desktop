import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { useSongs, type Song } from "@/hooks/useSongs";
import { usePlayer } from "@/hooks/usePlayer";
import { thumbnailUrl } from "@/lib/image-utils";
import { Play, Pause, Sliders } from "lucide-react";

export const Route = createFileRoute("/_authenticated/library")({
  component: Library,
});

function Library() {
  const { songs, remove, loading, loadingMore, hasMore, loadMore, error } = useSongs();
  const { play, toggle, current, isPlaying } = usePlayer();

  const playable = songs.filter((s) => !!s.audioUrl);
  const toTrack = (s: Song) => ({
    id: s.id,
    title: s.title,
    artist: s.style,
    audioUrl: s.audioUrl!,
    imageUrl: s.imageUrl,
    cover: s.cover,
  });

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-10 flex flex-col gap-6 md:mb-12 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground sm:text-xs">
              ◐ your library
            </p>
            <h1 className="font-display text-5xl font-black leading-[0.95] sm:text-6xl md:text-8xl">
              {songs.length} <span className="italic text-primary">songs</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-stretch gap-3">
            <Link
              to="/studio"
              className="rounded-sm bg-primary px-4 py-3 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground sm:px-5"
            >
              + new song
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-sm border border-destructive/40 bg-destructive/5 p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-destructive">
              ⚠ couldn't load library
            </p>
            <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{error}</p>
          </div>
        ) : loading && songs.length === 0 ? (
          <div>
            <div className="mb-6 flex items-center gap-3">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                loading your library…
              </p>
              <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-border">
                <div className="absolute inset-y-0 left-0 w-1/3 animate-[loadingSlide_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-background p-6">
                  <div className="mb-4 aspect-square w-full animate-pulse rounded-sm bg-muted" />
                  <div className="mb-2 h-6 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ) : songs.length === 0 ? (
          <div className="rounded-sm border-2 border-dashed border-border p-16 text-center">
            <p className="mb-6 font-display text-3xl italic text-muted-foreground">silence.</p>
            <Link
              to="/studio"
              className="font-mono text-xs uppercase tracking-widest text-primary underline"
            >
              make your first song →
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {songs.map((s) => {
                const isCurrent = current?.id === s.id;
                return (
                  <div
                    key={s.id}
                    className="group relative bg-background p-6 transition hover:bg-card"
                  >
                    <Link to="/song/$id" params={{ id: s.id }} className="block">
                      <div
                        className="relative mb-4 aspect-square w-full overflow-hidden rounded-sm"
                        style={{
                          background: !s.imageUrl
                            ? s.cover ||
                              "linear-gradient(135deg, oklch(0.55 0.25 340), oklch(0.93 0.22 120))"
                            : undefined,
                        }}
                        aria-hidden
                      >
                        {s.imageUrl && (
                          <img
                            src={thumbnailUrl(s.imageUrl)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        )}
                        {s.audioUrl && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              if (isCurrent) toggle();
                              else play(toTrack(s), playable.map(toTrack));
                            }}
                            className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition group-hover:opacity-100"
                            aria-label={isCurrent && isPlaying ? "Pause" : "Play"}
                          >
                            {isCurrent && isPlaying ? (
                              <Pause className="h-5 w-5" />
                            ) : (
                              <Play className="h-5 w-5 translate-x-[1px]" />
                            )}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <h3 className="line-clamp-2 flex-1 font-display text-2xl font-bold leading-tight">
                          {s.title}
                        </h3>
                        {s.voiceName && (
                          <span className="shrink-0 rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary">
                            🎤 cover
                          </span>
                        )}
                      </div>
                      <p className="mt-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                        {s.voiceName ? `${s.style} · voice: ${s.voiceName}` : s.style}
                      </p>
                    </Link>
                    {s.extractionStatus === "completed" &&
                      s.stems &&
                      Object.keys(s.stems).length > 0 && (
                        <Link
                          to="/stem-studio/$id"
                          params={{ id: s.id }}
                          className="mt-3 flex items-center justify-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary transition hover:bg-primary/20"
                        >
                          <Sliders className="h-3 w-3" />
                          Stem Studio
                        </Link>
                      )}
                    <button
                      onClick={() => confirm("Delete this song?") && remove(s.id)}
                      className="absolute right-4 top-4 rounded-sm border border-border bg-background/80 px-2 py-1 font-mono text-[10px] uppercase tracking-widest opacity-0 backdrop-blur transition group-hover:opacity-100 hover:border-destructive hover:text-destructive"
                    >
                      delete
                    </button>
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="group relative overflow-hidden rounded-sm border border-border bg-background px-8 py-4 font-mono text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground transition-all hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <span className="relative z-10">{loadingMore ? "loading…" : "load more"}</span>
                  <span className="absolute inset-0 -translate-x-full bg-primary/5 transition-transform duration-300 group-hover:translate-x-0" />
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
