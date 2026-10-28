import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@/lib/server-fn";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { EngineSelect } from "@/components/EngineSelect";
import { generateSong } from "@/lib/songs.functions";
import { generateCoverArt } from "@/lib/images.functions";
import { useSongs } from "@/hooks/useSongs";
import {
  useEngines,
  pickDefaultEngine,
  rememberEngine,
  wantsCompactLyrics,
} from "@/hooks/useEngines";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/studio")({
  validateSearch: z.object({
    prompt: z.string().optional(),
  }),
  component: Studio,
});

const SPARK_POOL = [
  "rainy night drive through neon tokyo",
  "country song about a haunted refrigerator",
  "bedroom pop, summer crush, slightly embarrassed",
  "angry techno for doing the dishes",
  "lullaby sung by a tired robot",
  "trap anthem about losing your airpods",
  "sad disco at 4am in a 24hr diner",
  "punk rock about your landlord",
  "afrobeats picnic in the park",
  "lo-fi study session on mars",
  "drill track about middle school drama",
  "jazz lounge breakup over cold pasta",
  "reggaeton for grocery shopping",
  "synthwave montage of doing laundry",
  "gospel choir about winning the lottery",
  "ambient soundtrack for sleeping cats",
  "indie folk about ghosting your therapist",
  "phonk for a midnight gym session",
  "dancehall summer block party",
  "emo anthem about loving pizza too much",
  "house track for sunrise on a rooftop",
  "boom bap about your grandma's cooking",
  "metal opera about doing taxes",
  "k-pop confession at a vending machine",
];

const VOCAL_TAG_POOL = [
  "Male Voice",
  "Female Voice",
  "Female Singer",
  "Male Rap Vocals",
  "Duet",
  "Rap",
  "Trap",
  "Country",
  "R&B",
  "Pop",
  "EDM",
  "Lo-Fi",
  "Synthwave",
  "Rock",
  "Acoustic",
  "Cinematic",
  "Dark & Moody",
  "Upbeat",
  "Chill",
  "Heavy Bass",
  "Electric Guitar",
  "Choir",
  "Acapella",
  "Comedy Parody",
  "Meme Rap",
  "Satire",
  "Diss Track",
  "Broadway Musical",
  "Pop Punk Anthem",
  "Drill",
  "Afrobeats",
  "Reggaeton",
  "House",
  "Techno",
  "Garage",
  "Hyperpop",
  "Phonk",
  "Dancehall",
  "Indie Folk",
  "Bedroom Pop",
  "Shoegaze",
  "Emo",
  "Punk",
  "Gospel",
  "Soul",
  "Funk",
  "Disco",
  "Jazz",
  "Bossa Nova",
  "Latin Pop",
  "K-Pop",
  "J-Pop",
  "Whisper Vocals",
  "Auto-Tune",
  "Harmonies",
  "Spoken Word",
  "Storytelling",
  "Heartbreak",
  "Romantic",
  "Nostalgic",
  "Anthemic",
  "Dreamy",
  "Aggressive",
  "Melancholic",
  "Euphoric",
  "Hypnotic",
  "Groovy",
];

const INSTRUMENTAL_TAG_POOL = [
  "Lil Baby Type Beat",
  "808s",
  "Heavy Drums",
  "Country Trap",
  "Type Beat",
  "Dark Trap",
  "Lo-Fi Beats",
  "Cinematic",
  "Detroit Trap",
  "Rage Beat",
  "Boom Bap",
  "Drill Beat",
  "Trap Soul",
  "Jersey Club",
  "Phonk",
  "Hyperpop",
  "Synthwave",
  "Vaporwave",
  "Ambient",
  "Drum & Bass",
  "Jungle",
  "UK Garage",
  "Deep House",
  "Tech House",
  "Big Room",
  "Future Bass",
  "Dubstep",
  "Riddim",
  "Orchestral",
  "Piano Ballad",
  "Acoustic Guitar",
  "Spanish Guitar",
  "Strings",
  "808 Bass",
  "Synth Lead",
  "Arpeggio",
  "Choppy Drums",
  "Hard Hitting",
  "Smooth",
  "Atmospheric",
  "Glitchy",
  "Distorted",
  "Reverb Heavy",
  "Tape Saturation",
  "Vinyl Crackle",
  "Lo-Fi Hip Hop",
  "Chillhop",
];

