import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@/lib/server-fn";
import { SiteHeader } from "@/components/SiteHeader";
import { useSongs, Song } from "@/hooks/useSongs";
import { useVoiceReferences } from "@/hooks/useVoiceReferences";
import { Upload, FileAudio, X, Mic } from "lucide-react";
import { WaveformPlayer } from "@/components/WaveformPlayer";
import { db } from "@/lib/local-db";
import { invoke } from "@/lib/bridge";
import { useAuth } from "@/hooks/useAuth";
import {
  clearStems,
  startStemExtraction,
  pollStemExtraction,
  startVocalTransform,
  pollVocalTransform,
} from "@/lib/replicate.functions";

export const Route = createFileRoute("/stems")({
  component: StemsPage,
});

function StemsPage() {
  const { songs, loading, save, update } = useSongs();
  const { user } = useAuth();

  const [importing, setImporting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Upload-your-own state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadingOwn, setUploadingOwn] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleFileSelect = (file: File) => {
    const allowedTypes = [
      "audio/mpeg",
      "audio/wav",
      "audio/mp4",
      "audio/x-m4a",
      "audio/ogg",
      "audio/flac",
      "audio/aac",
    ];
    if (
      !allowedTypes.some(
        (t) => file.type.startsWith("audio/") || file.name.match(/\.(mp3|wav|m4a|ogg|flac|aac)$/i),
      )
    ) {
      setUploadError("Please upload an audio file (MP3, WAV, M4A, OGG, FLAC)");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("File must be under 50 MB");
      return;
    }
    setUploadFile(file);
    setUploadError(null);
  };

  const handleUploadOwn = async () => {
    if (!uploadFile || !user) return;
    setUploadingOwn(true);
    setUploadError(null);
    try {
      const ext = uploadFile.name.split(".").pop() || "mp3";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: storageErr } = await db.storage.from("media").upload(path, uploadFile);
      if (storageErr) throw storageErr;
      const {
        data: { publicUrl },
      } = db.storage.from("media").getPublicUrl(path);

      const title = uploadFile.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      await save({
        title,
        style: "uploaded",
        lyrics: "[Uploaded Track]",
        prompt: "User uploaded audio file for stem extraction",
        audioUrl: publicUrl,
        extractionStatus: "none",
      });

      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      window.location.reload();
    } catch (err: any) {
      console.error("Upload error:", err);
      setUploadError(err.message || "Upload failed. Please try again.");
    } finally {
      setUploadingOwn(false);
    }
  };

  const handleImportDemoTracks = async () => {
    setImporting(true);
    try {
      // Pre-separated demo stems (from the open-source waveform-playlist project),
      // downloaded into the local library so the DAW can load them offline.
      const base =
        "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/";
      const fetchStem = (file: string) =>
        invoke<string>("media:fetch", { url: base + file, name: file, subdir: "demo" });
      const [vocals, drums, other] = await Promise.all([
        fetchStem("Vocals30.mp3"),
        fetchStem("BassDrums30.mp3"),
        fetchStem("Guitar30.mp3"),
      ]);
      const song = await save({
        title: "Groove Foundation (Demo)",
        style: "indie rock / demo stems",
        lyrics: "[Demo multitrack]",
        prompt: "Demo multitrack for exploring the DAW and Stems Lab",
        audioUrl: other,
      });
      await update(song.id, {
        stems: { vocals, drums, other },
        instrumentalUrl: other,
        extractionStatus: "completed",
      });

      alert("✨ Demo multitrack added to your library! Open it in the DAW Workspace to mix.");
      window.location.reload();
    } catch (err: any) {
      console.error("Demo track import failed:", err);
      alert(err.message || "Failed to import demo tracks. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const withStems = songs.filter(
    (s) => s.extractionStatus === "completed" && s.stems && Object.keys(s.stems).length > 0,
  );
  const processing = songs.filter((s) => s.extractionStatus === "processing");
  const available = songs.filter(
    (s) =>
      s.audioUrl &&
      (!s.extractionStatus || s.extractionStatus === "none" || s.extractionStatus === "failed"),
  );

  if (!isMounted || loading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-[900px] px-6 py-24 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Loading stems lab…
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] px-6 py-12">
        <div className="mb-8">
          <h1 className="font-display text-5xl font-black">Stems Lab</h1>
          <p className="mt-3 max-w-lg font-mono text-xs uppercase tracking-widest text-muted-foreground">
            AI-powered stem separation using Demucs. Extract vocals, drums, bass &amp; instrumentals
            from any track — generated or uploaded.
          </p>
        </div>

        {/* ── Upload Your Own Music ── */}
        <section className="mb-10">
          <h2 className="mb-4 font-mono text-[10px] uppercase tracking-widest text-primary">
            📤 Upload Your Own Music
          </h2>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFileSelect(file);
            }}
            onClick={() => !uploadFile && fileInputRef.current?.click()}
            className={`relative rounded-md border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
              dragOver
                ? "border-primary bg-primary/10"
                : uploadFile
                  ? "border-primary/40 bg-primary/5"
                  : "border-border hover:border-primary/30 hover:bg-primary/5"
            }`}
          >
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac"
              ref={fileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
              className="hidden"
            />

            {uploadFile ? (
              <div className="flex flex-col items-center gap-3">
                <FileAudio className="h-10 w-10 text-primary" />
                <div>
                  <p className="font-mono text-sm font-medium text-foreground">{uploadFile.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground mt-1">
                    {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUploadOwn();
                    }}
                    disabled={uploadingOwn}
                    className="rounded-sm bg-primary px-6 py-2.5 font-mono text-[10px] uppercase tracking-widest text-primary-foreground font-bold hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {uploadingOwn ? "Uploading…" : "Upload & Extract Stems"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadFile(null);
                      setUploadError(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="rounded-sm border border-border px-3 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="font-mono text-xs font-medium text-foreground">
                  {dragOver ? "Drop your audio file here" : "Drag & drop or click to upload"}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  MP3, WAV, M4A, OGG, FLAC — up to 50 MB
                </p>
              </div>
            )}
          </div>

          {uploadError && (
            <div className="mt-3 rounded-sm bg-destructive/10 p-3 font-mono text-xs text-destructive">
              {uploadError}
            </div>
          )}
        </section>

        {/* Currently Processing */}
        {processing.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-4 font-mono text-[10px] uppercase tracking-widest text-primary">
              ⏳ Currently Processing ({processing.length})
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {processing.map((song) => (
                <div
                  key={song.id}
                  className="rounded-sm border border-dashed border-primary/30 bg-card/50 p-4 flex justify-between items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
                      <span className="font-mono text-xs text-primary truncate">{song.title}</span>
                    </div>
                    <p className="mt-2 font-mono text-[9px] text-muted-foreground">
                      Extracting stems in background…
                    </p>
                  </div>
                  <Link
                    to="/daw/$id"
                    params={{ id: song.id }}
                    className="rounded-sm border border-primary/20 bg-primary/5 px-3 py-1.5 font-mono text-[9px] uppercase tracking-widest text-primary hover:bg-primary/10 transition-all text-center ml-4 shrink-0"
                  >
                    🎛️ DAW
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Completed Stems */}
        {withStems.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              ✨ Extracted Stems ({withStems.length} tracks)
            </h2>
            <div className="space-y-6">
              {withStems.map((song) => (
                <StemCard key={song.id} song={song} update={update} />
              ))}
            </div>
          </section>
        )}

        {/* Available for Extraction */}
        {available.length > 0 && (
          <section>
            <h2 className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              🎵 Available for Extraction ({available.length})
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {available.map((song) => (
                <AvailableCard key={song.id} song={song} update={update} />
              ))}
            </div>
          </section>
        )}

        {withStems.length === 0 && processing.length === 0 && available.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center max-w-lg mx-auto text-center rounded-sm border border-dashed border-primary/20 bg-primary/5 p-8 shadow-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-6 leading-relaxed">
              No songs yet. Generate a track in the{" "}
              <Link to="/studio" className="text-primary underline font-bold">
                Studio
              </Link>{" "}
              first, or import a demo multitrack to explore the DAW & Stems Lab!
            </p>
            <button
              onClick={handleImportDemoTracks}
              disabled={importing}
              className="w-full rounded-sm bg-primary px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-primary-foreground font-bold hover:opacity-90 transition disabled:opacity-50 shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
            >
              <span>{importing ? "⚡" : "⚡"}</span>
              <span>{importing ? "Importing Demo Tracks..." : "Import Demo Multitrack"}</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

type UpdateFn = (id: string, patch: Partial<Song>) => Promise<void> | void;

function StemActions({
  song,
  update,
  hasStems,
}: {
  song: Song;
  update: UpdateFn;
  hasStems: boolean;
}) {
  const clearFn = useServerFn(clearStems);
  const startFn = useServerFn(startStemExtraction);
  const pollFn = useServerFn(pollStemExtraction);
  const [busy, setBusy] = useState<null | "delete" | "extract">(null);

  const onDelete = async () => {
    if (!confirm("Delete extracted stems for this song? You can extract them again any time."))
      return;
    setBusy("delete");
    try {
      await clearFn({ data: { songId: song.id } });
      await update(song.id, {
        stems: undefined,
        instrumentalUrl: undefined,
        extractionStatus: "none",
      });
    } catch (e: any) {
      alert(e?.message || "Failed to delete stems");
    } finally {
      setBusy(null);
    }
  };

  const onExtract = async () => {
    if (!song.audioUrl) {
      alert("This track is missing its source audio. Generate or regenerate it first.");
      return;
    }
    setBusy("extract");
    try {
      await update(song.id, { extractionStatus: "processing" });
      const startRes: any = await startFn({ data: { audioUrl: song.audioUrl, songId: song.id } });
      let attempts = 0;
      while (attempts < 120) {
        await new Promise((r) => setTimeout(r, 4000));
        const check: any = await pollFn({
          data: { predictionId: startRes.predictionId, songId: song.id, isDemo: startRes.isDemo },
        });
        if (check?.status === "completed") {
          await update(song.id, {
            stems: check.stems,
            instrumentalUrl: check.instrumentalUrl,
            extractionStatus: "completed",
          });
          break;
        }
        if (check?.status === "failed") {
          await update(song.id, { extractionStatus: "failed" });
          throw new Error(check?.error || "Extraction failed");
        }
        attempts++;
      }
    } catch (e: any) {
      alert(e?.message || "Failed to extract stems");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasStems ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy !== null}
          className="rounded-sm border border-border px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:border-destructive hover:text-destructive transition disabled:opacity-50"
        >
          {busy === "delete" ? "deleting…" : "✕ delete stems"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onExtract}
          disabled={busy !== null || song.extractionStatus === "processing"}
          className="rounded-sm border border-dashed border-primary/40 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-primary hover:bg-primary/10 transition disabled:opacity-50"
        >
          {busy === "extract" || song.extractionStatus === "processing"
            ? "extracting…"
            : "✨ extract (2cr)"}
        </button>
      )}
    </div>
  );
}

function AvailableCard({ song, update }: { song: Song; update: UpdateFn }) {
  return (
    <div className="group rounded-sm border border-border bg-card p-4 flex flex-col gap-3 hover:border-primary transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          to="/song/$id"
          params={{ id: song.id }}
          className="flex items-center gap-3 min-w-0 flex-1"
        >
          <div
            className="h-10 w-10 shrink-0 rounded-sm bg-cover bg-center"
            style={{
              background: song.imageUrl
                ? `url(${song.imageUrl}) center/cover no-repeat`
                : song.cover,
            }}
          />
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-medium group-hover:text-primary">
              {song.title}
            </p>
            <p className="font-mono text-[9px] text-muted-foreground">{song.style}</p>
          </div>
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StemActions song={song} update={update} hasStems={false} />
        <Link
          to="/daw/$id"
          params={{ id: song.id }}
          className="rounded-sm border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-primary hover:bg-primary/10 transition-all"
        >
          🎛️ DAW
        </Link>
      </div>
    </div>
  );
}

function StemCard({ song, update }: { song: Song; update: UpdateFn }) {
  const { voices, loading: voicesLoading } = useVoiceReferences();

  const stems = song.stems ?? {};

  const stemOrder = ["vocals", "drums", "bass", "other", "transformed_vocals"];
  const stemColors: Record<string, string> = {
    vocals: "text-pink-400",
    drums: "text-amber-400",
    bass: "text-blue-400",
    other: "text-emerald-400",
    transformed_vocals: "text-violet-400",
  };
  const stemWaveColors: Record<string, string> = {
    vocals: "#f472b6",
    drums: "#fbbf24",
    bass: "#60a5fa",
    other: "#34d399",
    transformed_vocals: "#a78bfa",
  };
  const stemLabels: Record<string, string> = {
    vocals: "vocals",
    drums: "drums",
    bass: "bass",
    other: "other",
    transformed_vocals: "🎙️ transformed vocals (rvc)",
  };

  const orderedStems = stemOrder
    .filter((name) => stems[name])
    .map((name) => ({ name, url: stems[name] }));

  // Add any extra stems not in the standard order
  Object.entries(stems).forEach(([name, url]) => {
    if (!stemOrder.includes(name)) orderedStems.push({ name, url });
  });

  return (
    <div className="rounded-sm border border-border bg-card p-6">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className="h-12 w-12 shrink-0 rounded-sm bg-cover bg-center"
            style={{
              background: song.imageUrl
                ? `url(${song.imageUrl}) center/cover no-repeat`
                : song.cover,
            }}
          />
          <div>
            <Link
              to="/song/$id"
              params={{ id: song.id }}
              className="font-display text-lg font-bold hover:text-primary"
            >
              {song.title}
            </Link>
            <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              {song.style} · {orderedStems.length} stems
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/stem-studio/$id"
            params={{ id: song.id }}
            className="rounded-sm border border-primary/30 bg-primary/10 px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20 transition-all text-center"
          >
            📱 Stem Studio
          </Link>
          <Link
            to="/daw/$id"
            params={{ id: song.id }}
            className="rounded-sm border border-primary/20 bg-primary/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10 transition-all text-center"
          >
            🎛️ DAW Workspace
          </Link>
          <StemActions song={song} update={update} hasStems={true} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {orderedStems.map(({ name, url }) => (
          <div key={name} className="rounded-sm border border-border/50 bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <p
                className={`font-mono text-[9px] uppercase tracking-widest ${stemColors[name] || "text-muted-foreground"}`}
              >
                {stemLabels[name] || name}
              </p>
              {name === "vocals" && stems.vocals && !stems.transformed_vocals && (
                <VocalTransformAction
                  song={song}
                  vocalUrl={stems.vocals}
                  voices={voices}
                  voicesLoading={voicesLoading}
                  update={update}
                />
              )}
            </div>
            <WaveformPlayer src={url} color={stemWaveColors[name] || "hsl(var(--primary))"} />
          </div>
        ))}
      </div>
    </div>
  );
}

function VocalTransformAction({
  song,
  vocalUrl,
  voices,
  voicesLoading,
  update,
}: {
  song: Song;
  vocalUrl: string;
  voices: { id: string; name: string; audioUrl: string }[];
  voicesLoading: boolean;
  update: UpdateFn;
}) {
  const startFn = useServerFn(startVocalTransform);
  const pollFn = useServerFn(pollVocalTransform);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");

  const onTransform = async () => {
    const voice = voices.find((v) => v.id === selectedVoiceId);
    if (!voice) return;
    setBusy(true);
    try {
      const startRes: any = await startFn({
        data: {
          songId: song.id,
          vocalStemUrl: vocalUrl,
          voiceReferenceId: voice.id,
        },
      });

      // Poll for completion
      let attempts = 0;
      while (attempts < 120) {
        await new Promise((r) => setTimeout(r, 4000));
        const check: any = await pollFn({
          data: { predictionId: startRes.predictionId, songId: song.id },
        });
        if (check?.status === "completed") {
          // Refresh the stems in the parent
          const existingStems = song.stems || {};
          await update(song.id, {
            stems: { ...existingStems, transformed_vocals: check.transformedVocalsUrl },
          });
          setOpen(false);
          break;
        }
        if (check?.status === "failed") {
          throw new Error(check?.error || "Voice transformation failed");
        }
        attempts++;
      }
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("VOICE_TRAINING_STARTED")) {
        alert(
          `🎙️ Training "${voice.name}" voice model now (~10–20 min). Try again once it's ready.`,
        );
      } else if (msg.includes("VOICE_TRAINING_IN_PROGRESS")) {
        alert(`⏳ "${voice.name}" is still training. Try again in a few minutes.`);
      } else {
        alert(msg || "Voice transformation failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-sm border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 font-mono text-[8px] uppercase tracking-widest text-violet-400 hover:bg-violet-500/20 transition-all"
      >
        <Mic className="h-3 w-3" />
        Transform Voice (RVC)
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {voicesLoading ? (
        <span className="font-mono text-[8px] text-muted-foreground">Loading voices…</span>
      ) : voices.length === 0 ? (
        <span className="font-mono text-[8px] text-muted-foreground">
          No voice clones saved.{" "}
          <Link to="/studio/artists" className="text-primary underline">
            Create one
          </Link>
        </span>
      ) : (
        <>
          <select
            value={selectedVoiceId}
            onChange={(e) => setSelectedVoiceId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-[9px] text-foreground focus:border-violet-400 focus:outline-none"
          >
            <option value="">Select voice…</option>
            {voices.map((v: any) => {
              const isTraining =
                v.trainingStatus === "pending" ||
                v.trainingStatus === "training" ||
                v.trainingStatus === "preparing";
              return (
                <option
                  key={v.id}
                  value={v.id}
                  disabled={isTraining || v.trainingStatus === "failed"}
                >
                  {v.name} {isTraining ? "(Training...)" : ""}{" "}
                  {v.trainingStatus === "failed" ? "(Failed)" : ""}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={onTransform}
            disabled={busy || !selectedVoiceId}
            className="rounded-sm bg-violet-500 px-2.5 py-1 font-mono text-[8px] uppercase tracking-widest text-white hover:bg-violet-600 transition disabled:opacity-50"
          >
            {busy ? "Transforming…" : "Go"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setSelectedVoiceId("");
            }}
            className="font-mono text-[9px] text-muted-foreground hover:text-foreground transition"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}
