import type { MusicEngine, MusicRequest } from "@shared/types";
import { invoke, waitForJob } from "./bridge";

export const listMusicEngines = () => invoke<MusicEngine[]>("music:engines");

export const startMusic = (req: MusicRequest) => invoke<{ jobId: string }>("music:start", req);

export const activeMusicJob = (songId: string) =>
  invoke<string | null>("music:activeJob", { songId });

export const waitForMusic = (jobId: string, onProgress?: Parameters<typeof waitForJob>[1]) =>
  waitForJob<{ audioUrl: string }>(jobId, onProgress);
