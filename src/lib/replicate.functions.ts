import type { Job } from "@shared/types";
import { invoke } from "./bridge";

// Stem separation and voice tools. Names and shapes match the hosted app's
// server functions so the pages that call them did not need to change; the
// "predictionId" is now a local job id.

type StemResult = { instrumentalUrl: string; stems: Record<string, string> };

export const startStemExtraction = ({ data }: { data: { audioUrl: string; songId: string } }) =>
  invoke<{ isDemo: boolean; predictionId: string | null }>("stems:start", data);

export const pollStemExtraction = async ({
  data,
}: {
  data: { predictionId: string | null; songId: string; isDemo?: boolean };
}) => {
  const job = data.predictionId
    ? await invoke<Job<StemResult> | null>("jobs:get", { id: data.predictionId })
    : null;
  if (!job) throw new Error("EXTRACTION_FAILED");
  if (job.status === "succeeded" && job.result)
    return { status: "succeeded" as const, ...job.result };
  if (job.status === "failed" || job.status === "canceled") {
    console.error("Stem extraction failed:", job.error);
    throw new Error(job.error ? `EXTRACTION_FAILED: ${job.error}` : "EXTRACTION_FAILED");
  }
  return { status: "processing" as const, progress: job.progress, message: job.message };
};

export const clearStems = ({ data }: { data: { songId: string } }) =>
  invoke<{ ok: boolean }>("stems:clear", data);

export const startVocalTransform = ({
  data,
}: {
  data: { songId: string; vocalStemUrl: string; voiceReferenceId: string };
}) => invoke<{ predictionId: string }>("voice:transform", data);

export const pollVocalTransform = async ({
  data,
}: {
  data: { predictionId: string; songId: string };
}) => {
  const job = await invoke<Job<{ transformedVocalsUrl: string }> | null>("jobs:get", {
    id: data.predictionId,
  });
  if (!job) throw new Error("RVC_TRANSFORM_FAILED");
  if (job.status === "succeeded" && job.result) {
    return { status: "completed" as const, transformedVocalsUrl: job.result.transformedVocalsUrl };
  }
  if (job.status === "failed" || job.status === "canceled") {
    return { status: "failed" as const, error: job.error ?? "Voice transformation failed" };
  }
  return { status: "processing" as const };
};

export const startRvcTraining = ({ data }: { data: { voiceRefId: string } }) =>
  invoke<{ ok: boolean }>("voice:train", data);

export const resetVoiceTrainingStatus = ({ data }: { data: { voiceRefId: string } }) =>
  invoke<{ ok: boolean }>("voice:reset", data);
