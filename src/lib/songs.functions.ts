import { invoke } from "./bridge";

export type GenerateSongInput = {
  prompt: string;
  instrumental?: boolean;
  customLyrics?: string;
  /** Exactly 5 short sections, for engines with tight lyric limits. */
  compact?: boolean;
};

export type GeneratedSong = {
  title: string;
  style: string;
  lyrics: string;
  usedFallback?: boolean;
};

export const generateSong = ({ data }: { data: GenerateSongInput }) =>
  invoke<GeneratedSong>("lyrics:generate", data);
