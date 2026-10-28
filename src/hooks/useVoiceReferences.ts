import { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/local-db";
import { useAuth } from "@/hooks/useAuth";
import { invoke } from "@/lib/bridge";

export type VoiceReference = {
  id: string;
  name: string;
  featureId: string;
  audioUrl: string;
  trainingStatus?: string | null;
  rvcModelUrl?: string | null;
  createdAt: number;
};

const STALE_MS = 30 * 60 * 1000; // 30 minutes

export function useVoiceReferences() {
  const { user } = useAuth();
  const [voices, setVoices] = useState<VoiceReference[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVoices = useCallback(async () => {
    if (!user) {
      setVoices([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await db
        .from("voice_references")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const now = Date.now();
      const mapped = (data ?? []).map((v: any) => {
        let status = v.training_status;
        const age = now - (v.created_at ? new Date(v.created_at).getTime() : now);

        // Client-side: treat stale training as null so UI doesn't show "Training..."
        // The server-side startVocalTransform also handles this for actual DB resets
        if (status && ["pending", "training", "preparing"].includes(status) && age > STALE_MS) {
          status = null;
        }

        return {
          id: v.id,
          name: v.name,
          featureId: v.feature_id,
          audioUrl: v.audio_url,
          trainingStatus: status,
          rvcModelUrl: v.rvc_model_url,
          createdAt: v.created_at ? new Date(v.created_at).getTime() : now,
        };
      });

      setVoices(mapped);
    } catch (err) {
      console.error("useVoiceReferences failed:", err);
      setVoices([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

  const refresh = useCallback(() => {
    fetchVoices();
  }, [fetchVoices]);

  const addVoice = async (voice: Omit<VoiceReference, "id" | "createdAt">) => {
    if (!user) throw new Error("Sign in required");
    const { data, error } = await db
      .from("voice_references")
      .insert({
        name: voice.name,
        feature_id: voice.featureId,
        audio_url: voice.audioUrl,
        user_id: user.id,
      })
      .select()
      .single();

    if (data && !error) {
      const fresh = {
        id: data.id,
        name: data.name,
        featureId: data.feature_id,
        audioUrl: data.audio_url,
        createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
      };
      setVoices((prev) => [fresh, ...prev]);
      return fresh;
    }
    throw error || new Error("Failed to save voice reference");
  };

  const removeVoice = async (id: string) => {
    const target = voices.find((v) => v.id === id);
    setVoices((prev) => prev.filter((v) => v.id !== id));
    await db.from("voice_references").delete().eq("id", id);
    if (target?.audioUrl) {
      await invoke("storage:remove", { urls: [target.audioUrl] }).catch(() => {});
    }
  };

  // Reset a stuck/failed voice — optimistic UI + client-side DB update
  const resetTrainingStatus = async (id: string) => {
    setVoices((prev) =>
      prev.map((v) => (v.id === id ? { ...v, trainingStatus: null, rvcModelUrl: null } : v)),
    );
    // Try client-side DB reset (may fail due to RLS, that's okay —
    // server-side startVocalTransform also handles stale resets)
    try {
      await db
        .from("voice_references")
        .update({ training_status: null, training_prediction_id: null })
        .eq("id", id);
    } catch (e) {
      console.warn(
        "[resetTrainingStatus] client-side reset failed (RLS), server will handle it:",
        e,
      );
    }
  };

  return { voices, addVoice, removeVoice, resetTrainingStatus, refresh, loading };
}
