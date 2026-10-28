import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Profile } from "@shared/types";
import { invoke } from "@/lib/bridge";

// The desktop app is single-user: there is no sign-in. The "user" is the
// local profile from settings, kept so pages written for the hosted app work.

export type LocalUser = {
  id: "local";
  email: string;
  user_metadata: { full_name: string; username: string; avatar_url?: string };
};

type AuthCtx = {
  user: LocalUser | null;
  session: { user: LocalUser } | null;
  loading: boolean;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const toUser = (p: Profile): LocalUser => ({
  id: "local",
  email: `${p.username || "producer"}@local`,
  user_metadata: { full_name: p.displayName, username: p.username, avatar_url: p.avatarUrl },
});

const FALLBACK: Profile = { displayName: "Producer", username: "producer", bio: "" };

const Ctx = createContext<AuthCtx>({
  user: toUser(FALLBACK),
  session: { user: toUser(FALLBACK) },
  loading: false,
  profile: FALLBACK,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile>(FALLBACK);

  const refreshProfile = async () => {
    try {
      const s = await invoke<{ profile: Profile }>("settings:get");
      setProfile(s.profile);
    } catch {
      // keep fallback
    }
  };

  useEffect(() => {
    void refreshProfile();
  }, []);

  const user = useMemo(() => toUser(profile), [profile]);
  return (
    <Ctx.Provider
      value={{
        user,
        session: { user },
        loading: false,
        profile,
        refreshProfile,
        signOut: async () => {},
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
