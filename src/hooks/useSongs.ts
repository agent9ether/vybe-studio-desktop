import { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/local-db";
import { useAuth } from "@/hooks/useAuth";

export type Song = {
  id: string;
  title: string;
  style: string;
  lyrics: string;
  prompt: string;
  createdAt: number;
  cover: string; // gradient seed
  audioUrl?: string;
  imageUrl?: string;
  instrumentalUrl?: string;
  extractionStatus?: "none" | "processing" | "completed" | "failed";
  stems?: Record<string, string>;
  // Frontend-only metadata (mock fallback / future cover feature)
  voiceCoverOf?: string;
  voiceName?: string;
  voiceReferenceId?: string;
};

// Ultra-light columns for grid thumbnails — just enough to render the card.
// Full data (audio_url, style, etc.) loads on demand when clicking into a song.
const GRID_COLUMNS = "id, title, cover, image_url";

// Slightly heavier columns for when we need playback info
const LIST_COLUMNS =
  "id, title, style, created_at, cover, audio_url, image_url, instrumental_url, extraction_status, stems";

const CACHE_KEY = "vybe.songs.v2";
const CACHE_MAX = 80; // never cache more than this many songs
const PAGE_SIZE = 12; // load 12 songs at a time for fast initial paint
const userSongsCache = new Map<string, Song[]>();
const userSongsInflight = new Map<string, Promise<Song[]>>();

function readCachedSongs(userId?: string): Song[] {
  if (userId) {
    const memory = userSongsCache.get(userId);
    if (memory) return memory;
  }
  if (typeof window === "undefined") return [];
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? (JSON.parse(cached) as Song[]) : [];
  } catch {
    return [];
  }
}

