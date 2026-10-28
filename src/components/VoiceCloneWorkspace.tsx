import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Mic,
  Square,
  Play,
  Pause,
  Upload,
  FileAudio,
  RefreshCcw,
  Save,
  ChevronRight,
  ChevronLeft,
  Check,
  ShieldCheck,
} from "lucide-react";
import { db } from "@/lib/local-db";
import { useServerFn } from "@/lib/server-fn";
import { preprocessVoice } from "@/lib/voice.functions";
import { startRvcTraining } from "@/lib/replicate.functions";

interface VoiceCloneWorkspaceProps {
  userId: string;
  onVoiceAdded: (voiceId: string) => void;
  children: React.ReactNode;
}

/* ── Verification sentences the user must read aloud ── */
const VERIFICATION_SENTENCES = [
  "The quick brown fox jumps over the lazy dog near the riverbank.",
  "I am recording my voice to create a unique vocal profile today.",
  "Music brings people together across all borders and boundaries.",
  "Every artist has a story to tell through melody and rhythm.",
  "The sunrise paints the sky with shades of gold and amber light.",
  "Stars shimmer brightly above the quiet mountain village tonight.",
  "A gentle breeze carries the sound of laughter through the park.",
  "Technology and creativity unite to shape the future of music.",
];

function pickVerificationSentence() {
  return VERIFICATION_SENTENCES[Math.floor(Math.random() * VERIFICATION_SENTENCES.length)];
}

type Step = 1 | 2 | 3;