function pickRandom<T>(pool: T[], n: number, seed: number): T[] {
  const arr = pool.slice();
  let s = seed || 1;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

function Studio() {
  const generate = useServerFn(generateSong);
  const genCover = useServerFn(generateCoverArt);

  const { save } = useSongs();
  const { engines, loading: enginesLoading } = useEngines();
  const [engineId, setEngineId] = useState<string | null>(null);
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/studio" });
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (search.prompt) {
      setPrompt(search.prompt);
    }
  }, [search.prompt]);
  const [instrumental, setInstrumental] = useState(false);
  useEffect(() => {
    if (!engineId && engines.length) setEngineId(pickDefaultEngine(engines)?.id ?? null);
  }, [engines, engineId]);
  const selectedEngine = engines.find((e) => e.id === engineId);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 100000) + 1);

  const sparkSuggestions = useMemo(() => pickRandom(SPARK_POOL, 5, shuffleSeed), [shuffleSeed]);
  const tagSuggestions = useMemo(
    () => pickRandom(instrumental ? INSTRUMENTAL_TAG_POOL : VOCAL_TAG_POOL, 18, shuffleSeed + 1),
    [shuffleSeed, instrumental],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setProgress(0);
    setError(null);

    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? prev : prev + 5));
    }, 300);

    try {
      // 1. Generate Metadata
      const result = await generate({
        data: {
          prompt: prompt.trim(),
          instrumental: instrumental || (selectedEngine ? !selectedEngine.supportsLyrics : false),
          compact: wantsCompactLyrics(engineId),
        },
      });
      if (result.usedFallback) {
        toast("Using a built-in lyric template", {
          description: "Connect a lyrics model (e.g. Ollama) in Settings for original lyrics.",
        });
      }

      // 2. Generate Cover Art
      let imageUrl: string | undefined;
      try {
        const coverRes = await genCover({ data: { prompt: result.title, style: result.style } });
        imageUrl = coverRes.imageUrl;
      } catch (err) {
        console.warn("Cover art generation failed:", err);
      }

      setProgress(100);

      // 3. Save to the local library
      const saved = await save({
        title: result.title,
        style: result.style,
        lyrics: result.lyrics,
        prompt: prompt.trim(),
        imageUrl,
      });

      if (engineId) rememberEngine(engineId);
      setShuffleSeed((s) => s + Math.floor(Math.random() * 1000) + 1);
      navigate({
        to: "/song/$id",
        params: { id: saved.id },
        search: { engine: engineId ?? undefined },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something broke. Try again.";
      setError(msg.includes("429") ? "Too many requests — slow down a sec." : msg);
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] px-6 py-16">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
          ◐ the studio
        </p>
        <h1 className="mb-12 font-display text-6xl font-black md:text-8xl">
          What's the <span className="italic text-primary">vibe</span>?
        </h1>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="a melancholy waltz about losing your keys at a wedding…"
              rows={4}
              maxLength={500}
              className="w-full resize-none rounded-sm border-2 border-border bg-card p-6 font-display text-3xl italic placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
              disabled={loading}
            />
            <div className="absolute bottom-3 right-4 font-mono text-xs text-muted-foreground">
              {prompt.length}/500
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex cursor-pointer items-center gap-3 font-mono text-xs uppercase tracking-widest">
                <input
                  type="checkbox"
                  checked={instrumental}
                  onChange={(e) => setInstrumental(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                instrumental only
              </label>

              <div className="flex min-w-[280px] items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  engine:
                </span>
                <div className="flex-1">
                  <EngineSelect
                    engines={engines}
                    loading={enginesLoading}
                    value={engineId}
                    onChange={setEngineId}
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              {loading && (
                <div className="w-full max-w-[200px]">
                  <div className="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    <span>Composing…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-[2px] w-full overflow-hidden bg-secondary">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={loading || !prompt.trim()}
                className="group inline-flex items-center gap-3 rounded-sm bg-primary px-8 py-4 font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground transition disabled:opacity-40"
              >
                {loading ? (
                  <>
                    <span className="flex h-4 items-end gap-[2px]">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className="w-[3px] origin-bottom bg-primary-foreground pulse-bar"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </span>
                    composing…
                  </>
                ) : (
                  <>
                    generate song <span className="transition group-hover:translate-x-1">→</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-sm border border-destructive bg-destructive/10 p-4 font-mono text-sm text-destructive-foreground">
              {error}
            </div>
          )}
        </form>

        <div className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              add flavor tags
            </p>
            <button
              type="button"
              onClick={() => setShuffleSeed((s) => s + Math.floor(Math.random() * 1000) + 1)}
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
            >
              ↻ shuffle
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {tagSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setPrompt((prev) => (prev ? `${prev}, ${tag}` : tag));
                }}
                disabled={loading}
                className="rounded-full border border-border bg-card/50 px-3 py-1 font-mono text-[9px] uppercase tracking-wider hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
              >
                + {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              need a spark?
            </p>
            <button
              type="button"
              onClick={() => setShuffleSeed((s) => s + Math.floor(Math.random() * 1000) + 1)}
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
            >
              ↻ new ideas
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sparkSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPrompt(s)}
                disabled={loading}
                className="rounded-sm border border-border px-4 py-2 font-mono text-xs hover:border-primary hover:text-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
