import { usePlayer } from "@/hooks/usePlayer";
import { Play, Pause, SkipBack, SkipForward, X } from "lucide-react";

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${sec}`;
}

export function GlobalPlayer() {
  const { current, isPlaying, progress, currentTime, duration, toggle, next, prev, seek, close } =
    usePlayer();
  if (!current) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div
        className="group relative h-1 w-full cursor-pointer bg-muted"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - r.left) / r.width);
        }}
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className="h-12 w-12 flex-shrink-0 rounded-sm bg-cover bg-center"
            style={{
              background: current.imageUrl
                ? `url(${current.imageUrl}) center/cover`
                : current.cover || "linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))",
            }}
          />
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold">{current.title}</p>
            {current.artist && (
              <p className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {current.artist}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={prev} className="rounded-full p-2 hover:bg-muted" aria-label="Previous">
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={toggle}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 translate-x-[1px]" />
            )}
          </button>
          <button onClick={next} className="rounded-full p-2 hover:bg-muted" aria-label="Next">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="hidden min-w-[100px] text-right font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        <button
          onClick={close}
          className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close player"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
