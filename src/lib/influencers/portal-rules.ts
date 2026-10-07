// Pure rules for the public creator portal (/c/[code]) and its API
// (/api/public/collab/[code]/*): code format, stage ordering, which portal
// action is allowed at which stage, and upload/link validation. No I/O.

import { DEAL_CODE_RE } from "./normalize";
import type { DealStage } from "./types";

export const isValidPortalCode = (code: unknown): code is string =>
  typeof code === "string" && DEAL_CODE_RE.test(code);

/** Linear progress of an open deal. changes_requested ranks with draft_submitted's loop. */
export const STAGE_RANK: Record<DealStage, number> = {
  agreed: 0,
  brief_draft: 1,
  brief_sent: 2,
  brief_acknowledged: 3,
  dispatched: 4,
  delivered: 5,
  changes_requested: 6,
  draft_submitted: 7,
  draft_approved: 8,
  posted: 9,
  completed: 10,
  cancelled: -1,
  ghosted: -1,
};

export const isClosedStage = (s: DealStage) => s === "cancelled" || s === "ghosted";

/** True when `stage` is an open stage strictly before `target`. */
export const isBefore = (stage: DealStage, target: DealStage) =>
  !isClosedStage(stage) && STAGE_RANK[stage] < STAGE_RANK[target];

export type PortalAction = "ack" | "received" | "draft" | "post";

/** Stages where the action applies, and the stage it moves the deal to. */
export const PORTAL_TRANSITIONS: Record<PortalAction, { from: DealStage[]; to: DealStage }> = {
  ack: { from: ["brief_sent"], to: "brief_acknowledged" },
  received: { from: ["brief_acknowledged", "dispatched"], to: "delivered" },
  draft: { from: ["delivered", "changes_requested"], to: "draft_submitted" },
  post: { from: ["draft_approved"], to: "posted" },
};

export type TransitionDecision =
  | { kind: "apply"; to: DealStage }
  | { kind: "noop" } // already past this step: idempotent 200 with the current view
  | { kind: "reject"; error: string };

const TOO_EARLY: Record<PortalAction, string> = {
  ack: "Your brief is not ready yet. We will WhatsApp you as soon as it is.",
  received: "Please read the brief and tap \"I'm in\" first.",
  draft: "You can submit your draft once your box has arrived.",
  post: "Please wait for us to approve your draft before posting.",
};

export function decidePortalTransition(action: PortalAction, stage: DealStage): TransitionDecision {
  if (isClosedStage(stage)) return { kind: "reject", error: "This collab is closed. Message us on WhatsApp if this looks wrong." };
  const t = PORTAL_TRANSITIONS[action];
  if (t.from.includes(stage)) return { kind: "apply", to: t.to };
  if (STAGE_RANK[stage] >= STAGE_RANK[t.to]) return { kind: "noop" };
  // draft after changes_requested is the loop case, already covered by `from`.
  return { kind: "reject", error: TOO_EARLY[action] };
}

/** Stages from which a creator may ask for a change (anything open after the brief goes out). */
export const canRequestChange = (stage: DealStage) => !isClosedStage(stage) && STAGE_RANK[stage] >= STAGE_RANK.brief_sent;

// ---------------------------------------------------------------------------
// Uploads + links
// ---------------------------------------------------------------------------
export const DRAFT_BUCKET = "influencer-drafts";
export const MAX_DRAFT_BYTES = 200 * 1024 * 1024;

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "draft";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "draft";
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  return ext ? `${stem}.${ext}` : stem;
}

export function validateUpload(
  body: { filename?: unknown; size?: unknown; contentType?: unknown },
): { ok: true; filename: string; size: number; contentType: string } | { ok: false; error: string } {
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  const size = Number(body.size);
  if (!filename || filename.length > 200) return { ok: false, error: "Pick a video file to upload." };
  if (!/^video\/[a-z0-9.+-]+$/.test(contentType)) return { ok: false, error: "Only video files can be uploaded. For anything else, paste a link." };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "That file looks empty." };
  if (size > MAX_DRAFT_BYTES) return { ok: false, error: "That video is over 200 MB. Upload it to Google Drive and paste the link instead." };
  return { ok: true, filename, size, contentType };
}

/** Storage path for an upload: <deal_id>/<timestamp>-<safe name>. */
export const draftStoragePath = (dealId: string, filename: string, now = Date.now()) =>
  `${dealId}/${now}-${safeFileName(filename)}`;

/** A submitted storage path must live under this deal's folder and look like one we issued. */
export function isOwnStoragePath(dealId: string, path: unknown): path is string {
  if (typeof path !== "string" || path.length > 200) return false;
  if (path.includes("..") || path.includes("//")) return false;
  const prefix = `${dealId}/`;
  return path.startsWith(prefix) && /^\d{10,}-[A-Za-z0-9_.-]+$/.test(path.slice(prefix.length));
}

export function normaliseHttpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 1000) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** An instagram.com post / reel / tv link. */
export function normaliseInstagramPostUrl(v: unknown): string | null {
  const url = normaliseHttpUrl(v);
  if (!url) return null;
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;
  if (!/^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/.test(u.pathname)) return null;
  u.protocol = "https:";
  u.search = "";
  u.hash = "";
  return u.toString();
}

export function cleanNote(v: unknown, max = 1000): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const s = v.replace(/\u0000/g, "").trim();
  return s ? s.slice(0, max) : null;
}
