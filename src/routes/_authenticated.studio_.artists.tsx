import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { db } from "@/lib/local-db";
import { SiteHeader } from "@/components/SiteHeader";
import { Plus, User, Mic, ShieldAlert, Sparkles, Image, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/studio_/artists")({
  component: ArtistsDashboard,
});

type Artist = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  voice_ref_id?: string;
  voice_name?: string;
  thumbnail_url?: string;
};

function ArtistsDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [voices, setVoices] = useState<any[]>([]);

  // Form states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchArtists();
    fetchVoices();
  }, [user]);

  const fetchArtists = async () => {
    setLoading(true);
    try {
      const { data: artistsData, error: err } = await db
        .from("artists")
        .select(
          `
          id,
          name,
          description,
          created_at,
          voice_ref_id
        `,
        )
        .order("created_at", { ascending: false });

      if (err) throw err;

      // For each artist, fetch their thumbnail (locked face_shot or fallback face_shot) and voice name
      const enrichedArtists = await Promise.all(
        (artistsData || []).map(async (art: any) => {
          let thumbnail = "";
          let voiceName = "No Custom Voice";

          // Fetch locked thumbnail
          const { data: portRows } = await db
            .from("artist_portfolio")
            .select("image_url")
            .eq("artist_id", art.id)
            .eq("view_type", "face_shot")
            .order("is_locked", { ascending: false })
            .limit(1);

          if (portRows && portRows.length > 0) {
            thumbnail = portRows[0].image_url;
          }

          // Fetch voice name
          if (art.voice_ref_id) {
            const { data: voiceRow } = await db
              .from("voice_references")
              .select("name")
              .eq("id", art.voice_ref_id)
              .maybeSingle();
            if (voiceRow) voiceName = voiceRow.name;
          }

          return {
            id: art.id,
            name: art.name,
            description: art.description || "",
            created_at: art.created_at,
            voice_ref_id: art.voice_ref_id,
            voice_name: voiceName,
            thumbnail_url: thumbnail || undefined,
          };
        }),
      );

      setArtists(enrichedArtists);
    } catch (e: any) {
      console.error("Failed to fetch artists:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchVoices = async () => {
    try {
      const { data, error } = await db
        .from("voice_references")
        .select("id, name")
        .order("created_at", { ascending: false });
      if (data && !error) setVoices(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateArtist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !user?.id) return;
    setCreating(true);
    setError(null);

    try {
      const id = crypto.randomUUID();
      const { error: insErr } = await db.from("artists").insert({
        id,
        user_id: user.id,
        name: name.trim(),
        description: description.trim(),
        voice_ref_id: selectedVoiceId || null,
      });

      if (insErr) throw insErr;

      // Close modal and navigate to the newly created artist's workspace
      setShowCreateModal(false);
      setName("");
      setDescription("");
      setSelectedVoiceId("");
      navigate({ to: "/studio/artists/$id", params: { id } });
    } catch (e: any) {
      setError(e.message || "Failed to create artist");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <p className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-yellow-400">
              ★ AI ARTIST DEVELOPER DASHBOARD
            </p>
            <h1 className="font-display text-5xl font-black md:text-7xl">
              AI Artist <span className="italic text-primary">Studio</span>
            </h1>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground hover:opacity-95 transition"
          >
            <Plus size={16} /> Develop New Artist
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-64 rounded-sm border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : artists.length === 0 ? (
          <div className="border border-dashed border-border rounded-sm p-12 text-center bg-card/20 max-w-[600px] mx-auto">
            <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-display text-xl font-bold mb-2">No AI Artists Developed Yet</h3>
            <p className="font-mono text-xs text-muted-foreground mb-6">
              Develop a custom virtual persona, generate persistent 360 portfolio designs, and pair
              them with custom voice clones.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded-sm bg-primary px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground"
            >
              Start Developing →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {artists.map((art) => (
              <Link
                key={art.id}
                to="/studio/artists/$id"
                params={{ id: art.id }}
                className="group relative flex flex-col justify-between overflow-hidden rounded-sm border border-border bg-card p-6 transition-all hover:border-primary hover:shadow-xl"
              >
                <div className="space-y-4">
                  {/* Thumbnail display */}
                  <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-background border border-border/50">
                    {art.thumbnail_url ? (
                      <img
                        src={art.thumbnail_url}
                        alt={art.name}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground p-4 text-center">
                        <Sparkles className="h-8 w-8 text-yellow-400 mb-2 animate-pulse" />
                        <span className="font-mono text-[10px] uppercase tracking-wider text-yellow-400">
                          Portfolio Pending
                        </span>
                        <span className="text-[9px] text-muted-foreground mt-1">
                          Generate 360 portfolio to activate
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="font-display text-2xl font-black group-hover:text-primary transition">
                      {art.name}
                    </h3>
                    <p className="line-clamp-2 font-mono text-xs text-muted-foreground mt-1">
                      {art.description || "No visual profile description added yet."}
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Mic size={10} className="text-primary" /> {art.voice_name}
                  </span>
                  <span>View Studio →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-[550px] rounded-sm border border-border bg-card p-8 shadow-2xl space-y-6">
            <div>
              <h2 className="font-display text-3xl font-black text-primary flex items-center gap-2">
                <Sparkles className="text-yellow-400" /> Develop AI Artist
              </h2>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mt-1">
                Define visual profile and matching voice
              </p>
            </div>

            <form onSubmit={handleCreateArtist} className="space-y-4">
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Artist Stage Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Lil Vibe, Aria Cyber"
                  className="w-full rounded-sm border border-border bg-background px-4 py-3 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Visual Profile & Description (Full 360 base)
                </label>
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. 21-year old female singer, neon pink short hair, cyberpunk styling, high fashion outfits..."
                  rows={4}
                  className="w-full rounded-sm border border-border bg-background p-4 font-mono text-xs text-foreground focus:border-primary focus:outline-none resize-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                  <span>Voice Identity Partner</span>
                  <Link
                    to="/library"
                    className="text-[9px] text-primary underline hover:opacity-85"
                  >
                    + Clone a Voice
                  </Link>
                </label>
                <select
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  className="w-full rounded-sm border border-border bg-background px-4 py-3 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="">Select a Cloned Voice (Optional)</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="rounded-sm border border-destructive bg-destructive/10 p-3 font-mono text-xs text-destructive-foreground">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-sm border border-border px-5 py-3 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:bg-card"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-sm bg-primary px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground hover:opacity-95 disabled:opacity-50"
                >
                  {creating ? "Developing..." : "Launch Artist Studio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