export function VoiceCloneWorkspace({ userId, onVoiceAdded, children }: VoiceCloneWorkspaceProps) {
  const prepVoice = useServerFn(preprocessVoice);
  const startTraining = useServerFn(startRvcTraining);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationSentence] = useState(pickVerificationSentence);

  // ── Per-step blobs ──
  const [primaryBlob, setPrimaryBlob] = useState<Blob | null>(null);
  const [secondaryBlob, setSecondaryBlob] = useState<Blob | null>(null);
  const [verificationBlob, setVerificationBlob] = useState<Blob | null>(null);

  // Upload mode (step 1 only)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // ── Recording state (shared across steps) ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    };
  }, []);

  const handleOpenChange = (newOpen: boolean) => {
    if (!uploading) {
      setOpen(newOpen);
      if (!newOpen) resetWorkspace();
    }
  };

  const resetWorkspace = () => {
    setPrimaryBlob(null);
    setSecondaryBlob(null);
    setVerificationBlob(null);
    setSelectedFile(null);
    setIsRecording(false);
    setRecordingDuration(0);
    setIsPlaying(false);
    setError(null);
    setStep(1);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Recording helpers ──
  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (step === 1) setPrimaryBlob(blob);
        else if (step === 2) setSecondaryBlob(blob);
        else setVerificationBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mr.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => {
          if (prev >= 120) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access is required to record your voice.");
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // Audio playback for current step's blob
  const currentBlob = step === 1 ? primaryBlob : step === 2 ? secondaryBlob : verificationBlob;

  useEffect(() => {
    if (currentBlob && audioRef.current) {
      const url = URL.createObjectURL(currentBlob);
      audioRef.current.src = url;
      audioRef.current.onended = () => setIsPlaying(false);
      return () => URL.revokeObjectURL(url);
    }
  }, [currentBlob]);

  const togglePlayback = () => {
    if (!audioRef.current || !currentBlob) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const clearCurrentBlob = () => {
    if (step === 1) {
      setPrimaryBlob(null);
      setSelectedFile(null);
    } else if (step === 2) setSecondaryBlob(null);
    else setVerificationBlob(null);
    setRecordingDuration(0);
    setIsPlaying(false);
  };

  // ── File upload (step 1 only) ──
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError("File must be under 10 MB");
        return;
      }
      setSelectedFile(file);
      setPrimaryBlob(file);
      setError(null);
    }
  };

  // ── Navigation ──
  const canAdvance =
    step === 1
      ? !!(primaryBlob || selectedFile)
      : step === 2
        ? !!secondaryBlob
        : !!verificationBlob;

  // ── Save logic ──
  const uploadBlob = async (blob: Blob, label: string) => {
    const ext = blob.type.includes("wav")
      ? "wav"
      : blob.type.includes("mp4") || blob.type.includes("m4a")
        ? "m4a"
        : "webm";
    const path = `${userId}/${Math.random().toString(36).slice(2)}_${label}.${ext}`;
    const { error: err } = await db.storage.from("media").upload(path, blob);
    if (err) throw err;
    return db.storage.from("media").getPublicUrl(path).data.publicUrl;
  };

  const handleSave = async () => {
    const mainBlob = primaryBlob || selectedFile;
    if (!mainBlob || !secondaryBlob || !verificationBlob) return;
    setUploading(true);
    setError(null);
    try {
      const primaryUrl = await uploadBlob(mainBlob, "primary");
      await uploadBlob(secondaryBlob, "secondary");
      await uploadBlob(verificationBlob, "verification");

      const result = (await prepVoice({ data: { audioUrl: primaryUrl } })) as any;
      if (!result?.featureId) throw new Error("No featureId returned from voice processing");

      const name = selectedFile
        ? selectedFile.name.split(".")[0]
        : `Voice ${new Date().toLocaleTimeString()}`;
      const { data: voiceRef, error: dbError } = await db
        .from("voice_references")
        .insert({
          user_id: userId,
          name,
          audio_url: primaryUrl,
          feature_id: result.featureId,
          training_status: "pending",
        })
        .select()
        .single();
      if (dbError) throw dbError;

      // Start the RVC training pipeline in the background
      await startTraining({ data: { voiceRefId: voiceRef.id } }).catch((e) => console.error(e));

      onVoiceAdded(voiceRef.id);
      setOpen(false);
      resetWorkspace();
    } catch (err: any) {
      console.error("Save error:", err);
      setError("Failed to save voice. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  /* ── Shared recording UI ── */
  const renderRecordingPanel = (hint: string) => (
    <div className="flex flex-col items-center justify-center py-6 border border-dashed rounded-lg bg-secondary/20">
      {!currentBlob ? (
        <>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`h-20 w-20 rounded-full flex items-center justify-center transition-all ${
              isRecording
                ? "bg-red-500/20 text-red-500 hover:bg-red-500/30 animate-pulse"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            }`}
          >
            {isRecording ? <Square className="h-7 w-7" /> : <Mic className="h-9 w-9" />}
          </button>
          <p className="mt-3 font-mono text-lg">{fmt(recordingDuration)}</p>
          <p className="text-xs text-muted-foreground mt-1 text-center px-4">
            {isRecording ? "Recording…" : hint}
          </p>
        </>
      ) : (
        <div className="w-full px-6 flex flex-col items-center">
          <div className="w-full flex items-center gap-4 bg-background p-3 rounded-md border">
            <button
              onClick={togglePlayback}
              className="h-10 w-10 shrink-0 bg-primary/10 text-primary rounded-full flex items-center justify-center hover:bg-primary/20"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary/50 w-full opacity-50" />
            </div>
            <Check className="h-4 w-4 text-green-500" />
          </div>
          <button
            onClick={clearCurrentBlob}
            className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCcw className="h-3 w-3" /> Re-record
          </button>
        </div>
      )}
    </div>
  );

  /* ── Step indicator ── */
  const StepBar = () => (
    <div className="flex items-center gap-2 mb-5">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center gap-2 flex-1">
          <div
            className={`h-1.5 flex-1 rounded-full transition-colors ${step >= s ? "bg-primary" : "bg-secondary"}`}
          />
        </div>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg bg-background border-border">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest text-primary text-sm">
            Voice Cloning · Step {step} of 3
          </DialogTitle>
          <DialogDescription className="text-xs">
            {step === 1 &&
              "Provide a clean vocal sample — singing or speaking. Avoid background noise."}
            {step === 2 && "Record a second sample to improve clone accuracy."}
            {step === 3 && "Read the sentence below aloud to verify voice ownership."}
          </DialogDescription>
        </DialogHeader>

        <StepBar />

        {/* ── STEP 1: Primary sample ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => {
                  clearCurrentBlob();
                }}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition ${!selectedFile ? "bg-primary/10 text-primary border border-primary/30" : "bg-secondary/50 text-muted-foreground"}`}
              >
                <Mic className="inline h-3 w-3 mr-1" /> Record
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition ${selectedFile ? "bg-primary/10 text-primary border border-primary/30" : "bg-secondary/50 text-muted-foreground"}`}
              >
                <Upload className="inline h-3 w-3 mr-1" /> Upload
              </button>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                ref={fileInputRef}
                className="hidden"
              />
            </div>

            {selectedFile && !primaryBlob ? (
              <div className="flex flex-col items-center py-6 border border-dashed rounded-lg bg-secondary/20">
                <FileAudio className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              renderRecordingPanel("Click to record your primary vocal sample")
            )}
          </div>
        )}

        {/* ── STEP 2: Second recording ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
              <p className="text-xs text-primary font-medium">💡 Why a second recording?</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Two separate samples help the AI capture more nuances of your voice — tone, pitch,
                and timbre — for a higher-quality clone.
              </p>
            </div>
            {renderRecordingPanel("Record a second sample — try a different sentence or style")}
          </div>
        )}

        {/* ── STEP 3: Verification sentence ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-md p-4 text-center">
              <ShieldCheck className="h-5 w-5 text-yellow-500 mx-auto mb-2" />
              <p className="text-[10px] uppercase tracking-widest text-yellow-500/80 font-medium mb-2">
                Voice Ownership Verification
              </p>
              <p className="text-sm font-medium text-foreground leading-relaxed">
                "{verificationSentence}"
              </p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Read the sentence above clearly into your microphone.
              </p>
            </div>
            {renderRecordingPanel("Click to record the verification sentence")}
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive text-xs p-3 rounded-md">{error}</div>
        )}

        {/* ── Navigation buttons ── */}
        <div className="flex justify-between items-center mt-4">
          {step > 1 ? (
            <button
              onClick={() => {
                setStep((s) => (s - 1) as Step);
                setIsPlaying(false);
              }}
              className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" /> Back
            </button>
          ) : (
            <button
              onClick={() => setOpen(false)}
              disabled={uploading}
              className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button
              onClick={() => {
                setStep((s) => (s + 1) as Step);
                setIsPlaying(false);
                setRecordingDuration(0);
              }}
              disabled={!canAdvance}
              className="flex items-center gap-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={uploading || !canAdvance}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {uploading ? (
                "Processing…"
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save Voice
                </>
              )}
            </button>
          )}
        </div>
        <audio ref={audioRef} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
