import { useRef, useEffect, useState, useCallback } from "react";
import { Play, Pause } from "lucide-react";

interface WaveformPlayerProps {
  src: string;
  color?: string; // CSS color for the waveform bars
  className?: string;
}

const BAR_COUNT = 60;
const BAR_GAP = 2;

export function WaveformPlayer({
  src,
  color = "hsl(var(--primary))",
  className = "",
}: WaveformPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<number[]>([]);
  const rafRef = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  // Generate waveform bars from audio data
  const generateBars = useCallback(async (url: string) => {
    try {
      const ctx = new AudioContext();
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf);
      const raw = audio.getChannelData(0);
      const step = Math.floor(raw.length / BAR_COUNT);
      const bars: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += Math.abs(raw[i * step + j] || 0);
        }
        bars.push(sum / step);
      }
      // Normalize to 0..1
      const max = Math.max(...bars, 0.01);
      barsRef.current = bars.map((b) => b / max);
      ctx.close();
      setReady(true);
    } catch {
      // Fallback: generate random-looking bars
      barsRef.current = Array.from({ length: BAR_COUNT }, () => 0.15 + Math.random() * 0.85);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    generateBars(src);
  }, [src, generateBars]);

  // Draw waveform
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const bars = barsRef.current;
    if (!bars.length) return;

    const barW = Math.max(1, (w - (bars.length - 1) * BAR_GAP) / bars.length);
    const playedIdx = Math.floor(progress * bars.length);

    bars.forEach((val, i) => {
      const x = i * (barW + BAR_GAP);
      const barH = Math.max(2, val * h * 0.9);
      const y = (h - barH) / 2;

      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1.5);
      if (i <= playedIdx) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;
      }
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [progress, color]);

  useEffect(() => {
    if (ready) draw();
  }, [ready, draw, progress]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => draw());
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [draw]);

  // Audio time tracking
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      if (el.duration) setProgress(el.currentTime / el.duration);
    };
    const onMeta = () => setDuration(el.duration || 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, []);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().catch(() => {});
      setPlaying(true);
    }
  };

  const seek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const el = audioRef.current;
    if (!canvas || !el || !el.duration) return;
    const rect = canvas.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    el.currentTime = pct * el.duration;
    setProgress(pct);
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) s = 0;
    return `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, "0")}`;
  };

  const currentTime = duration * progress;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />

      {/* Play / Pause */}
      <button
        onClick={togglePlay}
        className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 transition"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
      </button>

      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        onClick={seek}
        className="flex-1 h-10 cursor-pointer rounded-sm"
        style={{ minWidth: 0 }}
      />

      {/* Time */}
      <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground w-16 text-right">
        {fmt(currentTime)} / {fmt(duration)}
      </span>
    </div>
  );
}
