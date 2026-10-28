import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type PlayerTrack = {
  id: string;
  title: string;
  artist?: string;
  audioUrl: string;
  imageUrl?: string;
  cover?: string;
};

type PlayerContextValue = {
  current: PlayerTrack | null;
  isPlaying: boolean;
  progress: number; // 0..1
  duration: number;
  currentTime: number;
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ratio: number) => void;
  close: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    audioRef.current = a;
    const onTime = () => setCurrentTime(a.currentTime);
    const onDur = () => setDuration(a.duration || 0);
    const onEnd = () => skipNext();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback((track: PlayerTrack, q?: PlayerTrack[]) => {
    const a = audioRef.current;
    if (!a) return;
    setCurrent(track);
    if (q) setQueue(q);
    if (a.src !== track.audioUrl) a.src = track.audioUrl;
    a.play().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, [current]);

  const skipNext = useCallback(() => {
    if (!current || queue.length === 0) {
      setIsPlaying(false);
      return;
    }
    const idx = queue.findIndex((t) => t.id === current.id);
    const nxt = queue[idx + 1];
    if (nxt) play(nxt, queue);
    else setIsPlaying(false);
  }, [current, queue, play]);

  const prev = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.currentTime > 3 || !current) {
      a.currentTime = 0;
      return;
    }
    const idx = queue.findIndex((t) => t.id === current.id);
    const p = queue[idx - 1];
    if (p) play(p, queue);
    else a.currentTime = 0;
  }, [current, queue, play]);

  const seek = useCallback(
    (ratio: number) => {
      const a = audioRef.current;
      if (!a || !duration) return;
      a.currentTime = Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration],
  );

  const close = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setCurrent(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const value = useMemo<PlayerContextValue>(
    () => ({
      current,
      isPlaying,
      progress: duration ? currentTime / duration : 0,
      duration,
      currentTime,
      play,
      toggle,
      next: skipNext,
      prev,
      seek,
      close,
    }),
    [current, isPlaying, duration, currentTime, play, toggle, skipNext, prev, seek, close],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
