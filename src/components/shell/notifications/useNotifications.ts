"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationItem } from "@/lib/notifications/feed";
import type { NotifPrefs } from "@/lib/notifications/state";

export type FeedItem = NotificationItem & { unread: boolean };
export type Feed = {
  generated_at: string;
  items: FeedItem[];
  unread: number;
  seen_at: string | null;
  prefs: NotifPrefs;
};

export const FEED_KEY = ["notifications"] as const;
// 45s poll. React Query pauses interval refetches while the tab is hidden
// (refetchIntervalInBackground defaults to false) and catches up on return.
const POLL_MS = 45_000;

export function useNotificationFeed() {
  return useQuery<Feed>({
    queryKey: FEED_KEY,
    queryFn: async () => {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) throw new Error(`notifications ${r.status}`);
      return r.json();
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

type Patch = { mark_all_read?: true; read?: string[]; dismiss?: string[]; prefs?: Partial<NotifPrefs> };

function applyLocal(feed: Feed, p: Patch): Feed {
  let items = feed.items;
  let seen_at = feed.seen_at;
  if (p.mark_all_read) {
    seen_at = new Date().toISOString();
    items = items.map((i) => ({ ...i, unread: false }));
  }
  if (p.read) items = items.map((i) => (p.read!.includes(i.id) ? { ...i, unread: false } : i));
  if (p.dismiss) items = items.filter((i) => !p.dismiss!.includes(i.id));
  const prefs = p.prefs ? { ...feed.prefs, ...p.prefs } : feed.prefs;
  return { ...feed, items, seen_at, prefs, unread: items.filter((i) => i.unread).length };
}

// Read state + preferences. Optimistic: the list updates at once; a failed
// save rolls back on the next fetch.
export function useNotificationActions() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (p: Patch) => {
      const r = await fetch("/api/me/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Could not save.");
      return j;
    },
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: FEED_KEY });
      const prev = qc.getQueryData<Feed>(FEED_KEY);
      if (prev) qc.setQueryData<Feed>(FEED_KEY, applyLocal(prev, p));
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(FEED_KEY, ctx.prev);
    },
  });
  const { mutate, mutateAsync } = m;
  return {
    markAllRead: useCallback(() => mutate({ mark_all_read: true }), [mutate]),
    markRead: useCallback((id: string) => mutate({ read: [id] }), [mutate]),
    dismiss: useCallback((id: string) => mutate({ dismiss: [id] }), [mutate]),
    savePrefs: useCallback((prefs: Partial<NotifPrefs>) => mutateAsync({ prefs }), [mutateAsync]),
  };
}

// Browser pop-up permission as a store: re-read after we ask and whenever the
// tab comes back (the user may have changed it in site settings).
const PERM_EVENT = "pm:notif-permission";
type Perm = NotificationPermission | "unsupported";
function subscribePerm(cb: () => void) {
  window.addEventListener(PERM_EVENT, cb);
  document.addEventListener("visibilitychange", cb);
  return () => {
    window.removeEventListener(PERM_EVENT, cb);
    document.removeEventListener("visibilitychange", cb);
  };
}
const readPerm = (): Perm => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
export function usePopupPermission(): Perm {
  return useSyncExternalStore(subscribePerm, readPerm, () => "unsupported");
}
// Must be called from a click: browsers ignore permission asks without one.
export async function requestPopupPermission(): Promise<Perm> {
  if (typeof Notification === "undefined") return "unsupported";
  const p = await Notification.requestPermission();
  window.dispatchEvent(new Event(PERM_EVENT));
  return p;
}
