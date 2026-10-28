// Credits do not exist in the desktop edition. This stub keeps the hosted
// app's components compiling; balance is always "unlimited" (null).
export function useCredits() {
  return {
    balance: null as number | null,
    subscription: null as unknown,
    loading: false,
    error: null as string | null,
    refresh: async () => {},
  };
}
