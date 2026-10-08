// Server-only data helpers for the influencer tracker API routes. Uses the
// service-role admin client like every sibling route; callers gate the session.
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCaller } from "@/lib/rbac-server";
import { computeHealth, isDealStage, isStageGroup, stageGroup, type HealthSettings } from "./health";
import { generateDealCode as genCode, pickKit } from "./normalize";
import type {
  DealDetail,
  DealHealth,
  DealListItem,
  DealStage,
  InfluencerSettings,
  KitRule,
} from "./types";

export { generateDealCode } from "./normalize";

export const DRAFTS_BUCKET = "influencer-drafts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ---- Auth ---------------------------------------------------------------------

type UserGate = { ok: true; user: User; actor: string } | { ok: false; response: NextResponse };

/** Session gate that also yields the caller (events record who acted). */
export async function requireUser(): Promise<UserGate> {
  const user = await getCaller();
  if (!user) return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true, user, actor: user.email ?? user.id };
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---- Settings -----------------------------------------------------------------

export const DEFAULT_SETTINGS: InfluencerSettings = {
  engine_enabled: false,
  digest_enabled: false,
  digest_hour_ist: 9,
  owner_wa_id: null,
  default_draft_due_days: 10,
  default_post_after_approval_days: 3,
  nudges: {
    brief_ack: { after_hours: [24, 48], escalate_after_hours: 72 },
    delivery_check: { after_days_from_dispatch: [4, 6], escalate_after_days: 8 },
    draft_due: { days_before_due: [2, 0], days_after_due: [1, 3], escalate_after_days: 5 },
    post_due: { days_before: [1], overdue_after_days: 2, ghosted_after_days: 7 },
  },
  team_sla: { brief_approval_hours: 24, dispatch_hours: 48, draft_review_hours: 24 },
  brief_focus: null,
  brief_focus_notes: null,
};

export async function getSettings(): Promise<InfluencerSettings> {
  const { data } = await supabaseAdmin.from("influencer_settings").select("*").eq("id", 1).maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    engine_enabled: !!data.engine_enabled,
    digest_enabled: !!data.digest_enabled,
    digest_hour_ist: data.digest_hour_ist ?? DEFAULT_SETTINGS.digest_hour_ist,
    owner_wa_id: data.owner_wa_id ?? null,
    default_draft_due_days: data.default_draft_due_days ?? DEFAULT_SETTINGS.default_draft_due_days,
    default_post_after_approval_days:
      data.default_post_after_approval_days ?? DEFAULT_SETTINGS.default_post_after_approval_days,
    nudges: data.nudges ?? DEFAULT_SETTINGS.nudges,
    team_sla: { ...DEFAULT_SETTINGS.team_sla, ...(data.team_sla ?? {}) },
    brief_focus: data.brief_focus ?? null,
    brief_focus_notes: data.brief_focus_notes ?? null,
  };
}

// ---- Deals ------------------------------------------------------------------

export const DEAL_SELECT =
  "*, influencer:influencers(id, handle, full_name, tier, followers, niche, phone), kit:influencer_kits(id, name)";

/** Raw deal row (with the DEAL_SELECT joins) -> DealListItem with computed health. */
export function withHealth(row: Record<string, unknown>, now: number, settings?: HealthSettings): DealListItem {
  const d = row as unknown as DealListItem;
  const h = computeHealth(d, now, settings);
  return { ...d, kit: d.kit ?? null, health: h.health, health_reason: h.reason, next_date: h.next_date };
}

export interface DealFilters {
  health?: DealHealth[];
  stage?: DealStage[];
  group?: string[];
  q?: string;
  influencer_id?: string;
  include_closed?: boolean;
}

const csv = (v: string | null) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function dealFiltersFrom(sp: URLSearchParams): DealFilters {
  const health = csv(sp.get("health")).filter((h): h is DealHealth =>
    ["overdue", "at_risk", "waiting_on_us", "on_track", "closed"].includes(h),
  );
  const stage = csv(sp.get("stage")).filter(isDealStage);
  const group = csv(sp.get("group")).filter(isStageGroup);
  return {
    health: health.length ? health : undefined,
    stage: stage.length ? stage : undefined,
    group: group.length ? group : undefined,
    q: (sp.get("q") ?? "").trim().toLowerCase().replace(/^@/, "") || undefined,
    include_closed: sp.get("closed") !== "0",
  };
}

