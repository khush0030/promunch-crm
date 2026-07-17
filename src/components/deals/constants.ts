import type { BadgeTone } from "@/components/pm";
import type { DealKind, DealStage } from "./types";

export const STAGE_LABEL: Record<DealStage, string> = {
  new_inquiry: "New inquiry",
  in_discussion: "In discussion",
  samples_requested: "Samples requested",
  samples_sent: "Samples sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  dormant: "Dormant",
};

// Columns on the kanban board, left to right. Lost/dormant live in the
// table view only so the board stays about live revenue.
export const BOARD_STAGES: DealStage[] = [
  "new_inquiry",
  "in_discussion",
  "samples_requested",
  "samples_sent",
  "negotiation",
  "won",
];

export const ALL_STAGES: DealStage[] = [...BOARD_STAGES, "lost", "dormant"];

export const STAGE_TONE: Record<DealStage, BadgeTone> = {
  new_inquiry: "blue",
  in_discussion: "gold",
  samples_requested: "gold",
  samples_sent: "blue",
  negotiation: "gold",
  won: "green",
  lost: "terra",
  dormant: "gray",
};

export const KIND_LABEL: Record<DealKind, string> = {
  hotel_hospitality: "Hotel",
  corporate_pantry_gifting: "Corporate",
  retail_qcommerce: "Retail / q-comm",
  distribution_wholesale: "Distribution",
  influencer_collab: "Influencer",
  brand_partnership: "Partnership",
  events_expo: "Event / expo",
  vendor_pitch: "Vendor pitch",
  other: "Other",
};

export const KIND_TONE: Record<DealKind, BadgeTone> = {
  hotel_hospitality: "blue",
  corporate_pantry_gifting: "green",
  retail_qcommerce: "gold",
  distribution_wholesale: "green",
  influencer_collab: "terra",
  brand_partnership: "terra",
  events_expo: "gray",
  vendor_pitch: "gray",
  other: "gray",
};

export const ALL_KINDS = Object.keys(KIND_LABEL) as DealKind[];

// Vendor pitches are excluded from the default pipeline view; they get
// their own filter chip so the board stays about revenue.
export const DEFAULT_HIDDEN_KINDS: DealKind[] = ["vendor_pitch"];
