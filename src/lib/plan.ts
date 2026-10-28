// The desktop edition has no plans or credits: every feature is unlocked.
export type Plan = {
  tier: "local";
  label: string;
  canUseMusic26: boolean;
  canCloneVoice: boolean;
  canExtractStems: boolean;
};

export const LOCAL_PLAN: Plan = {
  tier: "local",
  label: "Local",
  canUseMusic26: true,
  canCloneVoice: true,
  canExtractStems: true,
};

export function getPlanFromSubscription(_sub?: unknown): Plan {
  return LOCAL_PLAN;
}