export async function listDeals(filters: DealFilters = {}, settings?: InfluencerSettings): Promise<DealListItem[]> {
  const s = settings ?? (await getSettings());
  let query = supabaseAdmin.from("influencer_deals").select(DEAL_SELECT).order("created_at", { ascending: false }).limit(1000);
  if (filters.stage) query = query.in("stage", filters.stage);
  if (filters.influencer_id) query = query.eq("influencer_id", filters.influencer_id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const now = Date.now();
  let items = (data ?? []).map((r) => withHealth(r as Record<string, unknown>, now, s));
  if (filters.include_closed === false) items = items.filter((d) => d.health !== "closed");
  if (filters.health) items = items.filter((d) => filters.health!.includes(d.health));
  if (filters.group) items = items.filter((d) => filters.group!.includes(stageGroup(d.stage)));
  if (filters.q) {
    const q = filters.q;
    items = items.filter(
      (d) =>
        d.influencer?.handle?.toLowerCase().includes(q) ||
        (d.influencer?.full_name ?? "").toLowerCase().includes(q) ||
        d.code.toLowerCase() === q ||
        (d.shopify_order_name ?? "").toLowerCase().includes(q),
    );
  }
  return items;
}

export async function getDealRow(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin.from("influencer_deals").select(DEAL_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown>) ?? null;
}

export async function getDeal(id: string, settings?: InfluencerSettings): Promise<DealListItem | null> {
  const row = await getDealRow(id);
  if (!row) return null;
  return withHealth(row, Date.now(), settings ?? (await getSettings()));
}

export async function getDealDetail(id: string): Promise<DealDetail | null> {
  const deal = await getDeal(id);
  if (!deal) return null;
  const [address, briefs, drafts, reminders, events] = await Promise.all([
    supabaseAdmin.from("influencer_addresses").select("*").eq("influencer_id", deal.influencer_id).maybeSingle(),
    supabaseAdmin.from("influencer_briefs").select("*").eq("deal_id", id).order("version", { ascending: false }),
    supabaseAdmin.from("influencer_drafts").select("*").eq("deal_id", id).order("version", { ascending: false }),
    supabaseAdmin
      .from("influencer_reminders")
      .select("id, deal_id, kind, step, audience, channel, status, due_at, template_name, sent_at, last_error")
      .eq("deal_id", id)
      .order("due_at", { ascending: true }),
    supabaseAdmin
      .from("influencer_events")
      .select("*")
      .eq("deal_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const draftRows = (drafts.data ?? []) as DealDetail["drafts"];
  const signed = await Promise.all(
    draftRows.map(async (d) => {
      if (!d.storage_path) return { ...d, signed_url: null };
      const { data } = await supabaseAdmin.storage.from(DRAFTS_BUCKET).createSignedUrl(d.storage_path, 3600);
      return { ...d, signed_url: data?.signedUrl ?? null };
    }),
  );

  return {
    deal,
    address: (address.data as DealDetail["address"]) ?? null,
    briefs: (briefs.data ?? []) as DealDetail["briefs"],
    drafts: signed,
    reminders: (reminders.data ?? []) as DealDetail["reminders"],
    events: (events.data ?? []) as DealDetail["events"],
  };
}

/** Inserts a deal with a fresh portal code, retrying on the (astronomically rare) code collision. */
export async function insertDealWithCode(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  let lastErr = "could not create deal";
  for (let i = 0; i < 4; i++) {
    const { data, error } = await supabaseAdmin
      .from("influencer_deals")
      .insert({ ...row, code: genCode() })
      .select("id")
      .single();
    if (!error && data) return data as Record<string, unknown>;
    lastErr = error?.message ?? lastErr;
    if (error?.code !== "23505" || !/code/.test(error.message)) break;
  }
  throw new Error(lastErr);
}

// ---- Events -------------------------------------------------------------------

export async function logEvent(
  influencer_id: string,
  deal_id: string | null,
  type: string,
  channel: string | null,
  actor: string | null,
  summary: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("influencer_events")
    .insert({ influencer_id, deal_id, type, channel, actor, summary: summary.slice(0, 500), meta });
  // The timeline is a record, never a reason to fail the user's action.
  if (error) console.error("influencer_event_insert_failed", { influencer_id, deal_id, type, error: error.message });
}

// ---- Kits ---------------------------------------------------------------------

export async function suggestKit(followers: number | null | undefined, niche: string[] | null | undefined): Promise<string | null> {
  const [{ data: rules }, { data: kits }] = await Promise.all([
    supabaseAdmin.from("influencer_kit_rules").select("priority, min_followers, max_followers, niche, kit_id"),
    supabaseAdmin.from("influencer_kits").select("id, active"),
  ]);
  return pickKit((rules ?? []) as KitRule[], (kits ?? []) as { id: string; active: boolean }[], followers, niche);
}

// ---- Edge functions ----------------------------------------------------------

/**
 * Asks the `influencer-send` edge function (requireInternal, service-role
 * bearer, same as wa-template-create / wa-campaign-send callers) to message
 * the creator. Never throws: an engine-off or failed answer is returned so the
 * route can show "Engine off: copy link instead" without failing the action.
 */
export async function invokeInfluencerSend(
  body: { deal_id: string; kind: string; retry?: boolean } | { reminder_id: string },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/influencer-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 502, data: { error: e instanceof Error ? e.message : String(e) } };
  }
}
