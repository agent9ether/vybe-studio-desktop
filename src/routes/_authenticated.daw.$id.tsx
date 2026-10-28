/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { useSongs } from "@/hooks/useSongs";
import { useVoiceReferences } from "@/hooks/useVoiceReferences";
import {
  startStemExtraction,
  pollStemExtraction,
  clearStems,
  startVocalTransform,
  pollVocalTransform,
} from "@/lib/replicate.functions";
import { useServerFn } from "@/lib/server-fn";
import { TrackEffectsPanel } from "@/components/daw/TrackEffectsPanel";
import { EffectConfig, EffectChain } from "@/lib/audio-engine";
import {
  Play,
  Pause,
  Square,
  Volume2,
  Music,
  Scissors,
  Download,
  Sparkles,
  Sliders,
  Disc,
  Key,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Cpu,
  Mic,
  MousePointer2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/daw/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `DAW Workspace — Vybe Studio` },
      {
        name: "description",
        content: "Interactive multitrack stem editor and DAW for Vybe creators.",
      },
    ],
  }),
  component: DAWPage,
});

// Helper for WAV audio encoding
function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // RIFF identifier
  setUint32(0x46464952);
  // file length
  setUint32(length - 8);
  // RIFF type
  setUint32(0x45564157);
  // format chunk identifier
  setUint32(0x20746d66);
  // format chunk length
  setUint32(16);
  // sample format (raw)
  setUint16(1);
  // channel count
  setUint16(numOfChan);
  // sample rate
  setUint32(buffer.sampleRate);
  // byte rate (sample rate * block align)
  setUint32(buffer.sampleRate * 2 * numOfChan);
  // block align (channel count * bytes per sample)
  setUint16(numOfChan * 2);
  // bits per sample
  setUint16(16);
  // data chunk identifier
  setUint32(0x61746164);
  // data chunk length
  setUint32(length - pos - 4);

  for (i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([bufferArray], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

// Preset High-Quality Demo Stems
const DEMO_STEMS = {
  vocals:
    "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/Vocals30.mp3", // Vocals
  drums:
    "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/BassDrums30.mp3", // Drums
  bass: "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/BassDrums30.mp3", // Bass
  other:
    "https://raw.githubusercontent.com/naomiaro/waveform-playlist/gh-pages/media/audio/Guitar30.mp3", // Synth/Melody
};

export interface Clip {
  id: string;
  audioBuffer: AudioBuffer;
  startOffset: number;
  trimStart?: number;
  trimEnd?: number;
  duration?: number;
  fadeIn?: number;
  fadeOut?: number;
}

interface TrackChannel {
  name: string;
  key: string;
  url: string;
  color: string;
  glow: string;
  effects: EffectConfig[];
  volume: number; // dB (-40 to 6)
  pan: number; // -1 to 1
  mute: boolean;
  solo: boolean;
  isArmed?: boolean;
  eqLow: number; // dB (-12 to 12)
  eqMid: number; // dB (-12 to 12)
  eqHigh: number; // dB (-12 to 12)
  delayMix: number; // 0 to 1
  clips: Clip[];
  // Legacy single-clip fields kept optional for back-compat with playback /
  // waveform code that hasn't migrated to `clips[]` yet.
  audioBuffer?: AudioBuffer;
  startOffset?: number;
  trimStart?: number;
  trimEnd?: number;
}

function DAWPage() {
  const { id } = useParams({ from: "/_authenticated/daw/$id" });
  const navigate = useNavigate();
  const { songs, update, fetchFullSong, loading: songsLoading } = useSongs();
  // Authoritative full song state, populated by fetchFullSong.
  // Using a local copy avoids the songs-list re-fetch (which strips the
  // `stems` column) racing in and wiping our stems after we just loaded them.
  const [fullSong, setFullSong] = useState<(typeof songs)[number] | null>(null);
  const [fullSongFetched, setFullSongFetched] = useState(false);
  const listSong = songs.find((s) => s.id === id);
  // Prefer the locally-fetched full row (has stems); fall back to list row for title etc.
  const displaySong = fullSong ?? listSong;

  useEffect(() => {
    let cancelled = false;
    setFullSongFetched(false);
    setFullSong(null);
    if (id) {
      fetchFullSong(id)
        .then((s) => {
          if (!cancelled && s) setFullSong(s);
        })
        .finally(() => {
          if (!cancelled) setFullSongFetched(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [id, fetchFullSong]);

  // Poll for updates while extraction is processing or stems haven't arrived yet
  const pendingStems = fullSongFetched && !!id && displaySong?.extractionStatus === "processing";
  useEffect(() => {
    if (!pendingStems) return;
    const interval = setInterval(() => {
      fetchFullSong(id).then((s) => {
        if (s) setFullSong(s);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [pendingStems, id, fetchFullSong]);

  const startExtraction = useServerFn(startStemExtraction);
  const pollExtraction = useServerFn(pollStemExtraction);
  const startTransform = useServerFn(startVocalTransform);
  const pollTransform = useServerFn(pollVocalTransform);
  const { voices, loading: voicesLoading } = useVoiceReferences();
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [transformingVocal, setTransformingVocal] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");

  // DAW State
  const [channels, setChannels] = useState<TrackChannel[]>([
    {
      name: "Vocals",
      key: "vocals",
      url: "",
      color: "#ec4899",
      glow: "shadow-pink-500/20",
      volume: 0,
      pan: 0,
      mute: false,
      solo: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      delayMix: 0,
      effects: [],
      clips: [],
    },
    {
      name: "Drums",
      key: "drums",
      url: "",
      color: "#f59e0b",
      glow: "shadow-amber-500/20",
      volume: 0,
      pan: 0,
      mute: false,
      solo: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      delayMix: 0,
      effects: [],
      clips: [],
    },
    {
      name: "Sub Bass",
      key: "bass",
      url: "",
      color: "#3b82f6",
      glow: "shadow-blue-500/20",
      volume: 0,
      pan: 0,
      mute: false,
      solo: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      delayMix: 0,
      effects: [],
      clips: [],
    },
    {
      name: "Melody / Synth",
      key: "other",
      url: "",
      color: "#10b981",
      glow: "shadow-emerald-500/20",
      volume: 0,
      pan: 0,
      mute: false,
      solo: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      delayMix: 0,
      effects: [],
      clips: [],
    },
  ]);

  const [masterEffects, setMasterEffects] = useState<EffectConfig[]>([]);
  const [openMasterEffects, setOpenMasterEffects] = useState(false);
  const masterEffectChainRef = useRef<any>(null);

  const [openEffectsChannel, setOpenEffectsChannel] = useState<string | null>(null);

  const [toolMode, setToolMode] = useState<"pointer" | "scissors">("pointer");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStatus, setLoadStatus] = useState("Initializing DAW...");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [bpm, setBpm] = useState(124);
  const [keySig, setKeySig] = useState("D Minor");
  const [compressorEnabled, setCompressorEnabled] = useState(true);
  const [limiterEnabled, setLimiterEnabled] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [extractingStems, setExtractingStems] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);

  // Web Audio Context refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const masterGainRef = useRef<GainNode | null>(null);
  const masterAnalyserRef = useRef<AnalyserNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);

  // Track specific Node refs
  const trackNodesRef = useRef<
    Record<
      string,
      {
        sources: AudioBufferSourceNode[];
        gain: GainNode;
        panner: StereoPannerNode;
        eqLow: BiquadFilterNode;
        eqMid: BiquadFilterNode;
        eqHigh: BiquadFilterNode;
        delay: DelayNode;
        delayGain: GainNode;
        analyser: AnalyserNode;
        effectChain: import("@/lib/audio-engine").EffectChain;
      }
    >
  >({});

  // Timeline Refs
  const startOffsetTimeRef = useRef(0);
  const playStartedAtRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastStateUpdateRef = useRef(0);
  const waveformCanvasesRef = useRef<Record<string, HTMLCanvasElement | null>>({});

  // Check if song has stems
  const hasStems = displaySong?.stems && Object.keys(displaySong.stems).length > 0;

  const initTrackNode = (chKey: string) => {
    const ctx = audioCtxRef.current!;
    if (trackNodesRef.current[chKey]) return trackNodesRef.current[chKey];

    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(1.0, ctx.currentTime);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(0, ctx.currentTime);

    const eqLow = ctx.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.setValueAtTime(200, ctx.currentTime);
    eqLow.gain.setValueAtTime(0, ctx.currentTime);

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.Q.setValueAtTime(1.0, ctx.currentTime);
    eqMid.frequency.setValueAtTime(1000, ctx.currentTime);
    eqMid.gain.setValueAtTime(0, ctx.currentTime);

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = "highshelf";
    eqHigh.frequency.setValueAtTime(5000, ctx.currentTime);
    eqHigh.gain.setValueAtTime(0, ctx.currentTime);

    const delay = ctx.createDelay(1.0);
    delay.delayTime.setValueAtTime(0.33, ctx.currentTime);
    const delayGain = ctx.createGain();
    delayGain.gain.setValueAtTime(0.0, ctx.currentTime);

    const delayFeedback = ctx.createGain();
    delayFeedback.gain.setValueAtTime(0.4, ctx.currentTime);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    const effectChain = new EffectChain(ctx);

    // Route: Source -> EQ Low -> EQ Mid -> EQ High -> EffectChain -> Panner -> Gain -> Analyser -> Compressor (Master)
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(effectChain.inputNode);
    effectChain.outputNode.connect(panner);
    panner.connect(trackGain);
    trackGain.connect(analyser);
    analyser.connect(compressorRef.current!);

    // Delay Send Routing
    trackGain.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(delayFeedback);
    delayFeedback.connect(delay);
    delayGain.connect(compressorRef.current!);

    const nodes = {
      sources: [],
      gain: trackGain,
      panner,
      eqLow,
      eqMid,
      eqHigh,
      delay,
      delayGain,
      analyser,
      effectChain,
    };
    trackNodesRef.current[chKey] = nodes;
    return nodes;
  };

  // Initialize Web Audio Engine
  const initAudio = () => {
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    // Master FX Chain
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, ctx.currentTime);
    masterGainRef.current = masterGain;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, ctx.currentTime);
    compressor.knee.setValueAtTime(12, ctx.currentTime);
    compressor.ratio.setValueAtTime(4, ctx.currentTime);
    compressor.attack.setValueAtTime(0.015, ctx.currentTime);
    compressor.release.setValueAtTime(0.12, ctx.currentTime);
    compressorRef.current = compressor;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-1, ctx.currentTime);
    limiter.knee.setValueAtTime(0, ctx.currentTime);
    limiter.ratio.setValueAtTime(20, ctx.currentTime);
    limiterRef.current = limiter;

    const masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 1024;
    masterAnalyserRef.current = masterAnalyser;

    const masterEffectChain = new EffectChain(ctx);
    masterEffectChainRef.current = masterEffectChain;

    // Connect FX Chain
    compressor.connect(limiter);
    limiter.connect(masterEffectChain.inputNode);
    masterEffectChain.outputNode.connect(masterGain);
    masterGain.connect(masterAnalyser);
    masterAnalyser.connect(ctx.destination);
  };

  // Trigger Stem Separation Backend
  const handleStartStemsExtraction = async () => {
    if (!displaySong?.audioUrl) {
      alert(
        "⚠️ This track is missing its source audio file. Please generate or regenerate the audio before separating stems.",
      );
      return;
    }
    setExtractingStems(true);
    setExtractionProgress(10);

    // If it is a premium demo track, bypass backend calls and instantly populate pre-baked high-fidelity stems
    if (displaySong.title === "Neon Pulse" || displaySong.title === "Velvet Drift") {
      try {
        setExtractionProgress(50);
        await new Promise((r) => setTimeout(r, 1200)); // Glimpse premium separation effect
        setExtractionProgress(100);
        setExtractingStems(false);

        if (update) {
          await update(displaySong.id, {
            extractionStatus: "completed",
            stems: DEMO_STEMS,
          });
        }
        window.location.reload();
        return;
      } catch (err) {
        console.error("Mock separation failed:", err);
        setExtractingStems(false);
        alert("Demo stem separation failed.");
        return;
      }
    }

    let interval: any;
    try {
      if (update) {
        update(displaySong.id, { extractionStatus: "processing" });
      }

      interval = setInterval(() => {
        setExtractionProgress((prev) => Math.min(prev + 1, 98));
      }, 3000);

      const startRes = (await startExtraction({
        data: {
          audioUrl: displaySong.audioUrl,
          songId: displaySong.id,
        },
      })) as any;

      let done = false;
      let attempts = 0;
      let finalRes: any = null;

      while (!done && attempts < 120) {
        await new Promise((r) => setTimeout(r, 4000));
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

      clearInterval(interval);
      setExtractionProgress(100);
      setExtractingStems(false);

      if (!finalRes || !finalRes.instrumentalUrl) {
        throw new Error("Stem separation timed out or failed.");
      }

      if (update) {
        await update(displaySong.id, {
          instrumentalUrl: finalRes.instrumentalUrl,
          stems: finalRes.stems,
          extractionStatus: "completed",
        });
      }
      window.location.reload();
    } catch (err: any) {
      const msg = err?.message || "";
      if (interval) clearInterval(interval);
      setExtractingStems(false);
      setExtractionProgress(0);

      console.error("Stem extraction failed:", err);
      if (update) {
        await update(displaySong.id, {
          extractionStatus: "failed",
          stems: undefined,
          instrumentalUrl: undefined,
        });
      }
      alert("Stem extraction failed — please try again.");
    }
  };

  const clearStemsFn = useServerFn(clearStems);
  const handleClearStems = async () => {
    if (!displaySong) return;
    if (!confirm("Delete extracted stems? You can extract them again any time.")) return;
    try {
      await clearStemsFn({ data: { songId: displaySong.id } });
      if (update) {
        await update(displaySong.id, {
          extractionStatus: "none",
          stems: undefined,
          instrumentalUrl: undefined,
        });
      }
      window.location.reload();
    } catch (e: any) {
      alert(e?.message || "Failed to clear stems");
    }
  };

  const handleVoiceTransform = async () => {
    if (!displaySong || !displaySong.stems?.vocals) return;
    const voice = voices.find((v) => v.id === selectedVoiceId);
    if (!voice) {
      alert("Pick a cloned voice first.");
      return;
    }
    setTransformingVocal(true);
    try {
      const startRes: any = await startTransform({
        data: {
          songId: displaySong.id,
          vocalStemUrl: displaySong.stems.vocals,
          voiceReferenceId: voice.id,
        },
      });
      let attempts = 0;
      while (attempts < 120) {
        await new Promise((r) => setTimeout(r, 4000));
        const check: any = await pollTransform({
          data: { predictionId: startRes.predictionId, songId: displaySong.id },
        });
        if (check?.status === "completed") {
          const newStems = { ...(displaySong.stems || {}), vocals: check.transformedVocalsUrl };
          if (update) await update(displaySong.id, { stems: newStems });
          setVoicePickerOpen(false);
          alert(`✨ Vocal stem transformed with "${voice.name}". Reloading…`);
          window.location.reload();
          return;
        }
        if (check?.status === "failed") {
          throw new Error(check?.error || "Voice transformation failed");
        }
        attempts++;
      }
      throw new Error("Voice transformation timed out");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("VOICE_TRAINING_STARTED")) {
        alert(
          `🎙️ Training "${voice.name}" voice model now. This takes ~10–20 min. You'll be able to apply it once it's ready.`,
        );
      } else if (msg.includes("VOICE_TRAINING_IN_PROGRESS")) {
        alert(`⏳ "${voice.name}" is still training. Try again in a few minutes.`);
      } else {
        alert(msg || "Voice transformation failed.");
      }
    } finally {
      setTransformingVocal(false);
    }
  };

  // Load and decode stems
  const loadStems = async (stemsObj: Record<string, string>, name: string) => {
    setIsPlaying(false);
    setIsLoaded(false);
    setLoadProgress(5);
    initAudio();

    const ctx = audioCtxRef.current!;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const updatedChannels = [...channels];
    let loadedCount = 0;
    let totalDuration = 0;

    // Load each track buffer
    for (let i = 0; i < updatedChannels.length; i++) {
      const ch = updatedChannels[i];
      const stemUrl = stemsObj[ch.key];
      if (!stemUrl) continue;

      // Note: fresh replicate.delivery URLs are valid for ~1h. Don't pre-swap
      // them — only fall back on an actual fetch failure (below).

      try {
        setLoadStatus(`Loading ${ch.name} stem…`);
        setLoadProgress(15 + i * 20);

        let res: Response;
        try {
          res = await fetch(stemUrl);
          if (!res.ok) throw new Error(`Fetch returned status ${res.status}`);
        } catch (fetchErr: any) {
          throw new Error(`Could not load the ${ch.name} stem: ${fetchErr?.message ?? fetchErr}`);
        }

        const arrayBuffer = await res.arrayBuffer();

        setLoadStatus(`Decoding ${ch.name} audio data…`);
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        const newClipId = Math.random().toString(36).substring(2, 9);
        const newCh = { ...ch };
        newCh.url = stemUrl;
        newCh.clips = [
          {
            id: newClipId,
            audioBuffer,
            startOffset: 0,
            duration: audioBuffer.duration,
            fadeIn: 0,
            fadeOut: 0,
          },
        ];
        updatedChannels[i] = newCh;

        if (audioBuffer.duration > totalDuration) {
          totalDuration = audioBuffer.duration;
        }

        // Initialize Web Audio nodes for this track
        initTrackNode(newCh.key);

        loadedCount++;
        setTimeout(() => {
          renderWaveform(ch.key + "-" + newClipId, audioBuffer, ch.color);
        }, 100);
      } catch (err) {
        console.error(`Error loading stem ${ch.key}:`, err);
      }
    }

    setDuration(totalDuration);
    setChannels(updatedChannels);
    setIsLoaded(true);
    setLoadProgress(100);
    setLoadStatus("DAW Ready!");

    // Set mock BPM / Key
    setBpm(Math.round(110 + Math.random() * 30));
    const keys = [
      "C Major",
      "A Minor",
      "G Major",
      "E Minor",
      "F Major",
      "D Minor",
      "D Major",
      "B Minor",
    ];
    setKeySig(keys[Math.floor(Math.random() * keys.length)]);
  };

  // Render static waveform onto HTML5 Canvas
  const renderWaveform = (key: string, buffer: AudioBuffer, color: string) => {
    const canvas = waveformCanvasesRef.current[key];
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Use actual bounds or high-DPI resolution
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Set actual canvas drawing dimensions based on bounding rect and zoom
    const targetWidth = Math.max(800, Math.round(rect.width || 800)) * dpr;
    const targetHeight = Math.round(rect.height || 80) * dpr;

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const width = canvas.width;
    const height = canvas.height;
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw professional DAW timeline micro-grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
    ctx.lineWidth = 1 * dpr;
    const gridSpacing = 40 * dpr;
    for (let i = 0; i < width; i += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, height);
      ctx.stroke();
    }

    const data = buffer.getChannelData(0);
    // Draw modern slim rounded bars for a highly realistic and professional look
    const barWidth = 2.5 * dpr;
    const gap = 1.5 * dpr;
    const totalBarWidth = barWidth + gap;
    const barCount = Math.floor(width / totalBarWidth);
    const step = Math.floor(data.length / barCount);

    // Create a beautiful glowing linear gradient for the waveform peaks
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.5, "#ffffff");
    gradient.addColorStop(1, color);

    ctx.fillStyle = gradient;

    for (let i = 0; i < barCount; i++) {
      let maxVal = 0;
      const dataOffset = i * step;

      // Sample data in this step window
      for (let j = 0; j < step && dataOffset + j < data.length; j++) {
        const val = Math.abs(data[dataOffset + j]);
        if (val > maxVal) {
          maxVal = val;
        }
      }

      // Add a small threshold so silent parts have a tiny baseline line (like real DAWs)
      const magnitude = Math.max(0.04, maxVal) * amp * 0.85;
      const x = i * totalBarWidth;
      const y = amp - magnitude;
      const barHeight = magnitude * 2;

      // Draw rounded rectangle for the bar
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, barWidth, barHeight, 1 * dpr);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    }
  };

  // Redraw waveforms when zoom changes or when channels/buffers change
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      channels.forEach((ch) => {
        ch.clips.forEach((clip) => {
          renderWaveform(ch.key + "-" + clip.id, clip.audioBuffer, ch.color);
        });
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [zoom, isLoaded, channels]);

  // Sync parameters to Web Audio nodes
  useEffect(() => {
    if (!isLoaded) return;

    // Calculate Solo Overrides
    const activeSoloChannels = channels.filter((c) => c.solo);
    const hasSolo = activeSoloChannels.length > 0;

    channels.forEach((ch) => {
      const nodes = trackNodesRef.current[ch.key];
      if (!nodes) return;

      // Handle Volume, Panning, Mute, Solo
      let finalGain = Math.pow(10, ch.volume / 20); // convert dB to linear gain
      if (ch.mute) {
        finalGain = 0;
      } else if (hasSolo && !ch.solo) {
        finalGain = 0;
      }
      nodes.gain.gain.setValueAtTime(finalGain, audioCtxRef.current!.currentTime);
      nodes.panner.pan.setValueAtTime(ch.pan, audioCtxRef.current!.currentTime);

      // EQ Nodes
      nodes.eqLow.gain.setValueAtTime(ch.eqLow, audioCtxRef.current!.currentTime);
      nodes.eqMid.gain.setValueAtTime(ch.eqMid, audioCtxRef.current!.currentTime);
      nodes.eqHigh.gain.setValueAtTime(ch.eqHigh, audioCtxRef.current!.currentTime);

      // Delay Send level
      nodes.delayGain.gain.setValueAtTime(ch.delayMix, audioCtxRef.current!.currentTime);

      // Sync Dynamic Effects
      const rebuildGraph = nodes.effectChain.updateFromConfig(audioCtxRef.current!, ch.effects);
      if (rebuildGraph) {
        import("@/lib/plugins").then(({ createEffect }) => {
          const effectInstances = ch.effects.map((config) =>
            createEffect(audioCtxRef.current!, config),
          );
          nodes.effectChain.setEffects(effectInstances);
        });
      }
    });
  }, [channels, isLoaded]);

  // Handle Master FX Compressor Toggle
  useEffect(() => {
    if (!isLoaded || !compressorRef.current) return;
    const threshold = compressorEnabled ? -18 : 0;
    compressorRef.current.threshold.setValueAtTime(threshold, audioCtxRef.current!.currentTime);
  }, [compressorEnabled, isLoaded]);

  // Handle Master FX Limiter Toggle
  useEffect(() => {
    if (!isLoaded || !limiterRef.current) return;
    const threshold = limiterEnabled ? -1 : 0;
    limiterRef.current.threshold.setValueAtTime(threshold, audioCtxRef.current!.currentTime);
  }, [limiterEnabled, isLoaded]);

  // Load song stems on page load (re-run only when the song id or stems change,
  // not on every parent re-render that produces a new displaySong object reference)
  const stemsKey = displaySong?.stems ? Object.keys(displaySong.stems).sort().join(",") : "";
  useEffect(() => {
    if (!displaySong) return;
    if (hasStems) {
      loadStems(displaySong.stems as Record<string, string>, displaySong.title);
    } else {
      setIsLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySong?.id, hasStems, stemsKey]);

  // Close the AudioContext only on real unmount — not on every dep change,
  // otherwise an in-flight loadStems builds nodes against a closed context.
  useEffect(() => {
    return () => {
      stopPlayback();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clip Dragging Logic
  const handleClipDragStart = (
    e: React.MouseEvent,
    key: string,
    action: "move" | "trimStart" | "trimEnd" | "fadeIn" | "fadeOut",
    clipId?: string,
  ) => {
    e.stopPropagation();
    if (!clipId) return;

    const startX = e.clientX;
    const channelIndex = channels.findIndex((c) => c.key === key);
    if (channelIndex === -1) return;
    const ch = channels[channelIndex];

    const clipIndex = ch.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return;
    const clip = ch.clips[clipIndex];

    const timelineEl = (e.currentTarget as HTMLElement).closest(".timeline-lane-container");
    if (!timelineEl) return;
    const rect = timelineEl.getBoundingClientRect();
    const pixelsPerSecond = rect.width / duration;

    const initialStartOffset = clip.startOffset || 0;
    const initialTrimStart = clip.trimStart || 0;
    const initialTrimEnd = clip.trimEnd !== undefined ? clip.trimEnd : clip.audioBuffer.duration;
    const initialFadeIn = clip.fadeIn || 0;
    const initialFadeOut = clip.fadeOut || 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSeconds = deltaX / pixelsPerSecond;

      setChannels((prev) => {
        const newChannels = [...prev];
        const idx = newChannels.findIndex((c) => c.key === key);
        if (idx === -1) return prev;

        const nc = { ...newChannels[idx] };
        const newClips = [...nc.clips];
        const cIdx = newClips.findIndex((c) => c.id === clipId);
        if (cIdx === -1) return prev;

        const c = { ...newClips[cIdx] };

        if (action === "move") {
          c.startOffset = Math.max(0, initialStartOffset + deltaSeconds);
        } else if (action === "trimStart") {
          const newTrim = Math.max(
            0,
            Math.min(initialTrimStart + deltaSeconds, initialTrimEnd - 0.1),
          );
          c.trimStart = newTrim;
          c.startOffset = Math.max(0, initialStartOffset + (newTrim - initialTrimStart));
        } else if (action === "trimEnd") {
          c.trimEnd = Math.max(
            c.trimStart! + 0.1,
            Math.min(c.audioBuffer.duration, initialTrimEnd + deltaSeconds),
          );
        } else if (action === "fadeIn") {
          c.fadeIn = Math.max(
            0,
            Math.min(initialFadeIn + deltaSeconds, c.audioBuffer.duration / 2),
          );
        } else if (action === "fadeOut") {
          c.fadeOut = Math.max(
            0,
            Math.min(initialFadeOut - deltaSeconds, c.audioBuffer.duration / 2),
          );
        }

        newClips[cIdx] = c;
        nc.clips = newClips;
        newChannels[idx] = nc;
        return newChannels;
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Global Key Space Shortcut for Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoaded, isPlaying, duration, channels]);

  // Playback Loop Timer
  const updatePlayhead = () => {
    if (!isPlaying) return;
    const elapsed =
      audioCtxRef.current!.currentTime - playStartedAtRef.current + startOffsetTimeRef.current;
    if (elapsed >= duration) {
      setIsPlaying(false);
      setCurrentTime(0);
      startOffsetTimeRef.current = 0;

      // Update DOM directly to reset
      document.querySelectorAll(".daw-playhead").forEach((el) => {
        (el as HTMLElement).style.left = "0%";
      });
      const timerEl = document.querySelector(".daw-timer-label");
      if (timerEl) {
        timerEl.textContent = formatTime(0);
      }
    } else {
      // Direct DOM manipulation for butter-smooth 60fps playhead sweep without React re-render lags!
      const percent = Math.min(100, (elapsed / duration) * 100);
      document.querySelectorAll(".daw-playhead").forEach((el) => {
        (el as HTMLElement).style.left = `${percent}%`;
      });
      const timerEl = document.querySelector(".daw-timer-label");
      if (timerEl) {
        timerEl.textContent = formatTime(elapsed);
      }

      // Throttle React state updates to every 150ms just to keep internal React hook states in sync without triggering 60fps laggy re-renders!
      if (elapsed - lastStateUpdateRef.current >= 0.15) {
        lastStateUpdateRef.current = elapsed;
        setCurrentTime(elapsed);
      }

      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    }
  };

  // Hard-resync helper: stop every stem source and re-schedule them all against
  // a single shared AudioContext startTime so every stem stays phase-locked.
  // Used by initial play AND by mute/solo toggles (including undoing them) so
  // a stem can never drift out of sync with its siblings.
  const scheduleAllSources = (fromOffset: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) {
      console.warn("[DAW] scheduleAllSources: no AudioContext");
      return;
    }

    // Stop any existing sources first
    channels.forEach((ch) => {
      const nodes = trackNodesRef.current[ch.key];
      if (nodes?.sources) {
        nodes.sources.forEach((src) => {
          try {
            src.stop();
            src.disconnect();
          } catch {}
        });
        nodes.sources = [];
      }
    });

    const playTime = ctx.currentTime + 0.05; // shared anchor for ALL stems
    playStartedAtRef.current = playTime;
    startOffsetTimeRef.current = fromOffset;

    let scheduledCount = 0;
    channels.forEach((ch) => {
      const nodes = trackNodesRef.current[ch.key];
      if (!nodes) {
        console.warn(`[DAW] scheduleAllSources: no nodes for "${ch.key}"`);
        return;
      }
      nodes.sources = [];

      ch.clips.forEach((clip) => {
        if (!clip.audioBuffer) {
          console.warn(`[DAW] no audioBuffer on ${ch.key}/${clip.id}`);
          return;
        }

        const source = ctx.createBufferSource();
        source.buffer = clip.audioBuffer;

        const clipGain = ctx.createGain();
        source.connect(clipGain);
        clipGain.connect(nodes.eqLow);

        const chStartOffset = clip.startOffset || 0;
        const chTrimStart = clip.trimStart || 0;
        const chTrimEnd = clip.trimEnd !== undefined ? clip.trimEnd : clip.audioBuffer.duration;
        const chDuration = chTrimEnd - chTrimStart;

        let startTime = 0;
        let playOffset = 0;
        let actualDuration = chDuration;

        if (fromOffset < chStartOffset) {
          const timeToWait = chStartOffset - fromOffset;
          startTime = playTime + timeToWait;
          playOffset = chTrimStart;
        } else if (fromOffset < chStartOffset + chDuration) {
          const offsetIntoClip = fromOffset - chStartOffset;
          startTime = playTime;
          playOffset = chTrimStart + offsetIntoClip;
          actualDuration = chDuration - offsetIntoClip;
        } else {
          return; // Skip scheduling if clip is entirely before fromOffset
        }

        source.start(startTime, playOffset, actualDuration);
        scheduledCount++;

        // Apply Fades
        const fadeIn = clip.fadeIn || 0;
        const fadeOut = clip.fadeOut || 0;

        clipGain.gain.setValueAtTime(1, startTime);

        if (fadeIn > 0) {
          // If we started playing AFTER the fade-in period, we skip the fade
          const fadeOffset = playOffset - chTrimStart;
          if (fadeOffset < fadeIn) {
            clipGain.gain.setValueAtTime(0, startTime);
            clipGain.gain.linearRampToValueAtTime(1, startTime + (fadeIn - fadeOffset));
          }
        }

        if (fadeOut > 0) {
          const fadeOutStart = chDuration - fadeOut;
          const fadeOffset = playOffset - chTrimStart;
          // If we are playing during the fade-out, start fading immediately
          if (fadeOffset > fadeOutStart) {
            const remainingFade = actualDuration;
            // Calculate partial gain if we start in the middle of a fade
            const startGain = 1.0 - (fadeOffset - fadeOutStart) / fadeOut;
            clipGain.gain.setValueAtTime(startGain, startTime);
            clipGain.gain.linearRampToValueAtTime(0, startTime + remainingFade);
          } else {
            clipGain.gain.setValueAtTime(1, startTime + (fadeOutStart - fadeOffset));
            clipGain.gain.linearRampToValueAtTime(0, startTime + actualDuration);
          }
        }

        nodes.sources.push(source);
      });
    });
    console.log(
      `[DAW] scheduled ${scheduledCount} sources @offset=${fromOffset} (ctxState=${ctx.state}, channels=${channels.length})`,
    );
  };

  const handleTogglePlay = async () => {
    if (!isLoaded) {
      console.warn("[DAW] toggle play ignored — not loaded yet");
      return;
    }
    const ctx = audioCtxRef.current!;
    console.log(
      `[DAW] toggle play: isPlaying=${isPlaying}, ctx.state=${ctx?.state}, channels=${channels.length}, clips=${channels.map((c) => c.clips.length).join(",")}`,
    );

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (isPlaying) {
      stopPlayback();
    } else {
      scheduleAllSources(startOffsetTimeRef.current);
      setIsPlaying(true);
    }
  };

  const stopPlayback = () => {
    setIsPlaying(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    // Stop all audio source nodes
    channels.forEach((ch) => {
      const nodes = trackNodesRef.current[ch.key];
      if (nodes?.sources) {
        nodes.sources.forEach((src) => {
          try {
            src.stop();
            src.disconnect();
          } catch {}
        });
        nodes.sources = [];
      }
    });
  };

  // Hard resync on mute / solo toggles (and undoing them).
  // Whenever the mute/solo signature changes while playing, capture the
  // current playhead, stop every stem, and re-schedule them all against a
  // single new AudioContext startTime so phase alignment is guaranteed.
  // Muted/soloed-out stems are still scheduled (gain=0) so unmuting later
  // also lands phase-locked.
  const muteSoloSigRef = useRef<string>("");
  useEffect(() => {
    if (!isLoaded) return;
    const sig = channels.map((c) => `${c.key}:${c.mute ? 1 : 0}:${c.solo ? 1 : 0}`).join("|");
    const prev = muteSoloSigRef.current;
    muteSoloSigRef.current = sig;
    if (!prev || sig === prev) return; // baseline / no change
    if (!isPlaying) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const elapsed = ctx.currentTime - playStartedAtRef.current + startOffsetTimeRef.current;
    const clamped = Math.max(0, Math.min(duration || elapsed, elapsed));
    scheduleAllSources(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, isLoaded, isPlaying, duration]);

  // Sync playhead state trigger
  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying]);

  const handleStop = () => {
    stopPlayback();
    startOffsetTimeRef.current = 0;
    lastStateUpdateRef.current = 0;
    setCurrentTime(0);

    // Reset DOM immediately
    document.querySelectorAll(".daw-playhead").forEach((el) => {
      (el as HTMLElement).style.left = "0%";
    });
    const timerEl = document.querySelector(".daw-timer-label");
    if (timerEl) {
      timerEl.textContent = formatTime(0);
    }
  };

  const handleToggleArm = async (trackKey: string) => {
    // If we're arming this track, make sure we have mic permissions
    const ch = channels.find((c) => c.key === trackKey);
    const isArming = !ch?.isArmed;

    if (isArming) {
      try {
        if (!micStreamRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = stream;
        }
      } catch (err) {
        alert("Microphone permission denied or no device found.");
        return;
      }
    }

    setChannels((prev) =>
      prev.map((c) => {
        // Un-arm other tracks (exclusive arming for now)
        if (c.key !== trackKey) return { ...c, isArmed: false };
        return { ...c, isArmed: isArming };
      }),
    );
  };

  const handleSplitClip = (channelKey: string, clipId: string, splitGlobalTime: number) => {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.key !== channelKey) return ch;
        const clipIndex = ch.clips.findIndex((c) => c.id === clipId);
        if (clipIndex === -1) return ch;

        const clip = ch.clips[clipIndex];
        const clipStartGlobal = clip.startOffset || 0;
        const clipEndGlobal =
          clipStartGlobal +
          (clip.trimEnd !== undefined ? clip.trimEnd : clip.audioBuffer.duration) -
          (clip.trimStart || 0);

        // Allow a small margin to avoid splitting at exact edges
        if (splitGlobalTime <= clipStartGlobal + 0.01 || splitGlobalTime >= clipEndGlobal - 0.01) {
          return ch;
        }

        const offsetIntoClip = splitGlobalTime - clipStartGlobal;
        const trimTime = (clip.trimStart || 0) + offsetIntoClip;

        const leftClip = {
          ...clip,
          id: Math.random().toString(36).substring(2, 9),
          trimEnd: trimTime,
          duration: offsetIntoClip,
          fadeOut: 0.005, // 5ms micro-fade to avoid pops
        };

        const rightClip = {
          ...clip,
          id: Math.random().toString(36).substring(2, 9),
          startOffset: splitGlobalTime,
          trimStart: trimTime,
          duration: clipEndGlobal - splitGlobalTime,
          fadeIn: 0.005, // 5ms micro-fade to avoid pops
        };

        const newClips = [...ch.clips];
        newClips.splice(clipIndex, 1, leftClip, rightClip);

        // Schedule rendering of the new waveforms
        setTimeout(() => {
          renderWaveform(ch.key + "-" + leftClip.id, leftClip.audioBuffer, ch.color);
          renderWaveform(ch.key + "-" + rightClip.id, rightClip.audioBuffer, ch.color);
        }, 100);

        return { ...ch, clips: newClips };
      }),
    );
  };

  const startRecording = () => {
    const armedTrack = channels.find((c) => c.isArmed);
    if (!armedTrack || !micStreamRef.current) return;

    recordedChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(micStreamRef.current);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();

      try {
        const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);

        const newClipId = Math.random().toString(36).substring(2, 9);
        // Update track buffer
        setChannels((prev) => {
          const newChannels = [...prev];
          const trk = newChannels.find((c) => c.key === armedTrack.key);
          if (trk) {
            trk.clips = [
              ...trk.clips,
              {
                id: newClipId,
                audioBuffer,
                startOffset: 0,
                duration: audioBuffer.duration,
                fadeIn: 0,
                fadeOut: 0,
              },
            ];
            // Ensure nodes are initialized for this track
            initTrackNode(trk.key);
          }
          return newChannels;
        });

        // Update overall duration if the recording extended it
        if (audioBuffer.duration > duration) {
          setDuration(audioBuffer.duration);
        }

        // Render waveform
        setTimeout(() => {
          renderWaveform(`${armedTrack.key}-${newClipId}`, audioBuffer, armedTrack.color);
        }, 100);
      } catch (err) {
        console.error("Failed to decode recorded audio", err);
      }
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setIsRecording(true);

    // Also start playback to record over the beat
    if (!isPlaying) {
      handleTogglePlay();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleRecord = () => {
    if (isRecording) {
      stopRecording();
      stopPlayback();
    } else {
      startRecording();
    }
  };

  const addTrack = () => {
    const newKey = `track_${Date.now()}`;
    const newTrack: TrackChannel = {
      name: `Track ${channels.length + 1}`,
      key: newKey,
      url: "",
      color: "#94a3b8", // slate-400
      glow: "shadow-slate-500/20",
      volume: 0,
      pan: 0,
      mute: false,
      solo: false,
      isArmed: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      delayMix: 0,
      effects: [],
      clips: [],
    };

    setChannels((prev) => [...prev, newTrack]);
    // Initialize Web Audio nodes for empty track
    initTrackNode(newKey);
  };

  // Timeline scrub
  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isLoaded || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;
    const newTime = ratio * duration;

    const originallyPlaying = isPlaying;
    stopPlayback();
    startOffsetTimeRef.current = newTime;
    lastStateUpdateRef.current = newTime;
    setCurrentTime(newTime);

    // Update DOM immediately for instant visual scrub snap
    const percent = Math.min(100, (newTime / duration) * 100);
    document.querySelectorAll(".daw-playhead").forEach((el) => {
      (el as HTMLElement).style.left = `${percent}%`;
    });
    const timerEl = document.querySelector(".daw-timer-label");
    if (timerEl) {
      timerEl.textContent = formatTime(newTime);
    }

    if (originallyPlaying) {
      // Re-trigger play immediately at the new offset
      setTimeout(() => {
        handleTogglePlay();
      }, 50);
    }
  };

  // Format Time representation
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  // Load Demo Tracks
  const loadDemoWorkspace = () => {
    setIsDemo(true);
    loadStems(DEMO_STEMS, "Groove Foundation Template (Demo)");
  };

  // Client Side WAV mix down using OfflineAudioContext
  const handleExportWav = async () => {
    if (!isLoaded || duration === 0 || exporting) return;
    setExporting(true);
    stopPlayback();

    try {
      const OfflineAudioContextClass =
        window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      // Recreate exact same mixer nodes in the offline renderer
      const offlineCtx = new OfflineAudioContextClass(2, 44100 * duration, 44100);

      // Master Compressor/Limiter chain offline
      const masterGain = offlineCtx.createGain();
      masterGain.gain.setValueAtTime(0.85, 0);

      const compressor = offlineCtx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(compressorEnabled ? -18 : 0, 0);
      compressor.knee.setValueAtTime(12, 0);
      compressor.ratio.setValueAtTime(4, 0);
      compressor.attack.setValueAtTime(0.015, 0);
      compressor.release.setValueAtTime(0.12, 0);

      const limiter = offlineCtx.createDynamicsCompressor();
      limiter.threshold.setValueAtTime(limiterEnabled ? -1 : 0, 0);
      limiter.knee.setValueAtTime(0, 0);
      limiter.ratio.setValueAtTime(20, 0);

      // Route Master FX Chain
      compressor.connect(limiter);
      limiter.connect(masterGain);
      masterGain.connect(offlineCtx.destination);

      // Calculate Solo overrides
      const activeSoloChannels = channels.filter((c) => c.solo);
      const hasSolo = activeSoloChannels.length > 0;

      // Recreate track graphs
      // Recreate track graphs
      for (const ch of channels) {
        if (!ch.clips || ch.clips.length === 0) continue;

        const gain = offlineCtx.createGain();
        let finalGain = Math.pow(10, ch.volume / 20);
        if (ch.mute) finalGain = 0;
        else if (hasSolo && !ch.solo) finalGain = 0;
        gain.gain.setValueAtTime(finalGain, 0);

        const panner = offlineCtx.createStereoPanner();
        panner.pan.setValueAtTime(ch.pan, 0);

        const eqLow = offlineCtx.createBiquadFilter();
        eqLow.type = "lowshelf";
        eqLow.frequency.setValueAtTime(200, 0);
        eqLow.gain.setValueAtTime(ch.eqLow, 0);

        const eqMid = offlineCtx.createBiquadFilter();
        eqMid.type = "peaking";
        eqMid.Q.setValueAtTime(1.0, 0);
        eqMid.frequency.setValueAtTime(1000, 0);
        eqMid.gain.setValueAtTime(ch.eqMid, 0);

        const eqHigh = offlineCtx.createBiquadFilter();
        eqHigh.type = "highshelf";
        eqHigh.frequency.setValueAtTime(5000, 0);
        eqHigh.gain.setValueAtTime(ch.eqHigh, 0);

        const delay = offlineCtx.createDelay(1.0);
        delay.delayTime.setValueAtTime(0.33, 0);
        const delayGain = offlineCtx.createGain();
        delayGain.gain.setValueAtTime(ch.delayMix, 0);
        const delayFeedback = offlineCtx.createGain();
        delayFeedback.gain.setValueAtTime(0.4, 0);

        // Effect Chain for Offline
        let lastNode: AudioNode = eqHigh;
        if (ch.effects && ch.effects.length > 0) {
          const { EffectChain } = await import("@/lib/audio-engine");
          const { createEffect } = await import("@/lib/plugins");
          const effectChain = new EffectChain(offlineCtx);
          const effectInstances = ch.effects.map((config) => createEffect(offlineCtx, config));
          effectChain.setEffects(effectInstances);

          lastNode.connect(effectChain.inputNode);
          lastNode = effectChain.outputNode;
        }

        // Connections
        eqLow.connect(eqMid);
        eqMid.connect(eqHigh);
        lastNode.connect(panner);
        panner.connect(gain);
        gain.connect(compressor);

        // Delay connections
        gain.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(delayFeedback);
        delayFeedback.connect(delay);
        delayGain.connect(compressor);

        // Schedule all clips for this track
        ch.clips.forEach((clip) => {
          if (!clip.audioBuffer) return;

          const source = offlineCtx.createBufferSource();
          source.buffer = clip.audioBuffer;

          const fadeGain = offlineCtx.createGain();
          fadeGain.gain.value = 1.0;

          source.connect(fadeGain);
          fadeGain.connect(eqLow);

          const chStartOffset = clip.startOffset || 0;
          const chTrimStart = clip.trimStart || 0;
          const chTrimEnd = clip.trimEnd !== undefined ? clip.trimEnd : clip.audioBuffer.duration;
          const chDuration = Math.max(0, chTrimEnd - chTrimStart);

          if (chDuration > 0) {
            source.start(chStartOffset, chTrimStart, chDuration);

            // Apply offline fades
            if (clip.fadeIn && clip.fadeIn > 0) {
              fadeGain.gain.setValueAtTime(0, chStartOffset);
              fadeGain.gain.linearRampToValueAtTime(1, chStartOffset + clip.fadeIn);
            }
            if (clip.fadeOut && clip.fadeOut > 0) {
              const fadeOutStart = chStartOffset + chDuration - clip.fadeOut;
              fadeGain.gain.setValueAtTime(1, Math.max(chStartOffset, fadeOutStart));
              fadeGain.gain.linearRampToValueAtTime(0, chStartOffset + chDuration);
            }
          }
        });
      }

      // Start client side rendering
      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = bufferToWav(renderedBuffer);

      // Prompt browser download
      const url = URL.createObjectURL(wavBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${displaySong?.title.replace(/[^a-zA-Z0-9]/g, "_") || "vybe"}_daw_master.wav`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Offline audio mixdown failed.");
    } finally {
      setExporting(false);
    }
  };

  // Master VU level meter logic
  const masterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!isLoaded || !masterAnalyserRef.current) return;
    const canvas = masterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = masterAnalyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let frameId: number;

    const drawMeter = () => {
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw dynamic master stereometer peaks
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const height = (average / 150) * canvas.height;

      // Stereo bars background
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(5, 0, 15, canvas.height);
      ctx.fillRect(25, 0, 15, canvas.height);

      // Active Neon indicators
      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, "#10b981"); // green low
      grad.addColorStop(0.65, "#f59e0b"); // orange mid
      grad.addColorStop(1, "#ef4444"); // red peak

      ctx.fillStyle = grad;
      ctx.fillRect(5, canvas.height - height, 15, height);
      ctx.fillRect(25, canvas.height - height, 15, height);

      frameId = requestAnimationFrame(drawMeter);
    };

    drawMeter();
    return () => cancelAnimationFrame(frameId);
  }, [isLoaded]);

  // Track Peak Meters logic
  const trackCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  useEffect(() => {
    if (!isLoaded) return;
    const activeFrameIds: number[] = [];

    channels.forEach((ch) => {
      const canvas = trackCanvasRefs.current[ch.key];
      const nodes = trackNodesRef.current[ch.key];
      if (!canvas || !nodes) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const analyser = nodes.analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const draw = () => {
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw track vertical bar
        let maxVal = 0;
        for (let i = 0; i < dataArray.length; i++) {
          if (dataArray[i] > maxVal) maxVal = dataArray[i];
        }
        const height = (maxVal / 255) * canvas.height;

        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = ch.color;
        ctx.fillRect(0, canvas.height - height, canvas.width, height);

        const frame = requestAnimationFrame(draw);
        activeFrameIds.push(frame);
      };

      draw();
    });

    return () => {
      activeFrameIds.forEach((id) => cancelAnimationFrame(id));
    };
  }, [isLoaded, channels]);

  if (songsLoading) {
    return (
      <div className="min-h-screen bg-[#08070d] text-white flex flex-col items-center justify-center font-mono">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
        Loading Song Metadata...
      </div>
    );
  }

  const isDemoMode = id === "demo-neon-pulse" || id === "demo-velvet-drift" || isDemo;

  if (!displaySong && !isDemoMode) {
    return (
      <div className="min-h-screen bg-[#08070d] text-white flex flex-col items-center justify-center font-mono px-6 text-center">
        <AlertTriangle className="h-16 w-16 text-amber-500 mb-4 animate-bounce" />
        <h1 className="text-2xl font-bold">Song Not Found</h1>
        <p className="text-muted-foreground mt-2 max-w-sm">
          We couldn't locate this song inside your studio library.
        </p>
        <Link
          to="/studio"
          className="mt-6 border border-border px-6 py-3 hover:border-primary text-xs uppercase tracking-wider font-mono"
        >
          Back to Studio
        </Link>
      </div>
    );
  }

  // 3. Stems Separation is handled inline inside the multitrack timeline area.

  // 4. Fully Functional DAW Workspace View
  return (
    <div className="min-h-screen bg-[#08070d] text-white flex flex-col overflow-x-hidden select-none">
      <SiteHeader />

      {/* DAW Loading state */}
      {!isLoaded && (
        <div className="fixed inset-0 z-50 bg-[#08070d]/95 backdrop-blur-lg flex flex-col items-center justify-center text-white px-6">
          <div className="w-[300px] bg-white/[0.05] h-1.5 rounded-full overflow-hidden relative mb-4 border border-white/[0.05]">
            <div
              className="bg-gradient-to-r from-pink-500 via-amber-500 to-emerald-400 h-full rounded-full transition-all duration-300"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="font-mono text-xs uppercase tracking-widest text-white/80 animate-pulse">
            {loadStatus}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mt-1">
            Decoding Audio buffers directly in client RAM...
          </p>
        </div>
      )}

      {/* DAW Main Interface Panel */}
      <main className="flex-1 flex flex-col px-6 py-6 max-w-[1400px] w-full mx-auto space-y-4">
        {/* Header navigation bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-white/[0.05] pb-4">
          <div className="flex items-center gap-3">
            <Link
              to="/song/$id"
              params={{ id }}
              className="p-2 border border-white/[0.05] hover:border-white/20 bg-white/[0.02] rounded-sm transition text-muted-foreground hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-widest bg-primary/20 text-primary border border-primary/20 px-2 py-0.5 rounded-sm">
                  {isDemo ? "DEMO TEMPLATE" : "STUDIO WORKSPACE"}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  VYBE DAW v1.0
                </span>
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-white mt-0.5">
                {isDemo ? "Groove Foundation Template" : displaySong?.title || "your track"}
              </h1>
            </div>
          </div>

          {/* Master Transport controls */}
          <div className="flex items-center gap-4 bg-white/[0.02] border border-white/[0.05] px-4 py-3 rounded-sm backdrop-blur-md flex-wrap md:flex-nowrap">
            {/* Tool selectors */}
            <div className="flex items-center bg-black/40 rounded-sm overflow-hidden border border-white/[0.05] mr-2">
              <button
                onClick={() => setToolMode("pointer")}
                className={`p-2 transition-colors ${toolMode === "pointer" ? "bg-white/10 text-emerald-400" : "text-muted-foreground hover:bg-white/5"}`}
                title="Pointer Tool"
              >
                <MousePointer2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setToolMode("scissors")}
                className={`p-2 transition-colors border-l border-white/[0.05] ${toolMode === "scissors" ? "bg-white/10 text-emerald-400" : "text-muted-foreground hover:bg-white/5"}`}
                title="Scissors Tool"
              >
                <Scissors className="h-4 w-4" />
              </button>
            </div>

            {/* Play / Stop / Record buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleTogglePlay}
                className={`p-3 rounded-full cursor-pointer transition-all ${
                  isPlaying && !isRecording
                    ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 scale-[1.05]"
                    : "bg-white/5 hover:bg-white/10 text-white"
                }`}
              >
                {isPlaying && !isRecording ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 fill-current ml-0.5" />
                )}
              </button>
              <button
                onClick={handleRecord}
                className={`p-3 rounded-full cursor-pointer transition-all ${
                  isRecording
                    ? "bg-red-500 text-white shadow-lg shadow-red-500/20 scale-[1.05] animate-pulse"
                    : "bg-white/5 hover:bg-white/10 text-white"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full ${isRecording ? "bg-white" : "bg-red-500"}`}
                />
              </button>
              <button
                onClick={handleStop}
                className="p-3 bg-white/5 hover:bg-white/10 text-white rounded-full cursor-pointer transition"
              >
                <Square className="h-4 w-4 fill-current text-white/50" />
              </button>
              <button
                onClick={() => {
                  setChannels((prev) =>
                    prev.map((ch) => {
                      const newClips = [...ch.clips];
                      let changed = false;

                      for (let i = newClips.length - 1; i >= 0; i--) {
                        const clip = newClips[i];
                        const trimStart = clip.trimStart ?? 0;
                        const trimEnd = clip.trimEnd ?? clip.audioBuffer.duration;
                        const visibleDuration = trimEnd - trimStart;

                        // Use the internal currentTime state for the playhead position
                        if (
                          currentTime > clip.startOffset &&
                          currentTime < clip.startOffset + visibleDuration
                        ) {
                          const offsetIntoClip = currentTime - clip.startOffset;
                          const splitTrimPoint = trimStart + offsetIntoClip;

                          const leftClip = { ...clip, trimEnd: splitTrimPoint };
                          const rightClip = {
                            ...clip,
                            id: Math.random().toString(36).substring(7),
                            startOffset: currentTime,
                            trimStart: splitTrimPoint,
                          };

                          newClips.splice(i, 1, leftClip, rightClip);
                          changed = true;
                        }
                      }

                      return changed ? { ...ch, clips: newClips } : ch;
                    }),
                  );
                }}
                title="Split at playhead"
                className="p-3 bg-white/5 hover:bg-white/10 text-white rounded-full cursor-pointer transition ml-4"
              >
                <Scissors className="h-4 w-4 fill-current text-white/50" />
              </button>
            </div>

            {/* Neon Glowing Time Indicator */}
            <div className="bg-[#040306] px-4 py-2 border border-white/[0.05] rounded-sm text-center min-w-[120px]">
              <span className="daw-timer-label font-mono text-sm font-bold tracking-widest text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                {formatTime(currentTime)}
              </span>
              <div className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
                {formatTime(duration)} Total
              </div>
            </div>

            {/* Song Meta tags: Tempo BPM / Key Sig */}
            <div className="flex items-center gap-4 border-l border-white/[0.05] pl-4">
              <div className="text-left">
                <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground block">
                  Tempo
                </span>
                <span className="font-mono text-xs font-bold text-white flex items-center gap-1.5 mt-0.5">
                  <Scissors className="h-3 w-3 text-amber-500 rotate-90" /> {bpm} BPM
                </span>
              </div>
              <div className="text-left">
                <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground block">
                  Key
                </span>
                <span className="font-mono text-xs font-bold text-white flex items-center gap-1.5 mt-0.5">
                  <Key className="h-3 w-3 text-blue-500" /> {keySig}
                </span>
              </div>
            </div>

            {/* Horizontal Timeline Zoom */}
            <div className="flex items-center gap-2 border-l border-white/[0.05] pl-4">
              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground">
                Zoom
              </span>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-16 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          </div>
        </div>

        {/* Workspace Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* 4-Stem Multitrack Timeline (takes 3 cols) */}
          <div className="xl:col-span-3 space-y-3">
            {!hasStems &&
            !isDemo &&
            (!fullSongFetched || displaySong?.extractionStatus === "processing") ? (
              <div className="bg-white/[0.01] border border-white/[0.05] rounded-sm p-8 backdrop-blur-md relative overflow-hidden min-h-[520px] flex flex-col items-center justify-center text-center space-y-6">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
                <div className="z-10 space-y-4 max-w-md mx-auto">
                  <RefreshCw className="h-12 w-12 text-primary mx-auto animate-spin" />
                  <h2 className="font-display text-2xl font-black text-white">
                    {displaySong?.extractionStatus === "processing"
                      ? "Separating stems…"
                      : "Loading session…"}
                  </h2>
                  <p className="text-muted-foreground font-mono text-[11px] leading-relaxed max-w-sm mx-auto">
                    {displaySong?.extractionStatus === "processing"
                      ? "Your stems are still being extracted in the background. This page will update automatically when ready."
                      : "Fetching full song data including stem manifest. This usually takes a moment on mobile networks."}
                  </p>
                </div>
              </div>
            ) : !hasStems && !isDemo ? (
              <div className="bg-white/[0.01] border border-white/[0.05] rounded-sm p-8 backdrop-blur-md relative overflow-hidden min-h-[520px] flex flex-col items-center justify-center text-center space-y-6">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

                <div className="z-10 space-y-6 max-w-md mx-auto">
                  <Disc className="h-16 w-16 text-primary mx-auto animate-spin-slow" />

                  <div className="space-y-2">
                    <h2 className="font-display text-3xl font-black text-white leading-none">
                      Separate Stems for <br />
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-amber-500 to-emerald-400">
                        "{displaySong?.title || "your track"}"
                      </span>
                    </h2>
                    <p className="text-muted-foreground font-mono text-[9px] uppercase tracking-widest leading-relaxed mt-2">
                      Facebook HTDemucs Neural Separation Engine
                    </p>
                  </div>

                  <p className="text-muted-foreground font-mono text-[11px] leading-relaxed max-w-sm mx-auto">
                    This track hasn't been split yet. Extract lead/backing vocals, punchy drums, sub
                    bass, and melodies directly into individual mixer timeline tracks.
                  </p>

                  <div className="p-4 bg-black/40 border border-white/[0.03] rounded-sm text-left space-y-2.5 font-mono text-[10px] text-muted-foreground">
                    <div className="flex items-start gap-3">
                      <span className="text-primary font-bold">1.</span>
                      <span>
                        Splits sound file into pristine isolated stems (44.1kHz WAV resolution).
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="text-primary font-bold">2.</span>
                      <span>
                        Instantly populates DAW channels with gain, panning, EQ, and Master FX
                        active.
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-4 pt-2">
                    <button
                      onClick={handleStartStemsExtraction}
                      disabled={extractingStems}
                      className="w-full px-8 py-4 bg-primary text-white font-mono text-xs uppercase tracking-widest font-black rounded-sm hover:bg-primary/90 hover:scale-[1.02] transition-all disabled:opacity-75 disabled:scale-100 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-primary/20"
                    >
                      {extractingStems ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Separating Stems ({Math.round(extractionProgress)}%)…
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Run 4-Stem AI Separation
                        </>
                      )}
                    </button>

                    <button
                      onClick={loadDemoWorkspace}
                      className="text-muted-foreground hover:text-white font-mono text-[9px] uppercase tracking-widest underline transition"
                    >
                      Or Load Interactive Demo Studio Template
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {hasStems && !isDemo && (
                  <div className="flex justify-end">
                    <button
                      onClick={handleClearStems}
                      className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:text-destructive transition border border-white/[0.05] rounded-sm px-3 py-1.5"
                    >
                      ✕ delete stems & re-extract
                    </button>
                  </div>
                )}
                {/* Scrollable Timeline Area wrapper */}
                <div className="w-full overflow-x-auto overflow-y-hidden border border-white/[0.05] rounded-md bg-black/20 p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {/* Inner container that scales/expands in width when zoomed */}
                  <div
                    style={{ width: `${100 * zoom}%`, minWidth: "100%" }}
                    className="space-y-4 transition-all duration-300 ease-out"
                  >
                    {/* Timeline Ruler */}
                    <div className="relative h-6 bg-[#040306]/60 border border-white/[0.03] rounded-sm overflow-hidden flex items-end">
                      <div
                        className="absolute inset-y-0 w-full cursor-ew-resize"
                        onClick={handleScrub}
                      >
                        {/* Hash marks representation */}
                        <div className="w-full h-full flex justify-between px-2 text-[8px] font-mono text-muted-foreground items-center select-none">
                          <span>0:00</span>
                          <span>0:30</span>
                          <span>1:00</span>
                          <span>1:30</span>
                          <span>2:00</span>
                          <span>2:30</span>
                          <span>3:00</span>
                        </div>
                        {/* Active scrolling playhead indicator line */}
                        {duration > 0 && (
                          <div
                            className="daw-playhead absolute inset-y-0 w-0.5 bg-emerald-400 z-10 shadow-[0_0_8px_#10b981]"
                            style={{
                              left: `${(currentTime / duration) * 100}%`,
                              transition: "none",
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Individual track lanes */}
                    <div className="space-y-3">
                      {channels.map((ch) => {
                        const nodes = trackNodesRef.current[ch.key];
                        return (
                          <div
                            key={ch.key}
                            className="bg-white/[0.01] border border-white/[0.05] rounded-sm p-4 backdrop-blur-md flex flex-col md:flex-row gap-4 transition-all hover:bg-white/[0.02]"
                          >
                            {/* Lane controls */}
                            <div className="w-full md:w-[240px] shrink-0 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: ch.color }}
                                  />
                                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                                    {ch.name}
                                  </h3>
                                  {ch.key.startsWith("track-") && (
                                    <button
                                      onClick={() =>
                                        setChannels((prev) => prev.filter((c) => c.key !== ch.key))
                                      }
                                      className="ml-2 text-rose-500 hover:text-rose-400 text-[10px]"
                                      title="Delete Track"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                                {/* Peak meter micro indicator */}
                                <canvas
                                  ref={(el) => {
                                    trackCanvasRefs.current[ch.key] = el;
                                  }}
                                  width="24"
                                  height="14"
                                  className="rounded-sm border border-white/[0.05]"
                                />
                              </div>

                              {ch.key === "vocals" && displaySong?.stems?.vocals && (
                                <div className="space-y-1 border border-pink-500/20 bg-pink-500/5 rounded-sm p-2">
                                  {!voicePickerOpen ? (
                                    <button
                                      onClick={() => setVoicePickerOpen(true)}
                                      className="w-full flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-pink-300 hover:text-pink-200 py-1"
                                    >
                                      <Mic size={11} /> voice clone on vocals
                                    </button>
                                  ) : voicesLoading ? (
                                    <p className="text-[10px] font-mono text-muted-foreground text-center py-1">
                                      loading voices…
                                    </p>
                                  ) : voices.length === 0 ? (
                                    <div className="text-[10px] font-mono text-muted-foreground text-center space-y-1">
                                      <p>no cloned voices yet</p>
                                      <Link
                                        to="/song/$id"
                                        params={{ id: displaySong.id }}
                                        className="text-pink-300 underline"
                                      >
                                        clone one →
                                      </Link>
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5">
                                      <select
                                        value={selectedVoiceId}
                                        onChange={(e) => setSelectedVoiceId(e.target.value)}
                                        disabled={transformingVocal}
                                        className="w-full bg-black/60 border border-white/10 text-white text-[10px] font-mono rounded-sm px-1.5 py-1"
                                      >
                                        <option value="">— pick voice —</option>
                                        {voices.map((v) => (
                                          <option key={v.id} value={v.id}>
                                            {v.name}
                                          </option>
                                        ))}
                                      </select>
                                      <div className="flex gap-1">
                                        <button
                                          onClick={handleVoiceTransform}
                                          disabled={transformingVocal || !selectedVoiceId}
                                          className="flex-1 text-[9px] font-mono uppercase bg-pink-500/30 hover:bg-pink-500/50 disabled:opacity-40 text-white py-1 rounded-sm"
                                        >
                                          {transformingVocal ? "transforming…" : "apply (2 cr)"}
                                        </button>
                                        <button
                                          onClick={() => {
                                            setVoicePickerOpen(false);
                                            setSelectedVoiceId("");
                                          }}
                                          disabled={transformingVocal}
                                          className="text-[9px] font-mono uppercase text-muted-foreground hover:text-white px-2"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* DB Gain Slider */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                                  <span>Volume</span>
                                  <span className="text-white">
                                    {ch.volume > 0 ? `+${ch.volume}` : ch.volume} dB
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="-40"
                                  max="6"
                                  step="0.5"
                                  value={ch.volume}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setChannels((prev) =>
                                      prev.map((c) =>
                                        c.key === ch.key ? { ...c, volume: val } : c,
                                      ),
                                    );
                                  }}
                                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                              </div>

                              {/* Stereo Panner slider */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                                  <span>Pan</span>
                                  <span className="text-white">
                                    {ch.pan === 0
                                      ? "Center"
                                      : ch.pan > 0
                                        ? `R ${Math.round(ch.pan * 100)}`
                                        : `L ${Math.round(Math.abs(ch.pan) * 100)}`}
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="-1"
                                  max="1"
                                  step="0.05"
                                  value={ch.pan}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setChannels((prev) =>
                                      prev.map((c) => (c.key === ch.key ? { ...c, pan: val } : c)),
                                    );
                                  }}
                                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                                />
                              </div>

                              {/* Solo / Mute / Arm toggles */}
                              <div className="grid grid-cols-3 gap-2 pt-1">
                                <button
                                  onClick={() => handleToggleArm(ch.key)}
                                  className={`py-1.5 rounded-sm font-mono text-[10px] uppercase font-bold tracking-wider transition ${
                                    ch.isArmed
                                      ? "bg-red-500 text-white shadow-lg shadow-red-500/20 animate-pulse"
                                      : "bg-white/5 border border-white/5 text-muted-foreground hover:text-white"
                                  }`}
                                >
                                  Arm ⏺
                                </button>
                                <button
                                  onClick={() => {
                                    setChannels((prev) =>
                                      prev.map((c) =>
                                        c.key === ch.key ? { ...c, mute: !c.mute } : c,
                                      ),
                                    );
                                  }}
                                  className={`py-1.5 rounded-sm font-mono text-[10px] uppercase font-bold tracking-wider transition ${
                                    ch.mute
                                      ? "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                                      : "bg-white/5 border border-white/5 text-muted-foreground hover:text-white"
                                  }`}
                                >
                                  Mute
                                </button>
                                <button
                                  onClick={() => {
                                    setChannels((prev) =>
                                      prev.map((c) =>
                                        c.key === ch.key ? { ...c, solo: !c.solo } : c,
                                      ),
                                    );
                                  }}
                                  className={`py-1.5 rounded-sm font-mono text-[10px] uppercase font-bold tracking-wider transition ${
                                    ch.solo
                                      ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                                      : "bg-white/5 border border-white/5 text-muted-foreground hover:text-white"
                                  }`}
                                >
                                  Solo
                                </button>
                              </div>
                            </div>

                            {/* Waveform Canvas Timeline lane */}
                            <div
                              className="timeline-lane-container flex-1 relative bg-[#040306]/40 border border-white/[0.03] rounded-sm overflow-hidden flex items-center justify-center"
                              onClick={handleScrub}
                            >
                              {ch.clips.length > 0 ? (
                                ch.clips.map((clip) => {
                                  const initialStartOffset = clip.startOffset;
                                  const initialTrimStart = clip.trimStart || 0;
                                  const bufferDuration = clip.audioBuffer.duration;
                                  const initialTrimEnd =
                                    clip.trimEnd !== undefined ? clip.trimEnd : bufferDuration;

                                  const clipLeftPct = (initialStartOffset / duration) * 100;
                                  const clipWidthPct = (bufferDuration / duration) * 100;

                                  const trimStartPct = (initialTrimStart / bufferDuration) * 100;
                                  const trimEndPct =
                                    ((bufferDuration - initialTrimEnd) / bufferDuration) * 100;

                                  const fadeInPct = ((clip.fadeIn || 0) / bufferDuration) * 100;
                                  const fadeOutPct = ((clip.fadeOut || 0) / bufferDuration) * 100;

                                  return (
                                    <div
                                      key={clip.id}
                                      className={`absolute inset-y-0 group ${toolMode === "scissors" ? "cursor-crosshair" : "cursor-ew-resize"}`}
                                      style={{
                                        left: `${clipLeftPct}%`,
                                        width: `${clipWidthPct}%`,
                                      }}
                                      onClick={(e) => {
                                        if (toolMode === "scissors") {
                                          e.stopPropagation();
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          const clickX = e.clientX - rect.left;
                                          const clickPct = clickX / rect.width;

                                          const initialTrimStart = clip.trimStart || 0;
                                          const initialTrimEnd =
                                            clip.trimEnd !== undefined
                                              ? clip.trimEnd
                                              : clip.audioBuffer.duration;

                                          const splitGlobalTime =
                                            (clip.startOffset || 0) +
                                            clickPct * (initialTrimEnd - initialTrimStart);

                                          handleSplitClip(ch.key, clip.id, splitGlobalTime);
                                        }
                                      }}
                                    >
                                      <canvas
                                        ref={(el) => {
                                          waveformCanvasesRef.current[`${ch.key}-${clip.id}`] = el;
                                        }}
                                        className="w-full h-full object-cover pointer-events-none"
                                      />

                                      {/* Fade In Overlay */}
                                      {clip.fadeIn! > 0 && (
                                        <div
                                          className="absolute left-0 top-0 bottom-0 pointer-events-none z-10"
                                          style={{
                                            width: `${fadeInPct}%`,
                                            background:
                                              "linear-gradient(to right, rgba(0,0,0,0.8), transparent)",
                                          }}
                                        />
                                      )}

                                      {/* Fade Out Overlay */}
                                      {clip.fadeOut! > 0 && (
                                        <div
                                          className="absolute right-0 top-0 bottom-0 pointer-events-none z-10"
                                          style={{
                                            width: `${fadeOutPct}%`,
                                            background:
                                              "linear-gradient(to left, rgba(0,0,0,0.8), transparent)",
                                          }}
                                        />
                                      )}

                                      {/* Fade In Drag Handle */}
                                      <div
                                        className="absolute top-0 w-2 h-2 bg-white cursor-ew-resize z-20 pointer-events-auto shadow-sm shadow-black rounded-sm"
                                        style={{ left: `calc(${fadeInPct}% - 4px)` }}
                                        onMouseDown={(e) =>
                                          handleClipDragStart(e, ch.key, "fadeIn", clip.id)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                      />

                                      {/* Fade Out Drag Handle */}
                                      <div
                                        className="absolute top-0 w-2 h-2 bg-white cursor-ew-resize z-20 pointer-events-auto shadow-sm shadow-black rounded-sm"
                                        style={{ right: `calc(${fadeOutPct}% - 4px)` }}
                                        onMouseDown={(e) =>
                                          handleClipDragStart(e, ch.key, "fadeOut", clip.id)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                      />

                                      {/* Trim Start Overlay */}
                                      <div
                                        className="absolute left-0 top-0 bottom-0 bg-black/60 border-r border-white/20 pointer-events-none z-10"
                                        style={{ width: `${trimStartPct}%` }}
                                      >
                                        <div
                                          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 z-10 translate-x-1/2 pointer-events-auto"
                                          onMouseDown={(e) =>
                                            handleClipDragStart(e, ch.key, "trimStart", clip.id)
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                      </div>

                                      {/* Trim End Overlay */}
                                      <div
                                        className="absolute right-0 top-0 bottom-0 bg-black/60 border-l border-white/20 pointer-events-none z-10"
                                        style={{ width: `${trimEndPct}%` }}
                                      >
                                        <div
                                          className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 z-10 -translate-x-1/2 pointer-events-auto"
                                          onMouseDown={(e) =>
                                            handleClipDragStart(e, ch.key, "trimEnd", clip.id)
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                      </div>

                                      {/* Center Move Area */}
                                      <div
                                        className="absolute top-0 bottom-0 z-0 hover:bg-white/5 cursor-grab active:cursor-grabbing"
                                        style={{
                                          left: `${trimStartPct}%`,
                                          right: `${trimEndPct}%`,
                                        }}
                                        onMouseDown={(e) =>
                                          handleClipDragStart(e, ch.key, "move", clip.id)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                                    Empty Track
                                  </span>
                                </div>
                              )}

                              {/* Synchronized Playhead tracker line overlay */}
                              {duration > 0 && (
                                <div
                                  className="daw-playhead absolute inset-y-0 w-0.5 bg-emerald-400 z-10 pointer-events-none shadow-[0_0_8px_#10b981]"
                                  style={{
                                    left: `${(currentTime / duration) * 100}%`,
                                    transition: "none",
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Add Track Button */}
                    <div className="flex justify-center pt-2">
                      <button
                        onClick={addTrack}
                        className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-white transition border border-white/[0.05] rounded-sm px-4 py-2 hover:bg-white/[0.02]"
                      >
                        ➕ Add Empty Track
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Master Bus Channel Strip Mixer Sidebar panel */}
          <div className="xl:col-span-1 space-y-4">
            {/* Master Bus Mixer Strip */}
            <div className="bg-white/[0.01] border border-white/[0.05] rounded-sm p-5 backdrop-blur-md space-y-5">
              <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-white border-b border-white/[0.05] pb-2 flex items-center gap-2">
                <Sliders className="h-4 w-4 text-emerald-400" /> Master Out Bus
              </h2>

              {/* Master Volume and Stereo dynamic visualizer */}
              <div className="flex gap-4 items-stretch">
                {/* L/R canvas visualizer */}
                <canvas
                  ref={masterCanvasRef}
                  width="44"
                  height="120"
                  className="rounded-sm bg-black/40 border border-white/[0.05] shrink-0"
                />

                {/* DB volume controls */}
                <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground block">
                    Master Gain
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1.2"
                    step="0.05"
                    defaultValue="0.85"
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (masterGainRef.current) {
                        masterGainRef.current.gain.setValueAtTime(
                          val,
                          audioCtxRef.current!.currentTime,
                        );
                      }
                    }}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <span className="font-mono text-[8px] text-muted-foreground block text-center">
                    Gain dB Scale
                  </span>
                </div>
              </div>

              {/* Parametric EQ settings */}
              <div className="space-y-4 border-t border-white/[0.05] pt-4">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-white block">
                  Equalizer (Selected Channels)
                </span>

                {channels.map((ch) => (
                  <div
                    key={ch.key}
                    className="space-y-2 bg-[#040306]/20 p-3 rounded-sm border border-white/[0.02]"
                  >
                    <span
                      className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground block"
                      style={{ color: ch.color }}
                    >
                      {ch.name} EQ
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <span className="font-mono text-[8px] text-muted-foreground block text-center">
                          Low
                        </span>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          value={ch.eqLow}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setChannels((prev) =>
                              prev.map((c) => (c.key === ch.key ? { ...c, eqLow: val } : c)),
                            );
                          }}
                          className="w-full h-1 bg-white/10 rounded accent-pink-500"
                        />
                        <span className="font-mono text-[8px] text-white block text-center">
                          {ch.eqLow > 0 ? `+${ch.eqLow}` : ch.eqLow}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono text-[8px] text-muted-foreground block text-center">
                          Mid
                        </span>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          value={ch.eqMid}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setChannels((prev) =>
                              prev.map((c) => (c.key === ch.key ? { ...c, eqMid: val } : c)),
                            );
                          }}
                          className="w-full h-1 bg-white/10 rounded accent-amber-500"
                        />
                        <span className="font-mono text-[8px] text-white block text-center">
                          {ch.eqMid > 0 ? `+${ch.eqMid}` : ch.eqMid}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono text-[8px] text-muted-foreground block text-center">
                          High
                        </span>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          value={ch.eqHigh}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setChannels((prev) =>
                              prev.map((c) => (c.key === ch.key ? { ...c, eqHigh: val } : c)),
                            );
                          }}
                          className="w-full h-1 bg-white/10 rounded accent-emerald-400"
                        />
                        <span className="font-mono text-[8px] text-white block text-center">
                          {ch.eqHigh > 0 ? `+${ch.eqHigh}` : ch.eqHigh}
                        </span>
                      </div>

                      {/* FX Button */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOpenEffectsChannel(ch.key)}
                        className={`mt-2 w-full text-xs border-slate-700 hover:bg-slate-700 ${ch.effects.length > 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-slate-800 text-slate-400"}`}
                      >
                        FX {ch.effects.length > 0 && `(${ch.effects.length})`}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Master Dynamics & FX settings */}
              <div className="space-y-3 border-t border-white/[0.05] pt-4">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-white block">
                  Mastering Chain
                </span>

                <Button
                  variant="outline"
                  onClick={() => setOpenMasterEffects(true)}
                  className={`w-full ${masterEffects.length > 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-white/5 border-white/10 text-slate-300 hover:text-white hover:bg-white/10"}`}
                >
                  <Sliders className="w-4 h-4 mr-2" />
                  Master FX {masterEffects.length > 0 && `(${masterEffects.length})`}
                </Button>

                {/* Legacy Compressor/Limiter toggles */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="flex items-center justify-between p-2 rounded bg-white/5 border border-white/5">
                    <span className="font-mono text-[10px] text-muted-foreground uppercase">
                      Comp
                    </span>
                    <input
                      type="checkbox"
                      checked={compressorEnabled}
                      onChange={(e) => setCompressorEnabled(e.target.checked)}
                      className="w-6 h-3 bg-white/10 checked:bg-primary rounded cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-white/5 border border-white/5">
                    <span className="font-mono text-[10px] text-muted-foreground uppercase">
                      Limit
                    </span>
                    <input
                      type="checkbox"
                      checked={limiterEnabled}
                      onChange={(e) => setLimiterEnabled(e.target.checked)}
                      className="w-6 h-3 bg-white/10 checked:bg-primary rounded cursor-pointer accent-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Master Downmix WAV Export */}
              <button
                onClick={handleExportWav}
                disabled={exporting}
                className="w-full py-3 bg-white text-black font-mono text-xs uppercase tracking-widest font-black rounded-sm hover:bg-white/90 hover:scale-[1.02] active:scale-[0.98] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75 disabled:scale-100 shadow-lg shadow-white/5"
              >
                {exporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Bouncing Mix…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Export Combined Mix (WAV)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        {/* Modals and Overlays */}
        {voicePickerOpen &&
          // ... (Existing Voice Picker Modal logic, keep as is but we are at the end of the file so I can just append it before the end of DAWPage)
          null}

        {openEffectsChannel && (
          <TrackEffectsPanel
            channelName={channels.find((c) => c.key === openEffectsChannel)?.name || "Track"}
            effects={channels.find((c) => c.key === openEffectsChannel)?.effects || []}
            onEffectsChange={(newEffects) => {
              setChannels((prev) =>
                prev.map((c) => (c.key === openEffectsChannel ? { ...c, effects: newEffects } : c)),
              );
            }}
            onClose={() => setOpenEffectsChannel(null)}
          />
        )}
      </main>
    </div>
  );
}
