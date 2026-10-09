// Display constants for the Deals screens. Stage names, kinds and sources
// come from src/lib/deals (one vocabulary for the API and every screen).

import type { TagTone } from "@/components/pm";
import { ALL_STAGES, PIPELINE_STAGES, STAGE_HINT, STAGE_LABEL, STAGE_TONE, type DealStage } from "@/lib/deals/stages";
import { ALL_KINDS, KIND_LABEL, KIND_TONE, SOURCE_LABEL, SOURCE_TONE, type DealKind, type Temperature } from "@/lib/deals/model";

export { ALL_STAGES, PIPELINE_STAGES, STAGE_HINT, STAGE_LABEL, STAGE_TONE, ALL_KINDS, KIND_LABEL, KIND_TONE, SOURCE_LABEL, SOURCE_TONE };

/** @deprecated kept for the B2B overview; same as PIPELINE_STAGES. */
export const BOARD_STAGES: DealStage[] = PIPELINE_STAGES;

// "How keen they seem", read by the inbox scan from their emails.
export const KEEN_LABEL: Record<Temperature, string> = { hot: "High", warm: "Medium", cool: "Low" };
export const KEEN_TONE: Record<Temperature, TagTone> = { hot: "green", warm: "amber", cool: "grey" };

// Selling-to-us pitches are hidden from the default view so the board stays
// about revenue; pick "Selling to us" in the Type filter to see them.
export const DEFAULT_HIDDEN_KINDS: DealKind[] = ["vendor_pitch"];

// Cafes and restaurants are the priority segment: they sort first.
export const PRIORITY_KIND: DealKind = "hotel_hospitality";

/**
 * @deprecated Compatibility for src/app/dashboard/leads/page.tsx (B2B area):
 * maps the new stages onto its old summary buckets. New code should use
 * isOpenStage / OPEN_STAGES from src/lib/deals/stages.
 */
export type Bucket = "inquiries" | "discussions" | "samples" | "orders" | "closed";
export const BUCKET_OF: Record<DealStage, Bucket> = {
  new: "inquiries",
  talking: "discussions",
  negotiating: "discussions",
  samples: "samples",
  won: "orders",
  lost: "closed",
  on_hold: "closed",
};

export const ALL_KIND_OPTIONS: { value: DealKind; label: string }[] = ALL_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));
export const ALL_STAGE_OPTIONS: { value: DealStage; label: string }[] = ALL_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }));
