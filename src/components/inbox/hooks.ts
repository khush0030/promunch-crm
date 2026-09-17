"use client";

// Small client hooks shared by the WhatsApp and Instagram conversation views.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { TeamMember } from "@/components/whatsapp/types";

/** Signed-in user's email from the Supabase browser session (same source as the shell). */
export function useMeEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let live = true;
    supabase.auth.getUser().then(({ data }) => {
      if (live) setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (live) setEmail(session?.user?.email ?? null);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return email;
}

/** Team roster for the assign menu. Cached for the session. */
export function useTeamMembers(): TeamMember[] {
  const { data } = useQuery({
    queryKey: ["team-members"],
    queryFn: async (): Promise<TeamMember[]> => {
      const r = await fetch("/api/team");
      if (!r.ok) return [];
      const j = await r.json();
      return (j.users ?? []) as TeamMember[];
    },
    staleTime: 5 * 60_000,
  });
  return data ?? [];
}

/**
 * Keep the transcript scrolled to the bottom: on first paint of a thread,
 * and when a NEW message arrives while the reader is already near the
 * bottom. A background poll never yanks the reader away from old messages.
 */
export function useStickToBottom(ref: RefObject<HTMLDivElement | null>, threadId: string, lastKey: string) {
  const seen = useRef<{ id: string; key: string | null }>({ id: threadId, key: null });
  useEffect(() => {
    if (seen.current.id !== threadId) seen.current = { id: threadId, key: null };
    const el = ref.current;
    // No transcript mounted yet (skeleton render): keep "first" pending.
    if (!el) return;
    const first = seen.current.key === null;
    const changed = seen.current.key !== lastKey;
    seen.current.key = lastKey;
    if (!first && !changed) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (first || nearBottom) {
      const t = setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: first ? "auto" : "smooth" }), 50);
      return () => clearTimeout(t);
    }
  }, [ref, threadId, lastKey]);
}
