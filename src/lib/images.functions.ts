import { invoke } from "./bridge";

export const generateCoverArt = ({ data }: { data: { prompt: string; style?: string } }) =>
  invoke<{ imageUrl?: string }>("images:cover", data);
