import { db } from "./db";
import { startJob, sleep } from "./jobs";
import { readMedia, saveBytes, saveFromUrl } from "./media";
import { providerConfig } from "./settings";
import { createPrediction, firstOutputUrl, getPrediction, toReplicateUrl } from "./replicate";

// Voice cloning: train an RVC model from a voice reference and apply it to a
// vocal stem. Runs on Replicate (zsxkib/train-rvc-model + RVC inference).

const TRAIN_VERSION =
  "replicate/train-rvc-model:0397d5e28c9b54665e1e5d29d5cf4f722a7b89ec20e9dbf31487235305b1a101";
const INFER_VERSION =
  "pseudoram/rvc-v2:0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550";
const STALE_MS = 30 * 60 * 1000;

function token() {
  const t = providerConfig("replicate").config.apiKey;
  if (!t)
    throw new Error(
      "Voice cloning runs on Replicate. Add your Replicate token in Settings → Engines.",
    );
  return t;
}

async function buildDatasetZip(audioUrl: string, voiceRefId: string) {
  const JSZip = (await import("jszip")).default;
  const { bytes } = await readMedia(audioUrl);
  const zip = new JSZip();
  zip.file(`dataset/voice_${voiceRefId.slice(0, 8)}/split_0.wav`, bytes);
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 5 },
  });
  return saveBytes(buf, "dataset.zip", "voice-datasets").url;
}

export function startRvcTraining(voiceRefId: string) {
  const t = token();
  const voice = db.get("voice_references", voiceRefId);
  if (!voice) throw new Error("Voice reference not found");
  db.update("voice_references", voiceRefId, {
    training_status: "pending",
    training_started_at: Date.now(),
  });

  startJob(
    "voice-train",
    async (ctx) => {
      db.update("voice_references", voiceRefId, { training_status: "preparing" });
      ctx.progress(-1, "Building dataset…");
      const zipUrl = await toReplicateUrl(t, await buildDatasetZip(voice.audio_url, voiceRefId));
      let pred = await createPrediction(t, TRAIN_VERSION, { dataset_zip: zipUrl, epoch: 100 });
      db.update("voice_references", voiceRefId, {
        training_status: "training",
        training_prediction_id: pred.id,
      });
      while (
        pred.status !== "succeeded" &&
        pred.status !== "failed" &&
        pred.status !== "canceled"
      ) {
        await sleep(10_000, ctx.signal);
        pred = await getPrediction(t, pred.id);
        ctx.progress(-1, `Training voice model (${pred.status})…`);
      }
      if (pred.status !== "succeeded") throw new Error(pred.error || "Voice training failed");
      const modelUrl = firstOutputUrl(pred.output);
      if (!modelUrl) throw new Error("Training returned no model");
      // Keep the URL Replicate gives us (inference downloads from it) and a local copy.
      const local = await saveFromUrl(
        modelUrl,
        `voice_${voiceRefId.slice(0, 8)}.zip`,
        "voice-models",
      ).catch(() => null);
      db.update("voice_references", voiceRefId, {
        training_status: "completed",
        rvc_model_url: modelUrl,
        rvc_model_local_url: local?.url ?? null,
      });
      return { modelUrl };
    },
    { onError: () => db.update("voice_references", voiceRefId, { training_status: "failed" }) },
  );
  return { ok: true };
}

export async function startVocalTransform(data: {
  songId: string;
  vocalStemUrl: string;
  voiceReferenceId: string;
}) {
  const t = token();
  const voice = db.get("voice_references", data.voiceReferenceId);
  if (!voice) throw new Error("Voice reference not found");

  if (!voice.rvc_model_url) {
    const inProgress = ["pending", "training", "preparing"].includes(voice.training_status);
    const startedAt = voice.training_started_at ?? Date.parse(voice.created_at);
    if (inProgress && Date.now() - startedAt < STALE_MS)
      throw new Error("VOICE_TRAINING_IN_PROGRESS");
    startRvcTraining(data.voiceReferenceId);
    throw new Error("VOICE_TRAINING_STARTED");
  }

  const job = startJob("voice-transform", async (ctx) => {
    ctx.progress(-1, "Uploading vocals…");
    const songInput = await toReplicateUrl(t, data.vocalStemUrl);
    let pred = await createPrediction(t, INFER_VERSION, {
      song_input: songInput,
      rvc_model: "CUSTOM",
      custom_rvc_model_download_url: voice.rvc_model_url,
      pitch_change: "no-change",
      index_rate: 0.5,
      filter_radius: 3,
      rms_mix_rate: 0.25,
      protect: 0.33,
      output_format: "mp3",
    });
    while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
      await sleep(3000, ctx.signal);
      pred = await getPrediction(t, pred.id);
      ctx.progress(-1, "Transforming vocals…");
    }
    if (pred.status !== "succeeded") throw new Error(pred.error || "Voice transformation failed");
    const url = firstOutputUrl(pred.output);
    if (!url) throw new Error("No output returned");
    const saved = await saveFromUrl(url, `${data.songId}-transformed-vocals.mp3`, "stems");
    const song = db.get("songs", data.songId);
    if (song)
      db.update("songs", data.songId, {
        stems: { ...(song.stems ?? {}), transformed_vocals: saved.url },
      });
    return { transformedVocalsUrl: saved.url };
  });
  return { predictionId: job.id };
}

export function resetVoiceTrainingStatus(voiceRefId: string) {
  db.update("voice_references", voiceRefId, {
    training_status: null,
    training_prediction_id: null,
  });
  return { ok: true };
}
