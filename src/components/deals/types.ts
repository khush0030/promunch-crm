// Deal types live in src/lib/deals/model.ts (shared with the API routes).
// Re-exported here so existing imports keep working.

export type {
  ActivityKind,
  Deal,
  DealActivity,
  DealDetailResponse,
  DealEmail,
  DealInsights,
  DealKind,
  DealSource,
  DealsResponse,
  DealStage,
  Direction,
  ScanState,
  TeamPerson,
  Temperature,
} from "@/lib/deals/model";
