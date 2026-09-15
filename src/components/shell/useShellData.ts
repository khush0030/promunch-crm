"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { OWNER_EMAIL, roleOfUser } from "@/lib/rbac";
import type { Attention } from "@/lib/metrics/attention";
import type { AttentionCounts } from "./nav";

// Badge counts for sidebar + tab bar. Failures leave badges empty.
export function useAttentionCounts(): AttentionCounts | null {
  const { data } = useQuery<Attention>({
    queryKey: ["attention"],
    queryFn: async () => {
      const r = await fetch("/api/metrics/attention", { cache: "no-store" });
      if (!r.ok) throw new Error(`attention ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });
  return data?.counts ?? null;
}

export type ShellUser = { email: string; name: string; role: string };

// Signed-in user + sign out (same Supabase logic as the old Sidebar).
export function useShellUser() {
  const router = useRouter();
  const [user, setUser] = useState<ShellUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const resolve = (
      u: { email?: string | null; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null,
    ) => {
      if (!u) return setUser(null);
      const meta = u.user_metadata || {};
      const name =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        (u.email ? u.email.split("@")[0] : "User");
      const r = roleOfUser(u);
      const role =
        (u.email ?? "").toLowerCase() === OWNER_EMAIL || r === "owner" ? "Owner" : r === "admin" ? "Admin" : "Member";
      setUser({ email: u.email || "", name, role });
    };
    supabase.auth.getUser().then(({ data }) => resolve(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => resolve(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return { user, signingOut, signOut };
}

export function initialsOf(user: ShellUser | null): string {
  return (user?.name || user?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// window.location.hash as a store. Next's router uses pushState (no
// hashchange), so the shell also re-reads it whenever it re-renders after a
// navigation or a nav click.
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
  };
}
export function useHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
}
