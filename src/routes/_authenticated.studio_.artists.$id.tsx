import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/local-db";
import { SiteHeader } from "@/components/SiteHeader";
import { invoke } from "@/lib/bridge";
import { toast } from "sonner";
import {
  Sparkles,
  Lock,
  Unlock,
  Eye,
  Download,
  Image as ImageIcon,
  Shirt,
  Car,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Mic,
  Play,
  Upload,
  Trash2,
  X,
  Check,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/studio_/artists/$id")({
  component: ArtistWorkspace,
});

type PortfolioItem = {
  id: string;
  image_url: string;
  view_type: string;
  is_locked: boolean;
};

type GenerationItem = {
  id: string;
  image_url: string;
  prompt: string;
  created_at: string;
  reference_images?: any[];
};

function ArtistWorkspace() {
  const { id } = Route.useParams();
  const { user } = Route.useSearch() as any; // Safe cast
  const navigate = useNavigate();
  const [artist, setArtist] = useState<any>(null);
  const [voiceName, setVoiceName] = useState("None");
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [generations, setGenerations] = useState<GenerationItem[]>([]);
  const [loadingArtist, setLoadingArtist] = useState(true);

  // Generation status
  const [generatingPortfolio, setGeneratingPortfolio] = useState(false);
  const [portfolioSuccess, setPortfolioSuccess] = useState(false);
  const [generatingScene, setGeneratingScene] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);

  // References & Inputs
  const [scenePrompt, setScenePrompt] = useState("");
  const [clothesUrl, setClothesUrl] = useState("");
  const [carUrl, setCarUrl] = useState("");

  // Custom uploader overlay states
  const [showClothesInput, setShowClothesInput] = useState(false);
  const [showCarInput, setShowCarInput] = useState(false);

  // Upload and paste custom image URL states
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [activeUrlSlot, setActiveUrlSlot] = useState<string | null>(null);
  const [urlInputVal, setUrlInputVal] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchArtistDetails();
    fetchPortfolio();
    fetchGenerations();
  }, [id]);

  const fetchArtistDetails = async () => {
    setLoadingArtist(true);
    try {
      const { data, error } = await db.from("artists").select("*").eq("id", id).maybeSingle();

      if (error) throw error;
      setArtist(data);

      if (data?.voice_ref_id) {
        const { data: voice } = await db
          .from("voice_references")
          .select("name")
          .eq("id", data.voice_ref_id)
          .maybeSingle();
        if (voice) setVoiceName(voice.name);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingArtist(false);
    }
  };

  const fetchPortfolio = async () => {
    try {
      const { data, error } = await db
        .from("artist_portfolio")
        .select("*")
        .eq("artist_id", id)
        .order("view_type", { ascending: true });
      if (!error && data) setPortfolio(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchGenerations = async () => {
    try {
      const { data, error } = await db
        .from("artist_generations")
        .select("*")
        .eq("artist_id", id)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setGenerations(
          data.map((item: any) => ({
            id: item.id,
            image_url: item.image_url,
            prompt: item.prompt,
            created_at: item.created_at,
            reference_images:
              typeof item.reference_images === "string"
                ? JSON.parse(item.reference_images)
                : item.reference_images,
          })),
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Generate 360 portfolio in parallel
  const handleGeneratePortfolio = async () => {
    if (!artist || generatingPortfolio) return;
    setGeneratingPortfolio(true);
    setPortfolioSuccess(false);

    try {
      await invoke("artists:portfolio", {
        artistId: id,
        basePrompt: artist.description || artist.name,
      });

      await fetchPortfolio();
      setPortfolioSuccess(true);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Portfolio generation failed");
    } finally {
      setGeneratingPortfolio(false);
    }
  };

  // Toggle lock state on database for a specific view
  const handleToggleLock = async (itemId: string, currentLock: boolean) => {
    try {
      const { error } = await db
        .from("artist_portfolio")
        .update({ is_locked: !currentLock })
        .eq("id", itemId);

      if (error) throw error;
      setPortfolio((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, is_locked: !currentLock } : item)),
      );
    } catch (e) {
      console.error(e);
    }
  };

  // Save a custom URL to the slot (used by both file upload and direct link paste)
  const handleSaveSlotUrl = async (viewType: string, url: string) => {
    if (!url.trim()) return;

    try {
      const existing = portfolio.find((p) => p.view_type === viewType);
      if (existing) {
        const { error } = await db
          .from("artist_portfolio")
          .update({ image_url: url, is_locked: true })
          .eq("id", existing.id);

        if (error) throw error;
        setPortfolio((prev) =>
          prev.map((item) =>
            item.id === existing.id ? { ...item, image_url: url, is_locked: true } : item,
          ),
        );
      } else {
        const { data, error } = await db
          .from("artist_portfolio")
          .insert({
            artist_id: id,
            image_url: url,
            view_type: viewType,
            is_locked: true,
          })
          .select()
          .single();

        if (error) throw error;
        setPortfolio((prev) => [...prev, data]);
      }

      setActiveUrlSlot(null);
      setUrlInputVal("");
      setFileError(null);
    } catch (e) {
      console.error("Save slot URL error:", e);
      setFileError("Failed to save image URL to database.");
    }
  };

  // Upload file from slot input
  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>, viewType: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setFileError("File size must be under 10MB");
      return;
    }

    setUploadingSlot(viewType);
    setFileError(null);

    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `artists/${id}/${viewType}_${Math.random()}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await db.storage
        .from("media")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = db.storage.from("media").getPublicUrl(filePath);

      await handleSaveSlotUrl(viewType, publicUrl);
    } catch (err: any) {
      console.error("Upload error:", err);
      setFileError(`Upload failed: ${err?.message ?? err}`);
    } finally {
      setUploadingSlot(null);
    }
  };

  // Clear/delete a custom portfolio slot
  const handleClearSlot = async (itemId: string) => {
    try {
      const { error } = await db.from("artist_portfolio").delete().eq("id", itemId);

      if (error) throw error;
      setPortfolio((prev) => prev.filter((item) => item.id !== itemId));
    } catch (e) {
      console.error("Clear slot error:", e);
    }
  };

  // Create consistent character photo
  const handleGenerateScene = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scenePrompt.trim() || generatingScene) return;
    setGeneratingScene(true);
    setSceneError(null);

    try {
      await invoke("artists:scene", {
        artistId: id,
        prompt: scenePrompt.trim(),
        clothesUrl: clothesUrl || undefined,
        carUrl: carUrl || undefined,
      });

      setScenePrompt("");
      await fetchGenerations();
    } catch (err: any) {
      setSceneError(err.message || "Failed to render character scene");
    } finally {
      setGeneratingScene(false);
    }
  };

  if (loadingArtist) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center font-mono text-xs uppercase tracking-widest">
          Loading Workspace...
        </div>
      </div>
    );
  }

  const faceShot = portfolio.find((p) => p.view_type === "face_shot");
  const sideProfile = portfolio.find((p) => p.view_type === "side_profile");
  const fullBody = portfolio.find((p) => p.view_type === "full_body");
  const actionShot = portfolio.find((p) => p.view_type === "action_shot");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-10">
        {/* Back button & stage title */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate({ to: "/studio/artists" })}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card hover:border-primary text-muted-foreground hover:text-primary transition"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.3em] bg-yellow-400/10 text-yellow-400 px-3 py-1 rounded-full border border-yellow-400/20">
                ★ Developer Studio Active
              </span>
              <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-primary">
                <Mic size={10} /> {voiceName}
              </span>
            </div>
            <h1 className="font-display text-4xl font-black mt-2">
              {artist?.name}{" "}
              <span className="italic font-light text-muted-foreground">Workspace</span>
            </h1>
          </div>
        </div>

        {/* Studio grid splits */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* LEFT COLUMN (4/12): Artist 360° Portfolio & Details */}
          <div className="lg:col-span-4 space-y-6">
            <div className="rounded-sm border border-border bg-card p-6 space-y-6 shadow-md">
              <div>
                <h3 className="font-display text-xl font-bold border-b border-border/50 pb-3">
                  Artist Visual DNA
                </h3>
                <p className="font-mono text-xs text-muted-foreground mt-3 leading-relaxed">
                  {artist?.description}
                </p>
              </div>

              {/* 360 Portfolio Grid */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    360° Visual Portfolio
                  </h4>
                  {portfolio.length > 0 && (
                    <button
                      onClick={handleGeneratePortfolio}
                      disabled={generatingPortfolio}
                      className="font-mono text-[9px] uppercase tracking-widest text-primary hover:underline flex items-center gap-1 animate-pulse"
                    >
                      <RefreshCw size={10} className={generatingPortfolio ? "animate-spin" : ""} />{" "}
                      AI Re-Gen
                    </button>
                  )}
                </div>

                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    if (activeUrlSlot) {
                      handleUploadFile(e, activeUrlSlot);
                    }
                  }}
                />

                {fileError && (
                  <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-red-400 font-mono text-[10px] flex items-center gap-2">
                    <AlertTriangle size={12} /> {fileError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "face_shot", label: "Face headshot", item: faceShot },
                    { key: "side_profile", label: "Side profile", item: sideProfile },
                    { key: "full_body", label: "Full body", item: fullBody },
                    { key: "action_shot", label: "Action pose", item: actionShot },
                  ].map((slot) => (
                    <div
                      key={slot.key}
                      className="relative aspect-square border border-border/50 bg-background rounded-sm overflow-hidden group"
                    >
                      {slot.item ? (
                        <>
                          <img
                            src={slot.item.image_url}
                            alt={slot.label}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition flex flex-col justify-between p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground font-bold">
                                {slot.label}
                              </span>
                              <button
                                onClick={() => handleClearSlot(slot.item!.id)}
                                className="p-1 rounded-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 transition"
                                title="Clear slot"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                            <button
                              onClick={() => handleToggleLock(slot.item!.id, slot.item!.is_locked)}
                              className={`w-full py-1.5 rounded-sm font-mono text-[8px] uppercase tracking-widest font-bold flex items-center justify-center gap-1 ${
                                slot.item.is_locked
                                  ? "bg-yellow-400 text-black"
                                  : "bg-white/10 hover:bg-white/20 text-white"
                              }`}
                            >
                              {slot.item.is_locked ? (
                                <>
                                  <Lock size={8} /> LOCKED
                                </>
                              ) : (
                                <>
                                  <Unlock size={8} /> LOCK FACE
                                </>
                              )}
                            </button>
                          </div>
                          {slot.item.is_locked && (
                            <div className="absolute top-2 right-2 bg-yellow-400 text-black p-1 rounded-full shadow-lg">
                              <Lock size={10} />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="h-full w-full flex flex-col items-center justify-center p-3 text-center border border-dashed border-border/50 bg-card/10 group-hover:border-primary/40 transition">
                          {uploadingSlot === slot.key ? (
                            <div className="space-y-1.5 flex flex-col items-center">
                              <RefreshCw size={14} className="animate-spin text-primary" />
                              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground">
                                Uploading...
                              </span>
                            </div>
                          ) : activeUrlSlot === slot.key ? (
                            <div className="w-full flex flex-col p-1">
                              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground mb-1.5">
                                Paste URL:
                              </span>
                              <input
                                type="text"
                                placeholder="Paste image https://..."
                                value={urlInputVal}
                                onChange={(e) => setUrlInputVal(e.target.value)}
                                className="w-full rounded-sm border border-border bg-background p-1 font-mono text-[8px] text-foreground focus:outline-none mb-1.5"
                                autoFocus
                              />
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => handleSaveSlotUrl(slot.key, urlInputVal)}
                                  className="flex-1 py-1 rounded-sm bg-primary text-primary-foreground font-mono text-[8px] font-bold uppercase tracking-widest flex items-center justify-center gap-0.5"
                                >
                                  <Check size={8} /> OK
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveUrlSlot(null);
                                    setUrlInputVal("");
                                  }}
                                  className="px-1.5 py-1 rounded-sm bg-white/10 hover:bg-white/20 text-white font-mono text-[8px]"
                                >
                                  <X size={8} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center">
                              <ImageIcon className="h-5 w-5 text-muted-foreground/30 mb-2 group-hover:text-primary transition" />
                              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground mb-2.5 font-bold">
                                {slot.label}
                              </span>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => {
                                    setActiveUrlSlot(slot.key);
                                    setTimeout(() => fileInputRef.current?.click(), 50);
                                  }}
                                  className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white border border-border rounded-sm font-mono text-[7px] uppercase tracking-widest flex items-center gap-0.5"
                                >
                                  <Upload size={8} /> File
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveUrlSlot(slot.key);
                                    setUrlInputVal("");
                                  }}
                                  className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white border border-border rounded-sm font-mono text-[7px] uppercase tracking-widest"
                                >
                                  Link
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* AI Auto-generate portfolio box shown below if any slot is missing */}
                {portfolio.length < 4 && (
                  <div className="border border-dashed border-border/80 rounded-sm p-4 bg-card/20 space-y-3 mt-2">
                    <div className="space-y-1">
                      <p className="font-display text-xs font-bold flex items-center gap-1.5 text-yellow-400">
                        <Sparkles size={12} /> AI 360° Auto-Shoot
                      </p>
                      <p className="text-[9px] text-muted-foreground leading-normal">
                        Let the AI create close-ups and full-body model photos automatically.
                      </p>
                    </div>
                    <button
                      onClick={handleGeneratePortfolio}
                      disabled={generatingPortfolio}
                      className="w-full rounded-sm bg-primary py-2.5 font-mono text-[9px] font-bold uppercase tracking-widest text-primary-foreground flex items-center justify-center gap-2 shadow"
                    >
                      {generatingPortfolio ? (
                        <>
                          <RefreshCw size={10} className="animate-spin" /> Rendering AI Portfolio...
                        </>
                      ) : (
                        "Auto-Generate AI Portfolio"
                      )}
                    </button>
                  </div>
                )}

                {portfolioSuccess && (
                  <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 text-emerald-400 font-mono text-[10px]">
                    <CheckCircle2 size={14} /> 360 portfolio generated successfully! Lock your
                    favorite face shot.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MIDDLE COLUMN (5/12): Main Playground & Scene Renderer */}
          <div className="lg:col-span-5 space-y-6">
            {/* Playmaker Card */}
            <div className="rounded-sm border border-border bg-card p-6 space-y-6 shadow-md">
              <div>
                <h3 className="font-display text-xl font-bold flex items-center gap-2">
                  <Sparkles className="text-yellow-400" /> Render Character Scene
                </h3>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                  Flux Consistent Character Synthesizer
                </p>
              </div>

              <form onSubmit={handleGenerateScene} className="space-y-4">
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Scene Setting & Action Prompt
                  </label>
                  <textarea
                    required
                    value={scenePrompt}
                    onChange={(e) => setScenePrompt(e.target.value)}
                    placeholder="e.g. standing in front of a neon-lit cyberpunk noodle shop at midnight, holding an energy drink, cool confident expression..."
                    rows={4}
                    className="w-full rounded-sm border border-border bg-background p-4 font-mono text-xs text-foreground focus:border-primary focus:outline-none resize-none"
                    disabled={generatingScene}
                  />
                </div>

                {sceneError && (
                  <div className="rounded-sm border border-destructive bg-destructive/10 p-3 font-mono text-xs text-destructive-foreground">
                    {sceneError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={generatingScene || !scenePrompt.trim()}
                  className="w-full rounded-sm bg-primary py-4 font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground hover:opacity-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
                >
                  {generatingScene ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" /> Rendering Consistent
                      Character Photo...
                    </>
                  ) : (
                    "Render Consistent Photo"
                  )}
                </button>
              </form>
            </div>

            {/* Showcase Grid of renders */}
            <div className="space-y-4">
              <h3 className="font-display text-lg font-bold border-b border-border/30 pb-2">
                Studio Generation Reel
              </h3>

              {generations.length === 0 ? (
                <div className="border border-dashed border-border rounded-sm p-12 text-center text-muted-foreground text-xs font-mono">
                  No scenes rendered for this character yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {generations.map((gen) => (
                    <div
                      key={gen.id}
                      className="relative aspect-square border border-border bg-card rounded-sm overflow-hidden group"
                    >
                      <img
                        src={gen.image_url}
                        alt={gen.prompt}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 transition flex flex-col justify-between p-4">
                        <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground line-clamp-3">
                          {gen.prompt}
                        </p>
                        <div className="flex items-center gap-2">
                          <a
                            href={gen.image_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 py-2 rounded-sm bg-white/10 hover:bg-white/20 text-white font-mono text-[9px] uppercase tracking-widest text-center"
                          >
                            Open Link
                          </a>
                          <button
                            onClick={() => window.open(gen.image_url, "_blank")}
                            className="p-2 rounded-sm bg-primary text-primary-foreground"
                          >
                            <Download size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN (3/12): Reference Canvas & styling */}
          <div className="lg:col-span-3 space-y-6">
            <div className="rounded-sm border border-border bg-card p-6 space-y-6 shadow-md">
              <div>
                <h3 className="font-display text-lg font-bold">Reference Canvas</h3>
                <p className="font-mono text-[9px] uppercase tracking-widest text-yellow-400 mt-1">
                  Inject style, clothes, and assets
                </p>
              </div>

              {/* Clothes Slot */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Shirt size={12} className="text-primary" /> Outfit Styling
                  </span>
                  {clothesUrl && (
                    <button
                      onClick={() => setClothesUrl("")}
                      className="font-mono text-[8px] uppercase text-destructive tracking-widest hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {clothesUrl ? (
                  <div className="relative aspect-square w-full rounded-sm overflow-hidden border border-border/50 bg-background">
                    <img src={clothesUrl} alt="Outfit ref" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="border border-dashed border-border/80 rounded-sm p-4 text-center bg-card/10 space-y-2">
                    <p className="font-mono text-[9px] text-muted-foreground leading-snug">
                      Lock custom clothing styles, colors, or visual presets.
                    </p>
                    <button
                      onClick={() => setShowClothesInput(!showClothesInput)}
                      className="w-full py-2 rounded-sm bg-white/5 hover:bg-white/10 text-white font-mono text-[9px] uppercase tracking-widest border border-border"
                    >
                      Set Clothes URL
                    </button>

                    {showClothesInput && (
                      <input
                        type="text"
                        placeholder="Paste image https://..."
                        value={clothesUrl}
                        onChange={(e) => setClothesUrl(e.target.value)}
                        className="w-full rounded-sm border border-border bg-background p-2 font-mono text-[9px] text-foreground focus:outline-none"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Car Slot */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Car size={12} className="text-primary" /> Vehicles & Backgrounds
                  </span>
                  {carUrl && (
                    <button
                      onClick={() => setCarUrl("")}
                      className="font-mono text-[8px] uppercase text-destructive tracking-widest hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {carUrl ? (
                  <div className="relative aspect-square w-full rounded-sm overflow-hidden border border-border/50 bg-background">
                    <img src={carUrl} alt="Vehicle ref" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="border border-dashed border-border/80 rounded-sm p-4 text-center bg-card/10 space-y-2">
                    <p className="font-mono text-[9px] text-muted-foreground leading-snug">
                      Inject cars, cyber bikes, or aesthetic settings into character generation.
                    </p>
                    <button
                      onClick={() => setShowCarInput(!showCarInput)}
                      className="w-full py-2 rounded-sm bg-white/5 hover:bg-white/10 text-white font-mono text-[9px] uppercase tracking-widest border border-border"
                    >
                      Set Vehicle URL
                    </button>

                    {showCarInput && (
                      <input
                        type="text"
                        placeholder="Paste image https://..."
                        value={carUrl}
                        onChange={(e) => setCarUrl(e.target.value)}
                        className="w-full rounded-sm border border-border bg-background p-2 font-mono text-[9px] text-foreground focus:outline-none"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
