// Server-only helpers for WhatsApp campaign journeys (follow-ups).
// A follow-up is a wa_campaigns row with followup_of = parent id; see
// promunch-email-agent/supabase/migrations/20260930120000_wa_campaign_followups.sql
// and the engine (wa-campaign-send). Pure rules live in src/lib/wa-campaigns.ts.
import { supabaseAdmin } from "@/lib/supabase-admin";

export const TEMPLATE_JOIN =
  "*, template:wa_templates(id,name,language,category,status,body,header_type,header_text,header_media_url,buttons)";

export type CampaignRow = Record<string, unknown> & {
  id: string;
  status: string;
  followup_of?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  template_id?: string | null;
};

const MAX_LEVELS = 6; // depth is capped at 3 by the API; this only bounds loops

// Every descendant of `id` (not including it), level by level.
export async function descendants(id: string, select = "id,status,followup_of,started_at,template_id"): Promise<CampaignRow[]> {
  const out: CampaignRow[] = [];
  const seen = new Set<string>([id]);
  let frontier = [id];
  for (let level = 0; level < MAX_LEVELS && frontier.length; level++) {
    const { data, error } = await supabaseAdmin.from("wa_campaigns").select(select).in("followup_of", frontier);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as CampaignRow[]).filter((r) => !seen.has(r.id));
    rows.forEach((r) => seen.add(r.id));
    out.push(...rows);
    frontier = rows.map((r) => r.id);
  }
  return out;
}

// Walk up to the journey root.
export async function journeyRoot(id: string): Promise<CampaignRow | null> {
  let cur: string | null = id;
  const seen = new Set<string>();
  let row: CampaignRow | null = null;
  for (let i = 0; i < MAX_LEVELS && cur && !seen.has(cur); i++) {
    seen.add(cur);
    const { data, error }: { data: unknown; error: { message: string } | null } = await supabaseAdmin
      .from("wa_campaigns").select("id,status,followup_of,started_at,template_id,repeat_rule,created_at").eq("id", cur).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return row; // dangling link: the last row found is the root
    row = data as CampaignRow;
    cur = row.followup_of ?? null;
  }
  return row;
}

// depth of `id` in its journey (root = 0)
export async function journeyDepth(id: string): Promise<number> {
  let depth = 0;
  let cur: string | null = id;
  const seen = new Set<string>();
  for (let i = 0; i < MAX_LEVELS && cur && !seen.has(cur); i++) {
    seen.add(cur);
    const { data }: { data: { followup_of: string | null } | null } = await supabaseAdmin
      .from("wa_campaigns").select("followup_of").eq("id", cur).maybeSingle();
    cur = data?.followup_of ?? null;
    if (cur) depth++;
  }
  return depth;
}

// Every message in the journey containing `id` (root + all follow-ups).
export async function journeyMessages(id: string): Promise<
  { id: string; template_id: string | null; template_vars: Record<string, unknown> | null; header_media_url: string | null }[]
> {
  const root = await journeyRoot(id);
  if (!root) return [];
  const ids = [root.id, ...(await descendants(root.id, "id")).map((d) => d.id)];
  const { data, error } = await supabaseAdmin.from("wa_campaigns")
    .select("id,template_id,template_vars,header_media_url").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; template_id: string | null; template_vars: Record<string, unknown> | null; header_media_url: string | null }[];
}

// The template's own header picture (the default when no override is set).
export async function templateDefaultMedia(templateId: string | null | undefined): Promise<string | null> {
  if (!templateId) return null;
  const { data } = await supabaseAdmin.from("wa_templates").select("header_media_url").eq("id", templateId).maybeSingle();
  return (data?.header_media_url as string | null | undefined) ?? null;
}

// Launching / scheduling a campaign arms its draft follow-ups, recursively
// ('draft' -> 'scheduled'). Armed steps start from their parent via the
// wa-campaign-worker; nothing is sent here.
export async function armFollowups(id: string): Promise<number> {
  const ds = await descendants(id);
  const ids = ds.filter((d) => d.status === "draft").map((d) => d.id);
  if (!ids.length) return 0;
  const { data, error } = await supabaseAdmin.from("wa_campaigns")
    .update({ status: "scheduled", resume_at: null }).in("id", ids).eq("status", "draft").select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

// Un-scheduling a campaign (scheduled -> draft) disarms follow-ups that
// never started.
export async function disarmFollowups(id: string): Promise<number> {
  const ds = await descendants(id);
  const ids = ds.filter((d) => d.status === "scheduled" && !d.started_at).map((d) => d.id);
  if (!ids.length) return 0;
  const { data, error } = await supabaseAdmin.from("wa_campaigns")
    .update({ status: "draft", resume_at: null }).in("id", ids).eq("status", "scheduled").is("started_at", null).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

// Cancel cascades to every non-finished follow-up below it.
export async function cancelDescendants(id: string): Promise<number> {
  const ds = await descendants(id);
  const ids = ds.filter((d) => d.status !== "completed" && d.status !== "cancelled").map((d) => d.id);
  if (!ids.length) return 0;
  const { data, error } = await supabaseAdmin.from("wa_campaigns")
    .update({
      status: "cancelled", cancelled_at: new Date().toISOString(), resume_at: null,
      last_error: "Cancelled together with the campaign it follows.",
    })
    .in("id", ids).in("status", ["draft", "scheduled", "sending", "paused", "failed"]).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

// Fail closed until migration 20260930120000 is applied: before it the SQL
// ignores min_hours_since (a follow-up would go out early) and matches nobody
// for the new stages. Only a positive answer is cached.
let followupSqlOkAt = 0;
export const FOLLOWUP_MIGRATION_ERROR =
  "Follow-ups need a database update (migration 20260930120000_wa_campaign_followups.sql). Tell the owner.";
export async function followupSqlError(): Promise<string | null> {
  if (Date.now() - followupSqlOkAt < 10 * 60_000) return null;
  const { error } = await supabaseAdmin.rpc("wa_campaign_followup_timing", {
    p_parent: "00000000-0000-0000-0000-000000000000",
    p_hours: 1,
  });
  if (error) return FOLLOWUP_MIGRATION_ERROR;
  followupSqlOkAt = Date.now();
  return null;
}
