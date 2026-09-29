"use client";

// Local autosave for the template creator, so closing the tab or the panel
// never loses work. localStorage only (per device); every access is wrapped
// in try/catch because storage can be blocked (private mode, policies).

import { useEffect } from "react";
import type { EditorDraft } from "@/lib/whatsapp/template-draft";

const PREFIX = "pm-wa-template-creator:v1:";

export type Autosaved = { draft: EditorDraft; step: number; savedAt: number };

/** "new" for a brand-new template, else the template id being edited. */
export function autosaveSlot(d: Pick<EditorDraft, "id" | "mode">): string {
  return d.mode === "new" || !d.id ? "new" : d.id;
}

export function readAutosave(slot: string): Autosaved | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + slot);
    if (!raw) return null;
    const v = JSON.parse(raw) as Autosaved;
    if (!v || typeof v !== "object" || !v.draft || typeof v.draft.body !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

export function clearAutosave(slot: string) {
  try { window.localStorage.removeItem(PREFIX + slot); } catch { /* storage blocked */ }
}

function writeAutosave(slot: string, v: Autosaved) {
  try { window.localStorage.setItem(PREFIX + slot, JSON.stringify(v)); } catch { /* storage blocked or full */ }
}

/** Debounced write of the draft while it differs from what was opened. */
export function useAutosave(slot: string | null, draft: EditorDraft | null, step: number, dirty: boolean) {
  useEffect(() => {
    if (!slot || !draft || !dirty) return;
    const t = setTimeout(() => {
      // Upload details are only for this session's size checks.
      writeAutosave(slot, { draft: { ...draft, header_media: null }, step, savedAt: Date.now() });
    }, 500);
    return () => clearTimeout(t);
  }, [slot, draft, step, dirty]);
}

export function savedAgo(at: number, now = Date.now()): string {
  const min = Math.round((now - at) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