export function useSongs() {
  const { user, loading: authLoading } = useAuth();
  const [songs, setSongs] = useState<Song[]>(() => readCachedSongs());
  const [loading, setLoading] = useState(() => readCachedSongs().length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Fetch lightweight list (first page only) ----
  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      setSongs([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const start = Date.now();
      const cached = readCachedSongs(user.id);
      if (cached.length) setSongs(cached);
      else setLoading(true);
      setError(null);
      let request = userSongsInflight.get(user.id);
      if (!request) {
        request = Promise.resolve(
          db
            .from("songs")
            .select(LIST_COLUMNS)
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE),
        )
          .then(({ data, error: qErr }) => {
            if (qErr) throw qErr;
            return mapRows(data ?? []);
          })
          .finally(() => userSongsInflight.delete(user.id));
        userSongsInflight.set(user.id, request);
      }

      try {
        const freshSongs = await request;
        if (cancelled) return;
        userSongsCache.set(user.id, freshSongs);
        setSongs(freshSongs);
        setHasMore(freshSongs.length >= PAGE_SIZE);
      } catch (qErr: any) {
        console.error("useSongs query failed:", qErr);
        if (cancelled) return;
        setSongs([]);
        setHasMore(false);
        setError(qErr.message ?? "Songs failed to load");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  // ---- Load More ----
  const loadMore = useCallback(async () => {
    if (!user || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const { data, error: qErr } = await db
        .from("songs")
        .select(LIST_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(songs.length, songs.length + PAGE_SIZE - 1);

      if (qErr) throw qErr;
      const more = mapRows(data ?? []);
      if (more.length < PAGE_SIZE) setHasMore(false);
      setSongs((prev) => {
        const ids = new Set(prev.map((s) => s.id));
        const deduped = more.filter((s) => !ids.has(s.id));
        const merged = [...prev, ...deduped];
        userSongsCache.set(user.id, merged);
        return merged;
      });
    } catch (err: any) {
      console.error("loadMore failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [user, songs.length, loadingMore, hasMore]);

  // ---- Persist a trimmed copy to localStorage ----
  useEffect(() => {
    if (loading) return;
    try {
      const lite = songs
        .slice(0, CACHE_MAX)
        .map(({ lyrics: _l, prompt: _p, stems: _s, ...rest }) => rest);
      if (user) userSongsCache.set(user.id, lite as Song[]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(lite));
    } catch {
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify(
            songs.slice(0, 30).map(({ lyrics: _l, prompt: _p, stems: _s, ...rest }) => rest),
          ),
        );
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
    }
  }, [songs, loading]);

  // ---- Fetch a single full song (lyrics/prompt/stems) on demand ----
  const fetchFullSong = useCallback(
    async (id: string): Promise<Song | null> => {
      if (!user) return null;
      const { data, error } = await db
        .from("songs")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data || error) return null;
      const full = mapRow(data);
      // Merge back into the list so downstream consumers see updated fields
      setSongs((prev) => {
        const exists = prev.some((s) => s.id === id);
        if (exists) {
          return prev.map((s) => (s.id === id ? full : s));
        } else {
          return [full, ...prev];
        }
      });
      return full;
    },
    [user],
  );

  const save = async (song: Omit<Song, "id" | "createdAt" | "cover">) => {
    if (!user) throw new Error("Sign in required");
    const fresh: Song = {
      ...song,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      cover: pickCover(),
    };
    setSongs((prev) => [fresh, ...prev]);
    const { error } = await db.from("songs").insert({
      id: fresh.id,
      user_id: user.id,
      title: fresh.title,
      style: fresh.style,
      lyrics: fresh.lyrics,
      prompt: fresh.prompt,
      created_at: new Date(fresh.createdAt).toISOString(),
      cover: fresh.cover,
      audio_url: fresh.audioUrl,
      image_url: fresh.imageUrl,
      is_public: false,
    });

    if (error) {
      console.error("Supabase Insert Error:", error);
      throw new Error(`Failed to save song: ${error.message}`);
    }

    return fresh;
  };

  const remove = async (id: string) => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    await db.from("songs").delete().eq("id", id);
  };

  const update = async (id: string, patch: Partial<Song>) => {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

    await db
      .from("songs")
      .update({
        title: patch.title,
        style: patch.style,
        lyrics: patch.lyrics,
        prompt: patch.prompt,
        audio_url: patch.audioUrl,
        image_url: patch.imageUrl,
        instrumental_url: patch.instrumentalUrl,
        extraction_status: patch.extractionStatus,
        stems: patch.stems,
      })
      .eq("id", id);
  };

  return {
    songs,
    save,
    remove,
    update,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    fetchFullSong,
  };
}

// ---- helpers ----

function mapRow(item: any): Song {
  return {
    id: item.id,
    title: item.title,
    style: item.style ?? "",
    lyrics: item.lyrics ?? "",
    prompt: item.prompt ?? "",
    createdAt: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
    cover: item.cover || pickCover(),
    audioUrl: item.audio_url ?? undefined,
    imageUrl: item.image_url ?? undefined,
    instrumentalUrl: item.instrumental_url ?? undefined,
    extractionStatus: item.extraction_status ?? "none",
    stems: item.stems ?? undefined,
  };
}

function mapRows(data: any[]): Song[] {
  return data.map(mapRow);
}

const COVERS = [
  "linear-gradient(135deg, oklch(0.93 0.22 120), oklch(0.5 0.2 280))",
  "linear-gradient(135deg, oklch(0.68 0.22 35), oklch(0.2 0.05 320))",
  "linear-gradient(180deg, oklch(0.4 0.18 200), oklch(0.93 0.22 120))",
  "linear-gradient(45deg, oklch(0.2 0.05 60), oklch(0.68 0.22 35))",
  "radial-gradient(circle at 30% 30%, oklch(0.93 0.22 120), oklch(0.13 0.015 60) 70%)",
  "linear-gradient(135deg, oklch(0.55 0.25 340), oklch(0.93 0.22 120))",
];
function pickCover() {
  return COVERS[Math.floor(Math.random() * COVERS.length)];
}
