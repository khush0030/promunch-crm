// Shared types for the influencer delivery tracker. Mirrors
// supabase/migrations/018_influencers.sql. API routes return these shapes and
// the dashboard + portal consume them, so change both sides together.

export type InfluencerTier = "nano" | "micro" | "mid" | "macro";
export type InfluencerStatus = "active" | "paused" | "blocked";

export type DealStage =
  | "agreed"
  | "brief_draft"
  | "brief_sent"
  | "brief_acknowledged"
  | "dispatched"
  | "delivered"
  | "draft_submitted"
  | "changes_requested"
  | "draft_approved"
  | "posted"
  | "completed"
  | "cancelled"
  | "ghosted";

/** Board columns. Every open stage belongs to exactly one group. */
export type StageGroup = "briefing" | "shipping" | "creating" | "review" | "live" | "done";

export const STAGE_GROUP: Record<DealStage, StageGroup> = {
  agreed: "briefing",
  brief_draft: "briefing",
  brief_sent: "briefing",
  brief_acknowledged: "shipping",
  dispatched: "shipping",
  delivered: "creating",
  changes_requested: "creating",
  draft_submitted: "review",
  draft_approved: "live",
  posted: "live",
  completed: "done",
  cancelled: "done",
  ghosted: "done",
};

export type DealHealth = "overdue" | "at_risk" | "waiting_on_us" | "on_track" | "closed";

export type UsageRights = "none" | "organic_repost" | "partnership_ads";

export interface Deliverables {
  reels: number;
  stories: number;
  posts: number;
}

export interface Influencer {
  id: string;
  handle: string;
  ig_user_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  niche: string[];
  followers: number | null;
  engagement_rate: number | null;
  avg_views: number | null;
  tier: InfluencerTier | null;
  status: InfluencerStatus;
  discount_code: string | null;
  notes: string | null;
  last_contact_at: string | null;
  last_contact_channel: string | null;
  created_at: string;
  updated_at: string;
}

export interface InfluencerAddress {
  influencer_id: string;
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
}

export interface Reliability {
  deals_total: number;
  deals_completed: number;
  on_time_pct: number | null; // drafts submitted on/before draft_due_at, of those with a due date
  avg_days_late: number | null;
  ghosted: number;
  avg_revisions: number | null;
}

export interface InfluencerListItem extends Influencer {
  open_deals: number;
  reliability: Reliability;
}

export interface KitItem {
  variant_id: string;
  title: string;
  qty: number;
}

export interface Kit {
  id: string;
  name: string;
  description: string | null;
  items: KitItem[];
  cogs: number | null;
  active: boolean;
}

export interface KitRule {
  id: string;
  priority: number;
  min_followers: number | null;
  max_followers: number | null;
  niche: string | null;
  kit_id: string;
}

export interface Deal {
  id: string;
  influencer_id: string;
  code: string;
  type: "barter" | "paid" | "hybrid";
  stage: DealStage;
  deliverables: Deliverables;
  requires_draft_approval: boolean;
  usage_rights: UsageRights;
  usage_rights_days: number | null;
  kit_id: string | null;
  draft_due_days: number;
  shopify_order_id: string | null;
  shopify_order_name: string | null;
  order_status_url: string | null;
  agreed_at: string;
  brief_sent_at: string | null;
  brief_acknowledged_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  draft_due_at: string | null;
  draft_submitted_at: string | null;
  draft_approved_at: string | null;
  go_live_at: string | null;
  posted_at: string | null;
  post_url: string | null;
  completed_at: string | null;
  revision_count: number;
  views_24h: number | null;
  views_7d: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Deal as returned by list endpoints: joined creator + kit + computed health. */
export interface DealListItem extends Deal {
  influencer: Pick<Influencer, "id" | "handle" | "full_name" | "tier" | "followers" | "niche" | "phone">;
  kit: Pick<Kit, "id" | "name"> | null;
  health: DealHealth;
  health_reason: string | null; // e.g. "Draft due in 1 day"
  next_date: { label: string; at: string } | null; // the date the card shows
}

export interface BriefContent {
  concept: string;
  hooks: string[];
  script: string;
  talking_points: string[];
  must_say: string[];
  checklist: string[];
  donts: string[];
  format: { length_sec: number | null; aspect: string | null; stories: number | null };
  dates: { draft_due: string | null; go_live: string | null };
  usage_rights_text: string | null;
}

export type BriefStatus = "draft" | "approved" | "sent" | "superseded";

export interface Brief {
  id: string;
  deal_id: string;
  version: number;
  status: BriefStatus;
  content: BriefContent;
  generated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface DraftSubmission {
  id: string;
  deal_id: string;
  version: number;
  url: string | null;
  storage_path: string | null;
  signed_url?: string | null; // added by API when storage_path is set
  note: string | null;
  review_status: "pending" | "approved" | "changes_requested";
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string;
}

export interface Reminder {
  id: string;
  deal_id: string;
  kind: string;
  step: number;
  audience: "creator" | "team" | "owner";
  channel: "whatsapp" | "task";
  status: "scheduled" | "sending" | "sent" | "done" | "cancelled" | "failed";
  due_at: string;
  template_name: string | null;
  sent_at: string | null;
  last_error: string | null;
}

export interface InfluencerEvent {
  id: string;
  influencer_id: string;
  deal_id: string | null;
  type: string;
  channel: string | null;
  actor: string | null;
  summary: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface DealDetail {
  deal: DealListItem;
  address: InfluencerAddress | null;
  briefs: Brief[];
  drafts: DraftSubmission[];
  reminders: Reminder[];
  events: InfluencerEvent[];
}

export interface BoardSummary {
  due_today: number;
  overdue: number;
  at_risk: number;
  waiting_on_us: number;
  briefs_to_approve: number;
  drafts_to_review: number;
  kits_to_ship: number;
}

export interface InfluencerSettings {
  engine_enabled: boolean;
  digest_enabled: boolean;
  digest_hour_ist: number;
  owner_wa_id: string | null;
  default_draft_due_days: number;
  default_post_after_approval_days: number;
  nudges: Record<string, unknown>;
  team_sla: { brief_approval_hours: number; dispatch_hours: number; draft_review_hours: number };
}

/** What the public portal API returns for /c/[code]. Never includes address or phone. */
export interface PortalView {
  code: string;
  creator_name: string;
  handle: string;
  stage: DealStage;
  deliverables: Deliverables;
  kit: { name: string; items: { title: string; qty: number }[] } | null;
  brief: (Pick<Brief, "version" | "content" | "sent_at" | "acknowledged_at">) | null;
  draft_due_at: string | null;
  go_live_at: string | null;
  order_status_url: string | null;
  drafts: Pick<DraftSubmission, "version" | "url" | "note" | "review_status" | "review_note" | "submitted_at">[];
  post_url: string | null;
}
