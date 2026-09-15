"use client";

// Per-viewer localStorage state for the Needs Attention page: snoozing an
// item (hides it from Open until tomorrow 09:00 local) and tracking which
// items disappeared from the API today so they can show under "Done today".
// This is a convenience layer only — nothing here is shared across devices
// or read back by the server, so every access is wrapped in try/catch.
//
// Open/snoozed/done are recomputed as plain values on every render straight
// from `items` + localStorage (both cheap and synchronously available) —
// not memoized, since the computation reads the clock and localStorage is
// impure input that a memo must not capture. `tick` exists only to force a
// re-render after a write; the two effects below only sync computed output
// back out to localStorage (an external system) and never call setState.
import { useCallback, useEffect, useState } from "react";
import type { AttentionItem } from "@/lib/metrics/attention";

const SNOOZE_KEY = "pm-attention-snooze";
const SEEN_KEY = "pm-attention-seen";

type SnoozeMap = Record<string, string>; // id -> untilISO
type SeenState = { date: string; items: Record<string, string> }; // id -> title
export type DoneItem = { id: string; title: string };
export type AttentionView = "open" | "snoozed" | "done";

function todayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota / disabled storage — snooze/done are a per-viewer
    // convenience only, never required for correctness.
  }
}

function tomorrowNine(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function nonExpiredSnooze(): SnoozeMap {
  const raw = readJSON<SnoozeMap>(SNOOZE_KEY, {});
  const now = Date.now();
  const kept: SnoozeMap = {};
  for (const [id, until] of Object.entries(raw)) {
    if (new Date(until).getTime() > now) kept[id] = until;
  }
  return kept;
}

export function useAttentionLocalState(items: AttentionItem[] | undefined) {
  const [view, setView] = useState<AttentionView>("open");
  // Bumped after a snooze write purely to force a re-render.
  const [, setTick] = useState(0);

  const snooze = nonExpiredSnooze();

  // Persist the pruned (non-expired-only) map back to storage.
  useEffect(() => {
    writeJSON(SNOOZE_KEY, snooze);
    // Re-runs only when the snooze contents actually change (items/tick
    // recompute above), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(snooze)]);

  // "Done today" = ids seen on an earlier load today that `items` no longer
  // contains. Reads the seen snapshot as it was *before* this load (the
  // effect below overwrites it with the current item set afterwards).
  const seenToday = readJSON<SeenState>(SEEN_KEY, { date: "", items: {} });
  const today = todayKey(new Date());
  const prevSeenItems = seenToday.date === today ? seenToday.items : {};
  const doneItems: DoneItem[] = items
    ? Object.entries(prevSeenItems)
        .filter(([id]) => !items.some((i) => i.id === id))
        .map(([id, title]) => ({ id, title }))
    : [];

  useEffect(() => {
    if (!items) return;
    const now = todayKey(new Date());
    const seen = readJSON<SeenState>(SEEN_KEY, { date: "", items: {} });
    const prev = seen.date === now ? seen.items : {};
    const next: Record<string, string> = { ...prev };
    for (const it of items) next[it.id] = it.title;
    writeJSON(SEEN_KEY, { date: now, items: next });
  }, [items]);

  const snoozeItem = useCallback((id: string) => {
    const raw = readJSON<SnoozeMap>(SNOOZE_KEY, {});
    raw[id] = tomorrowNine(new Date()).toISOString();
    writeJSON(SNOOZE_KEY, raw);
    setTick((t) => t + 1);
  }, []);

  const all = items ?? [];
  const openItems = all.filter((i) => !snooze[i.id]);
  const snoozedItems = all.filter((i) => !!snooze[i.id]);

  return { view, setView, openItems, snoozedItems, doneItems, snoozeItem };
}
