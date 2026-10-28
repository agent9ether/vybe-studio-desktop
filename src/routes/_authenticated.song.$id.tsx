import { createFileRoute, Link, useParams, useSearch, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useServerFn } from "@/lib/server-fn";
import { useState, useRef, useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { useSongs, Song } from "@/hooks/useSongs";
import { useVoiceReferences } from "@/hooks/useVoiceReferences";
import { startMusic, waitForMusic, activeMusicJob } from "@/lib/music.functions";
import { generateSong } from "@/lib/songs.functions";
import { startStemExtraction, pollStemExtraction, clearStems } from "@/lib/replicate.functions";
import { db } from "@/lib/local-db";
import { invoke } from "@/lib/bridge";
import { usePlayer } from "@/hooks/usePlayer";
import {
  useEngines,
  pickDefaultEngine,
  rememberEngine,
  wantsCompactLyrics,
} from "@/hooks/useEngines";
import { EngineSelect } from "@/components/EngineSelect";
import { VoiceCloneWorkspace } from "@/components/VoiceCloneWorkspace";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/song/$id")({
  validateSearch: z.object({
    engine: z.string().optional(),
  }),
  component: SongPage,
});

function SongPage() {
  const { id } = useParams({ from: "/_authenticated/song/$id" });
  const navigate = useNavigate();
  const { songs, save, update, remove, loading: songsLoading, fetchFullSong } = useSongs();
  const {
    voices,
    addVoice,
    removeVoice,
    resetTrainingStatus,
    refresh: refreshVoices,
    loading: voicesLoading,
  } = useVoiceReferences();
  const song = songs.find((s) => s.id === id);
  const { play, toggle, current, isPlaying } = usePlayer();
  const { user } = useAuth();

  const [publicSong, setPublicSong] = useState<Song | null>(null);
  const [fetchAttempted, setFetchAttempted] = useState(false);

  // Reset local state when navigating between different songs
  useEffect(() => {
    setPublicSong(null);
    setFetchAttempted(false);
  }, [id]);

  // If the song isn't in our local library (e.g. someone else's public song from Explore)
  useEffect(() => {
    if (!song && !fetchAttempted && id) {
      const fetchPublic = async () => {
        try {
          const { data, error } = await db.from("songs").select("*").eq("id", id).maybeSingle();

          if (data && !error) {
            setPublicSong({
              id: data.id,
              title: data.title,
              style: data.style ?? "",
              lyrics: data.lyrics ?? "",
              prompt: data.prompt ?? "",
              createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
              cover:
                data.cover || "linear-gradient(135deg, oklch(0.55 0.25 340), oklch(0.93 0.22 120))",
              audioUrl: data.audio_url ?? undefined,
              imageUrl: data.image_url ?? undefined,
              instrumentalUrl: data.instrumental_url ?? undefined,
              extractionStatus: (data.extraction_status as any) ?? "none",
              stems: (data.stems as Record<string, string>) ?? undefined,
            });
          }
        } catch (err) {
          console.error(err);
        } finally {
          setFetchAttempted(true);
        }
      };
      fetchPublic();
    } else if (song) {
      setFetchAttempted(true);
    }
  }, [song, id, fetchAttempted]);

  const displaySong = song || publicSong;

  const hasCoverSuffix = displaySong?.title
    ? displaySong.title.includes(" (") && displaySong.title.endsWith(" Cover)")
    : false;
  let originalSong: Song | undefined;
  if (hasCoverSuffix && displaySong) {
    const originalTitle = displaySong.title.split(" (")[0];
    originalSong = songs.find((s) => s.title === originalTitle && s.id !== displaySong.id);
  }

  const coverSongs = displaySong
    ? songs.filter(
        (s) => s.title.startsWith(`${displaySong.title} (`) && s.title.endsWith(" Cover)"),
      )
    : [];

  const startExtraction = useServerFn(startStemExtraction);
  const pollExtraction = useServerFn(pollStemExtraction);
  const clearStemsFn = useServerFn(clearStems);

  const [extracting, setExtracting] = useState(false);

  const onClearStems = async () => {
    if (!displaySong) return;
    if (!confirm("Delete extracted stems for this song? You can extract them again any time."))
      return;
    try {
      await clearStemsFn({ data: { songId: displaySong.id } });
      if (song) {
        update(song.id, { stems: undefined, instrumentalUrl: undefined, extractionStatus: "none" });
      } else {
        setPublicSong((prev) =>
          prev
            ? { ...prev, stems: undefined, instrumentalUrl: undefined, extractionStatus: "none" }
            : null,
        );
      }
    } catch (e: any) {
      alert(e?.message || "Failed to clear stems");
    }
  };

  const onExtract = async () => {
    if (!displaySong?.audioUrl) {
      alert(
        "⚠️ This track is missing its source audio file. Please generate or regenerate the audio before separating stems.",
      );
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      if (song) {
        update(song.id, { extractionStatus: "processing" });
      } else {
        setPublicSong((prev) => (prev ? { ...prev, extractionStatus: "processing" } : null));
      }

      const startRes = (await startExtraction({
        data: {
          audioUrl: displaySong.audioUrl,
          songId: displaySong.id,
        },
      })) as any;

      let done = false;
      let attempts = 0;
      let finalRes: any = null;

      while (!done && attempts < 900) {
        await new Promise((r) => setTimeout(r, 2000));
        const check = await pollExtraction({
          data: {
            predictionId: startRes.predictionId,
            songId: displaySong.id,
            isDemo: startRes.isDemo,
          },
        });

        if (check.status === "succeeded") {
          finalRes = check;
          done = true;
        }
        attempts++;
      }

      if (!finalRes || !finalRes.instrumentalUrl) {
        throw new Error("Extraction timed out");
      }

      if (song) {
        update(song.id, {
          instrumentalUrl: finalRes.instrumentalUrl,
          stems: finalRes.stems,
          extractionStatus: "completed",
        });
      } else {
        setPublicSong((prev) =>
          prev
            ? {
                ...prev,
                instrumentalUrl: finalRes.instrumentalUrl,
                stems: finalRes.stems,
                extractionStatus: "completed",
              }
            : null,
        );
      }
    } catch (err: any) {
      console.error("Extraction error:", err);
      const msg = err?.message || "";
      if (msg.includes("EXTRACTION_FAILED")) {
        setError(
          msg.replace(/^EXTRACTION_FAILED:?\s*/, "") ||
            "Stem extraction failed — please try again.",
        );
      } else {
        setError(msg || "Extraction failed. Please try again.");
      }
      if (song) {
        update(song.id, { extractionStatus: "failed" });
      } else {
        setPublicSong((prev) => (prev ? { ...prev, extractionStatus: "failed" } : null));
      }
    } finally {
      setExtracting(false);
    }
  };

  const search = useSearch({ from: "/_authenticated/song/$id" });

  const isCurrent = current?.id === displaySong?.id;

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const { engines, loading: enginesLoading } = useEngines();
  const [engineId, setEngineId] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const selectedEngine = engines.find((e) => e.id === engineId) ?? null;

  // Pick an engine once the list loads: the one passed from the studio, the
  // last one used, or the first ready one.
  useEffect(() => {
    if (engineId || engines.length === 0) return;
    const def = pickDefaultEngine(engines, search.engine);
    if (def) setEngineId(def.id);
  }, [engines, engineId, search.engine]);

  useEffect(() => {
    if (selectedEngine) setDuration(selectedEngine.defaultDurationSec);
  }, [selectedEngine?.id]);

  const [isEditing, setIsEditing] = useState(false);
  const [editedLyrics, setEditedLyrics] = useState("");
  const [regeneratingLyrics, setRegeneratingLyrics] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const regenLyricsFn = useServerFn(generateSong);

  const onRegenerateLyrics = async () => {
    if (!displaySong?.prompt) {
      alert("This song has no prompt to regenerate lyrics from.");
      return;
    }
    if (!confirm("Regenerate lyrics for this song? Your current lyrics will be replaced.")) return;
    setRegeneratingLyrics(true);
    setError(null);
    try {
      const res = (await regenLyricsFn({
        data: { prompt: displaySong.prompt, compact: wantsCompactLyrics(engineId) },
      })) as any;
      const newLyrics = res?.lyrics || "";
      if (!newLyrics) throw new Error("No lyrics returned");
      if (song) {
        await update(song.id, { lyrics: newLyrics });
      } else {
        setPublicSong((prev) => (prev ? { ...prev, lyrics: newLyrics } : null));
      }
      setEditedLyrics(newLyrics);
    } catch (err: any) {
      setError(err?.message || "Failed to regenerate lyrics");
    } finally {
      setRegeneratingLyrics(false);
    }
  };

  // Sync editedLyrics with displaySong.lyrics when loaded
  useEffect(() => {
    if (displaySong?.lyrics) {
      setEditedLyrics(displaySong.lyrics);
    }
  }, [displaySong?.lyrics]);

  // Sync editedTitle with displaySong.title when loaded
  useEffect(() => {
    if (displaySong?.title) {
      setEditedTitle(displaySong.title);
    }
  }, [displaySong?.title]);

  // Lazy-load full song data (lyrics, prompt, stems) on detail page
  useEffect(() => {
    if (!song && id) {
      fetchFullSong(id);
    } else if (displaySong && !displaySong.lyrics && !displaySong.prompt) {
      fetchFullSong(id);
    }
  }, [id, song, displaySong?.lyrics, displaySong?.prompt, fetchFullSong]);

  // If a generation for this song is still running (e.g. you navigated away
  // and came back), reattach to it so progress and the result show up here.
  useEffect(() => {
    if (!displaySong?.id || loading) return;
    let cancelled = false;
    activeMusicJob(displaySong.id).then((jobId) => {
      if (!jobId || cancelled) return;
      followJob(jobId, displaySong.id).catch((e) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySong?.id]);

  const followJob = async (jobId: string, songId: string) => {
    setLoading(true);
    setError(null);
    try {
      const { audioUrl } = await waitForMusic(jobId, (job) => {
        if (job.progress >= 0) setProgress(Math.round(job.progress * 100));
        if (job.message) setStatusText(job.message);
      });
      setProgress(100);
      if (song && song.id === songId) await update(song.id, { audioUrl });
      else setPublicSong((prev) => (prev ? { ...prev, audioUrl } : prev));
      return audioUrl;
    } finally {
      setLoading(false);
      setStatusText("");
      setTimeout(() => setProgress(0), 1000);
    }
  };

  if (songsLoading || voicesLoading || (!displaySong && !fetchAttempted)) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-[900px] px-6 py-24 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Loading song data…
        </main>
      </div>
    );
  }

  if (!displaySong) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-[900px] px-6 py-24 text-center">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            404
          </p>
          <h1 className="mb-6 font-display text-5xl font-bold">Song not found</h1>
          <Link
            to="/library"
            className="font-mono text-xs uppercase tracking-widest text-primary underline"
          >
            ← back to library
          </Link>
        </main>
      </div>
    );
  }

  const onGenerate = async () => {
    if (!selectedEngine) {
      setError("Pick a music engine first — download a model or add an API in Settings.");
      return;
    }
    if (!selectedEngine.ready) {
      setError(selectedEngine.notReadyReason ?? "This engine needs setup in Settings.");
      return;
    }
    setProgress(0);
    setError(null);
    rememberEngine(selectedEngine.id);

    const musicPrompt = `${displaySong.style}. ${displaySong.prompt}`.slice(0, 1000);
    const lyrics = (
      displaySong.lyrics && displaySong.lyrics.trim().length >= 10
        ? displaySong.lyrics
        : `[Verse]\n${displaySong.title}\n${displaySong.prompt}\n[Chorus]\n${displaySong.title}`
    ).slice(0, 3500);

    try {
      setLoading(true);
      setStatusText("Starting…");
      const { jobId } = await startMusic({
        songId: displaySong.id,
        engineId: selectedEngine.id,
        prompt: musicPrompt,
        lyrics,
        durationSec: selectedEngine.maxDurationSec ? duration : undefined,
      });
      const audioUrl = await followJob(jobId, displaySong.id);
      play({
        id: displaySong.id,
        title: displaySong.title,
        artist: displaySong.style,
        audioUrl,
        imageUrl: displaySong.imageUrl,
        cover: displaySong.cover,
      });
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Generation failed");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <Link
            to="/library"
            className="inline-block font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-primary"
          >
            ← library
          </Link>
          {song && (
            <button
              onClick={() => {
                if (confirm("Delete this song?")) {
                  remove(displaySong.id);
                  navigate({ to: "/library" });
                }
              }}
              className="font-mono text-xs uppercase tracking-widest text-destructive hover:underline"
            >
              delete song
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-12 md:grid-cols-[400px_1fr]">
          <div>
            <div className="relative aspect-square w-full shadow-2xl">
              {displaySong.imageUrl ? (
                <img
                  src={displaySong.imageUrl}
                  alt={displaySong.title}
                  className="h-full w-full rounded-sm object-cover"
                />
              ) : (
                <div
                  className="h-full w-full rounded-sm"
                  style={{ background: displaySong.cover }}
                  aria-hidden
                />
              )}
            </div>

            {isEditingTitle ? (
              <div className="mt-6 space-y-2">
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (song) update(song.id, { title: editedTitle });
                      setIsEditingTitle(false);
                    }
                    if (e.key === "Escape") {
                      setEditedTitle(displaySong.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  autoFocus
                  className="w-full rounded-sm border border-primary/50 bg-background px-3 py-2 font-display text-3xl font-black leading-none text-foreground focus:border-primary focus:outline-none md:text-5xl"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (song) update(song.id, { title: editedTitle });
                      setIsEditingTitle(false);
                    }}
                    className="rounded-sm bg-primary px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
                  >
                    save
                  </button>
                  <button
                    onClick={() => {
                      setEditedTitle(displaySong.title);
                      setIsEditingTitle(false);
                    }}
                    className="rounded-sm border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                  >
                    cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex items-start gap-3">
                <h1 className="font-display text-5xl font-black leading-none">
                  {displaySong.title}
                </h1>
                {song && (
                  <button
                    onClick={() => setIsEditingTitle(true)}
                    className="mt-2 rounded-sm p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    title="Edit title"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <p className="mt-3 font-mono text-xs uppercase tracking-widest text-primary">
              {displaySong.style}
            </p>
            <p className="mt-2 font-mono text-xs italic text-muted-foreground">
              "{displaySong.prompt}"
            </p>
            <div className="mt-2">
              <Link
                to="/studio"
                search={{ prompt: displaySong.prompt }}
                className="inline-flex items-center gap-2 rounded-sm bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
              >
                <span>✨</span> reuse prompt
              </Link>
            </div>

            {originalSong && (
              <div className="mt-6 rounded-sm border border-primary/20 bg-primary/5 p-4">
                <p className="font-mono text-[9px] uppercase tracking-widest text-primary/70">
                  Voice Cover
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  This is a cloned voice cover.
                </p>
                <Link
                  to="/song/$id"
                  params={{ id: originalSong.id }}
                  className="mt-3 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
                >
                  ← listen to original track
                </Link>
              </div>
            )}

            {coverSongs.length > 0 && (
              <div className="mt-6 space-y-3">
                <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Voice Covers ({coverSongs.length})
                </label>
                <div className="space-y-2">
                  {coverSongs.map((cover) => (
                    <Link
                      key={cover.id}
                      to="/song/$id"
                      params={{ id: cover.id }}
                      className="flex items-center justify-between rounded-sm border border-border bg-card/50 p-3 hover:border-primary hover:bg-card transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-base">🎙️</span>
                        <div>
                          <p className="font-semibold text-xs text-foreground">
                            {cover.title
                              .replace(`${displaySong.title} (`, "")
                              .replace(" Cover)", "")}
                          </p>
                          <p className="font-mono text-[8px] text-muted-foreground uppercase tracking-wider">
                            cloned voice version
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-[9px] uppercase text-primary hover:underline">
                        listen →
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 space-y-6 rounded-sm border border-border bg-card p-6">
              {/* Voice Cloning Selector */}
              <div>
                <label className="mb-3 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Voice Profile
                </label>
                <p className="mb-3 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-muted-foreground">
                  Clone a voice here, then apply it to this song's vocal stem in the{" "}
                  <Link
                    to="/daw/$id"
                    params={{ id: displaySong.id }}
                    className="text-primary underline"
                  >
                    DAW
                  </Link>{" "}
                  or Stems Lab.
                </p>
                {voices.length > 0 && (
                  <div className="mb-3 space-y-1 rounded-sm border border-border/50 bg-background/40 p-2">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                      Your cloned voices
                    </p>
                    {voices.map((v) => {
                      const isTraining =
                        v.trainingStatus === "pending" ||
                        v.trainingStatus === "training" ||
                        v.trainingStatus === "preparing";
                      return (
                        <div
                          key={v.id}
                          className="flex items-center justify-between gap-2 px-1 py-1 hover:bg-secondary/30 rounded-sm"
                        >
                          <span className="font-mono text-xs text-foreground truncate">
                            {v.name}
                            <span className="text-muted-foreground ml-2">
                              {isTraining ? "(Training...)" : ""}
                              {v.trainingStatus === "failed" ? "(Failed)" : ""}
                              {v.trainingStatus === "completed" ? "✓" : ""}
                            </span>
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {v.trainingStatus === "failed" && (
                              <button
                                type="button"
                                onClick={() => resetTrainingStatus(v.id)}
                                className="font-mono text-[9px] uppercase tracking-widest text-primary hover:text-primary/80"
                              >
                                ↻ retry
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={async () => {
                                if (
                                  !confirm(
                                    `Delete cloned voice "${v.name}"? The recording will also be removed.`,
                                  )
                                )
                                  return;
                                await removeVoice(v.id);
                              }}
                              className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:text-destructive shrink-0"
                            >
                              ✕ delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <VoiceCloneWorkspace userId={user?.id || ""} onVoiceAdded={() => refreshVoices()}>
                  <button
                    type="button"
                    className="w-full rounded-sm border border-dashed border-border py-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                  >
                    + clone new voice
                  </button>
                </VoiceCloneWorkspace>
              </div>

              {/* Engine Selector */}
              <div>
                <label className="mb-3 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  AI Engine
                </label>
                <EngineSelect
                  engines={engines}
                  loading={enginesLoading}
                  value={engineId}
                  onChange={setEngineId}
                  duration={duration}
                  onDurationChange={setDuration}
                  disabled={loading}
                />
              </div>

              {loading && (
                <div className="mb-4">
                  <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <span className="truncate pr-3">
                      {progress === 100 ? "Finished" : statusText || "Composing…"}
                    </span>
                    <span>{progress > 0 ? `${Math.round(progress)}%` : "…"}</span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full bg-primary transition-all duration-300 ease-out ${progress > 0 ? "" : "animate-pulse"}`}
                      style={{ width: `${progress > 0 ? progress : 100}%` }}
                    />
                  </div>
                </div>
              )}

              {displaySong.audioUrl ? (
                <>
                  <button
                    onClick={() => {
                      if (isCurrent) toggle();
                      else
                        play({
                          id: displaySong.id,
                          title: displaySong.title,
                          artist: displaySong.style,
                          audioUrl: displaySong.audioUrl!,
                          imageUrl: displaySong.imageUrl,
                          cover: displaySong.cover,
                        });
                    }}
                    className="w-full rounded-sm bg-primary px-6 py-4 font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground"
                  >
                    {isCurrent && isPlaying ? "❚❚ pause" : "▶ play"}
                  </button>
                  <audio controls src={displaySong.audioUrl} className="mt-3 w-full" />
                  <button
                    onClick={() => {
                      const ext = displaySong.audioUrl!.split(".").pop()?.split("?")[0] || "mp3";
                      void invoke("media:export", {
                        url: displaySong.audioUrl,
                        name: `${displaySong.title.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`,
                      });
                    }}
                    className="mt-3 block w-full rounded-sm border border-border px-4 py-3 text-center font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary"
                  >
                    ↓ export audio
                  </button>

                  <>
                    <button
                      onClick={onExtract}
                      disabled={
                        extracting ||
                        displaySong.extractionStatus === "processing" ||
                        displaySong.extractionStatus === "completed"
                      }
                      className={`mt-2 w-full rounded-sm border border-dashed px-4 py-3 font-mono text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-2 ${
                        displaySong.extractionStatus === "completed"
                          ? "text-primary border-primary/30 bg-primary/5 cursor-default"
                          : displaySong.extractionStatus === "processing"
                            ? "border-amber-500/30 text-amber-500 bg-amber-500/5 animate-pulse"
                            : displaySong.extractionStatus === "failed"
                              ? "border-destructive/40 text-destructive hover:bg-destructive/5"
                              : "border-border hover:border-primary hover:text-primary"
                      } disabled:opacity-75`}
                    >
                      <span>✨</span>
                      {extracting || displaySong.extractionStatus === "processing"
                        ? "extracting stems…"
                        : displaySong.extractionStatus === "completed"
                          ? "stems extracted successfully"
                          : displaySong.extractionStatus === "failed"
                            ? "retry stem extraction"
                            : "extract stems"}
                    </button>

                    <div className="mt-2 space-y-2">
                      <Link
                        to="/daw/$id"
                        params={{ id: displaySong.id }}
                        className="block w-full rounded-sm border border-primary/20 bg-primary/5 px-4 py-3 text-center font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors shadow-lg shadow-primary/5"
                      >
                        🎛️ open in DAW Workspace
                      </Link>
                      {(displaySong.extractionStatus === "completed" ||
                        displaySong.extractionStatus === "failed") && (
                        <button
                          onClick={onClearStems}
                          className="block w-full rounded-sm border border-border px-4 py-2 text-center font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:border-destructive hover:text-destructive transition-colors"
                        >
                          ✕ delete stems & reset
                        </button>
                      )}
                    </div>
                  </>

                  <button
                    onClick={onGenerate}
                    disabled={loading}
                    className="mt-4 w-full rounded-sm border border-border px-4 py-2 font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary disabled:opacity-40"
                  >
                    {loading ? "regenerating…" : "regenerate audio"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={onGenerate}
                    disabled={loading || !selectedEngine}
                    className="w-full rounded-sm bg-primary px-6 py-4 font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
                  >
                    {loading
                      ? progress > 0
                        ? `generating… ${Math.round(progress)}%`
                        : "generating…"
                      : "▶ generate audio"}
                  </button>
                  {selectedEngine && (
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {selectedEngine.providerName} · {selectedEngine.label}
                      {selectedEngine.kind === "local" ? " · runs on this machine" : ""}
                    </p>
                  )}
                </>
              )}
              {error && <p className="mt-3 font-mono text-xs text-destructive">{error}</p>}
            </div>
          </div>

          <div>
            {isEditing ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    edit lyrics
                  </p>
                </div>
                <textarea
                  value={editedLyrics}
                  onChange={(e) => setEditedLyrics(e.target.value)}
                  rows={20}
                  className="w-full resize-y rounded-sm border border-border bg-card p-6 font-display text-2xl leading-[1.4] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      try {
                        await update(displaySong.id, { lyrics: editedLyrics });
                        setIsEditing(false);
                      } catch (err) {
                        console.error("Failed to save lyrics:", err);
                        alert("Failed to save lyrics. Please try again.");
                      }
                    }}
                    className="rounded-sm bg-primary px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-primary-foreground font-bold hover:opacity-90 transition-opacity"
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={() => {
                      setEditedLyrics(displaySong.lyrics || "");
                      setIsEditing(false);
                    }}
                    className="rounded-sm border border-border px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    lyrics
                  </p>
                  {song && (
                    <div className="flex items-center gap-4">
                      <button
                        onClick={onRegenerateLyrics}
                        disabled={regeneratingLyrics}
                        className="font-mono text-xs uppercase tracking-widest text-primary hover:underline disabled:opacity-40"
                      >
                        {regeneratingLyrics ? "regenerating…" : "✨ regenerate lyrics"}
                      </button>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="font-mono text-xs uppercase tracking-widest text-primary hover:underline"
                      >
                        edit lyrics
                      </button>
                    </div>
                  )}
                </div>
                <pre className="whitespace-pre-wrap font-display text-2xl leading-[1.4]">
                  {displaySong.lyrics}
                </pre>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
