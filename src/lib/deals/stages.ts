// Deal stages, one vocabulary everywhere (board, list, drawer, filters, B2B
// overview). Owner-approved Oct 10 2026:
//   New -> Talking -> Samples -> Negotiating -> Won, plus Lost and On hold.
// Old DB names (before migration 20261010100000_deals_simplify.sql) are
// mapped on read so the app works before and after the migration.
// Pure: no I/O.

export type DealStage = "new" | "talking" | "samples" | "negotiating" | "won" | "lost" | "on_hold";

export type LegacyStage =
  | "new_inquiry"
  | "in_discussion"
  | "samples_requested"
  | "samples_sent"
  | "negotiation"
  | "won"
  | "lost"
  | "dormant";

/** The five live columns, left to right. */
export const PIPELINE_STAGES: DealStage[] = ["new", "talking", "samples", "negotiating", "won"];
/** Closing a deal as one of these asks for a short reason. */
export const CLOSED_STAGES: DealStage[] = ["lost", "on_hold"];
export const ALL_STAGES: DealStage[] = [...PIPELINE_STAGES, ...CLOSED_STAGES];
/** Still being worked (not won, not closed). */
export const OPEN_STAGES: DealStage[] = ["new", "talking", "samples", "negotiating"];

export const STAGE_LABEL: Record<DealStage, string> = {
  new: "New",
  talking: "Talking",
  samples: "Samples",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  on_hold: "On hold",
};

/** One line under the stage name, plain English. */
export const STAGE_HINT: Record<DealStage, string> = {
  new: "Just came in",
  talking: "Back and forth",
  samples: "Asked for or got samples",
  negotiating: "Prices and terms",
  won: "Ordering or live",
  lost: "Said no",
  on_hold: "Paused for now",
};

export type StageTone = "blue" | "teal" | "amber" | "purple" | "green" | "red" | "grey";

export const STAGE_TONE: Record<DealStage, StageTone> = {
  new: "blue",
  talking: "teal",
  samples: "amber",
  negotiating: "purple",
  won: "green",
  lost: "red",
  on_hold: "grey",
};

const LEGACY_TO_NEW: Record<LegacyStage, DealStage> = {
  new_inquiry: "new",
  in_discussion: "talking",
  samples_requested: "samples",
  samples_sent: "samples",
  negotiation: "negotiating",
  won: "won",
  lost: "lost",
  dormant: "on_hold",
};

const NEW_TO_LEGACY: Record<DealStage, LegacyStage> = {
  new: "new_inquiry",
  talking: "in_discussion",
  samples: "samples_requested",
  negotiating: "negotiation",
  won: "won",
  lost: "lost",
  on_hold: "dormant",
};

export function isStage(v: unknown): v is DealStage {
  return typeof v === "string" && (ALL_STAGES as string[]).includes(v);
}

/** Any stage name (new or old) to the new name; unknown -> null. */
export function normalizeStage(v: unknown): DealStage | null {
  if (isStage(v)) return v;
  if (typeof v === "string" && v in LEGACY_TO_NEW) return LEGACY_TO_NEW[v as LegacyStage];
  return null;
}

/** New name to the pre-migration DB name (fallback writes only). */
export function toLegacyStage(s: DealStage): LegacyStage {
  return NEW_TO_LEGACY[s];
}

export function isClosedStage(s: DealStage): boolean {
  return s === "lost" || s === "on_hold";
}

export function isOpenStage(s: DealStage): boolean {
  return (OPEN_STAGES as string[]).includes(s);
}

/** The stage after this one on the board, or null at Won / closed. */
export function nextStage(s: DealStage): DealStage | null {
  const i = PIPELINE_STAGES.indexOf(s);
  if (i < 0 || i >= PIPELINE_STAGES.length - 1) return null;
  return PIPELINE_STAGES[i + 1];
}
