import { useCallback, useEffect, useState } from "react";
import type { MusicEngine } from "@shared/types";
import { listMusicEngines } from "@/lib/music.functions";

const LAST_ENGINE_KEY = "vybe.lastEngine";

let cached: MusicEngine[] | null = null;

/** Music engines (provider × model) that are enabled in Settings. */
export function useEngines() {
  const [engines, setEngines] = useState<MusicEngine[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listMusicEngines();
      cached = list;
      setEngines(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { engines, loading, error, refresh };
}

export function rememberEngine(id: string) {
  try {
    localStorage.setItem(LAST_ENGINE_KEY, id);
  } catch {
    // storage unavailable
  }
}

export function pickDefaultEngine(engines: MusicEngine[], preferred?: string | null) {
  const ready = engines.filter((e) => e.ready);
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_ENGINE_KEY);
  } catch {
    // storage unavailable
  }
  return (
    ready.find((e) => e.id === preferred) ??
    ready.find((e) => e.id === last) ??
    ready[0] ??
    engines[0] ??
    null
  );
}

/** Engines with tight lyric limits get the compact 5-section lyric format. */
export function wantsCompactLyrics(engineId?: string | null) {
  return !!engineId && /music-1\.5$/.test(engineId);
}
