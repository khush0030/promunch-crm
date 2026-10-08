"use client";
import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { accessOf, type Access } from "@/lib/access";
import { useHydrated } from "./useShellData";

// The signed-in user's areas (lib/access.ts). Null while loading. getUser()
// asks the auth server, so an admin's change shows up on the next load instead
// of waiting for the session token to refresh. The middleware is what actually
// enforces access; this only hides what it would refuse.
export function useAccess(): Access | null {
  const hydrated = useHydrated();
  const { data } = useQuery({
    queryKey: ["me-access"],
    queryFn: async () => {
      const { data } = await createSupabaseBrowserClient().auth.getUser();
      return accessOf(data.user);
    },
    staleTime: 60_000,
  });
  return hydrated ? (data ?? null) : null;
}
