// Per-user notification read state + preferences. PURE (no Supabase), shared
// by /api/notifications (GET), /api/me/notifications (PATCH) and the client.
//
// Stored in the caller's own auth user_metadata.notifications, so no
// migration is needed:
//   seen_at    ISO time of the last "Mark all read" (or first open)
//   read       ids opened one by one since then (short hashes, capped)
//   dismissed  ids hidden from the list (short hashes, capped)
// user_metadata rides in the session JWT on every request, so ids are stored
// as 7-character hashes and the lists stay short.
//   prefs      sound / browser pop-ups / which groups alert
// Unread = created_at > seen_at and not in read and not dismissed.

import type { NotifCategory, NotificationItem } from "./feed";

export type NotifPrefs = {
  sound: boolean;
  popups: boolean;
  needs_you: boolean;
  issues: boolean;
};

export type NotifState = {
  seen_at: string | null;
  read: string[];
  dismissed: string[];
  prefs: NotifPrefs;
};

export const DEFAULT_PREFS: NotifPrefs = { sound: true, popups: true, needs_you: true, issues: true };
export const ID_CAP = 100;
export const MAX_IDS_PER_CALL = 50;
const ID_MAX_LEN = 200;
const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof NotifPrefs)[];

// FNV-1a 32-bit, base36. Collisions only risk hiding/reading one item early.
export function shortId(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const cleanIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9a-z]{1,8}$/.test(x)).slice(-ID_CAP) : [];

// Whatever is in user_metadata -> a clean state (bad or missing keys fall back).
export function readNotifState(meta: Record<string, unknown> | null | undefined): NotifState {
  const raw = (meta?.notifications ?? {}) as Record<string, unknown>;
  const p = (raw.prefs ?? {}) as Record<string, unknown>;
  const prefs = { ...DEFAULT_PREFS };
  for (const k of PREF_KEYS) if (typeof p[k] === "boolean") prefs[k] = p[k] as boolean;
  return {
    seen_at: isIso(raw.seen_at) ? new Date(raw.seen_at).toISOString() : null,
    read: cleanIds(raw.read),
    dismissed: cleanIds(raw.dismissed),
    prefs,
  };
}

export type NotifPatch = {
  mark_all_read?: unknown;
  read?: unknown;
  dismiss?: unknown;
  prefs?: unknown;
};

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function idList(v: unknown, field: string): Checked<string[]> {
  if (!Array.isArray(v)) return { ok: false, error: `${field} must be a list of ids.` };
  if (v.length > MAX_IDS_PER_CALL) return { ok: false, error: `Send at most ${MAX_IDS_PER_CALL} ids at a time.` };
  for (const x of v) {
    if (typeof x !== "string" || !x || x.length > ID_MAX_LEN) return { ok: false, error: `${field} has an invalid id.` };
  }
  return { ok: true, value: (v as string[]).map(shortId) };
}

// Append, de-dup, keep the newest ID_CAP.
function merge(list: string[], add: string[]): string[] {
  const uniq = [...new Set(add)];
  const out = list.filter((x) => !uniq.includes(x));
  out.push(...uniq);
  return out.slice(-ID_CAP);
}

// Validate a PATCH body and apply it over the stored state. `now` is the
// server clock: "Mark all read" never trusts a client timestamp.
export function applyNotifPatch(state: NotifState, body: NotifPatch, now: Date): Checked<NotifState> {
  const keys = Object.keys(body);
  if (!keys.length) return { ok: false, error: "Nothing to save." };
  const unknown = keys.filter((k) => !["mark_all_read", "read", "dismiss", "prefs"].includes(k));
  if (unknown.length) return { ok: false, error: `Unknown field: ${unknown[0]}.` };

  const next: NotifState = { ...state, read: [...state.read], dismissed: [...state.dismissed], prefs: { ...state.prefs } };

  if ("mark_all_read" in body) {
    if (body.mark_all_read !== true) return { ok: false, error: "mark_all_read must be true." };
    next.seen_at = now.toISOString();
    next.read = []; // everything older than seen_at is read anyway
  }
  if ("read" in body) {
    const r = idList(body.read, "read");
    if (!r.ok) return r;
    next.read = merge(next.read, r.value);
  }
  if ("dismiss" in body) {
    const r = idList(body.dismiss, "dismiss");
    if (!r.ok) return r;
    next.dismissed = merge(next.dismissed, r.value);
  }
  if ("prefs" in body) {
    const p = body.prefs;
    if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, error: "prefs must be an object." };
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (!PREF_KEYS.includes(k as keyof NotifPrefs)) return { ok: false, error: `Unknown preference: ${k}.` };
      if (typeof v !== "boolean") return { ok: false, error: `${k} must be on or off.` };
      next.prefs[k as keyof NotifPrefs] = v;
    }
  }
  return { ok: true, value: next };
}

export function isUnread(item: Pick<NotificationItem, "id" | "created_at">, state: Pick<NotifState, "seen_at" | "read" | "dismissed">): boolean {
  const h = shortId(item.id);
  if (state.dismissed.includes(h) || state.read.includes(h)) return false;
  return !state.seen_at || item.created_at > state.seen_at;
}

export function visibleItems<T extends Pick<NotificationItem, "id">>(items: T[], state: Pick<NotifState, "dismissed">): T[] {
  return items.filter((i) => !state.dismissed.includes(shortId(i.id)));
}

export function categoryOn(prefs: NotifPrefs, c: NotifCategory): boolean {
  return c === "needs_you" ? prefs.needs_you : prefs.issues;
}

// Items that should ring right now: unread, in an alerting group, and not on
// the previous poll. `prevIds` null = first load, which only sets the
// baseline (opening the CRM never rings for what was already there).
export function freshAlerts<T extends Pick<NotificationItem, "id" | "created_at" | "category">>(
  prevIds: ReadonlySet<string> | null,
  items: T[],
  state: NotifState,
): T[] {
  if (!prevIds) return [];
  return items.filter((i) => !prevIds.has(i.id) && isUnread(i, state) && categoryOn(state.prefs, i.category));
}

// One sound per burst: true when the last ring was long enough ago.
export const SOUND_GAP_MS = 8000;
export function shouldRing(lastAt: number | null, now: number, gap = SOUND_GAP_MS): boolean {
  return lastAt == null || now - lastAt >= gap;
}

// "3m", "2h", "Yesterday", "4 Oct". Plain words for the list.
export function timeAgo(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}
