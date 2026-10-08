import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resolveAudience } from "@/lib/email-studio/audience-server";
import { caller, isResponse } from "@/lib/email-studio/route-helpers";

// Email -> Results: the same numbers as the Email overview
// (/api/email-studio/overview), for a chosen 7 / 30 / 90 day window, plus
// per-campaign and per-automation breakdowns (rows without a campaign or
// automation id count in the totals but not in any breakdown line).
//
// Definitions are copied from the overview route on purpose, so the two
// screens can never disagree for the same period:
//   campaign sent = campaign_emails with sent_at in window, status not queued/failed
//   automation sent = email_sends with sent_at in window, status not failed
//   opens / clicks  = rows in those two sets with opened_at / clicked_at
//   revenue         = email_attributions with order_at in window
//   bounce / spam   = campaign rows bounced / complained over campaign sent
//   can email       = resolveAudience({ conditions: [] }) (consent + email + not suppressed)
// Read-only; service-role access stays on the server.
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const PAGE = 1000;
const WINDOWS = [7, 30, 90];

type CampRow = { campaign_id: string | null; status: string; opened_at: string | null; clicked_at: string | null };
type FlowRow = { flow_id: string | null; status: string | null; opened_at: string | null; clicked_at: string | null };
type Attrib = { revenue: number | string | null; campaign_id: string | null; flow_id: string | null };

type Line = { id: string; name: string; sent: number; opens: number; clicks: number; orders: number; revenue: number };

function bump(map: Map<string, Line>, id: string): Line {
  let cur = map.get(id);
  if (!cur) {
    cur = { id, name: "", sent: 0, opens: 0, clicks: 0, orders: 0, revenue: 0 };
    map.set(id, cur);
  }
  return cur;
}

export async function GET(req: NextRequest) {
  const me = await caller();
  if (isResponse(me)) return me;

  const asked = Number(req.nextUrl.searchParams.get("days"));
  const days = WINDOWS.includes(asked) ? asked : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const rows: CampRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("campaign_emails")
      .select("campaign_id, status, opened_at, clicked_at")
      .gte("sent_at", since)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as CampRow[]));
    if ((data ?? []).length < PAGE) break;
  }
  const flow: FlowRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("email_sends")
      .select("flow_id, status, opened_at, clicked_at")
      .gte("sent_at", since)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    flow.push(...((data ?? []) as FlowRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  const campSentRows = rows.filter((r) => r.status !== "queued" && r.status !== "failed");
  const flowSentRows = flow.filter((r) => r.status !== "failed");
  const sent = campSentRows.length;
  const flowSent = flowSentRows.length;
  const clicks = rows.filter((r) => r.clicked_at).length + flow.filter((r) => r.clicked_at).length;
  const opens = rows.filter((r) => r.opened_at).length + flow.filter((r) => r.opened_at).length;
  const bounced = rows.filter((r) => r.status === "bounced").length;
  const complained = rows.filter((r) => r.status === "complained").length;

  const { data: attribData } = await supabase.from("email_attributions").select("revenue, campaign_id, flow_id").gte("order_at", since);
  const attrib = (attribData ?? []) as Attrib[];
  const revenue = attrib.reduce((s, a) => s + (Number(a.revenue) || 0), 0);
  const flowRevenue = attrib.filter((a) => a.flow_id).reduce((s, a) => s + (Number(a.revenue) || 0), 0);

  // Per-campaign / per-automation lines in the same window, same definitions.
  const camps = new Map<string, Line>();
  for (const r of campSentRows) if (r.campaign_id) bump(camps, r.campaign_id).sent += 1;
  for (const r of rows) {
    if (!r.campaign_id) continue;
    if (r.opened_at) bump(camps, r.campaign_id).opens += 1;
    if (r.clicked_at) bump(camps, r.campaign_id).clicks += 1;
  }
  const flows = new Map<string, Line>();
  for (const r of flowSentRows) if (r.flow_id) bump(flows, r.flow_id).sent += 1;
  for (const r of flow) {
    if (!r.flow_id) continue;
    if (r.opened_at) bump(flows, r.flow_id).opens += 1;
    if (r.clicked_at) bump(flows, r.flow_id).clicks += 1;
  }
  for (const a of attrib) {
    const line = a.campaign_id ? bump(camps, a.campaign_id) : a.flow_id ? bump(flows, a.flow_id) : null;
    if (!line) continue;
    line.orders += 1;
    line.revenue += Number(a.revenue) || 0;
  }

  const [campNames, flowNames, unsubs, subscribers] = await Promise.all([
    camps.size ? supabase.from("campaigns").select("id, name").in("id", [...camps.keys()]) : Promise.resolve({ data: [] }),
    flows.size ? supabase.from("flows").select("id, name").in("id", [...flows.keys()]) : Promise.resolve({ data: [] }),
    supabase.from("suppressions").select("email", { count: "exact", head: true }).eq("reason", "unsubscribe").gte("created_at", since),
    resolveAudience({ conditions: [] }).then((l) => l.length).catch(() => null),
  ]);
  for (const c of (campNames.data ?? []) as { id: string; name: string }[]) bump(camps, c.id).name = c.name;
  for (const f of (flowNames.data ?? []) as { id: string; name: string }[]) bump(flows, f.id).name = f.name;

  const rank = (a: Line, b: Line) => b.revenue - a.revenue || b.clicks - a.clicks || b.sent - a.sent;
  const total = sent + flowSent;
  return NextResponse.json({
    days,
    since,
    emailsSent: total,
    campaignSent: sent,
    flowSent,
    opens,
    clicks,
    clickRate: total ? clicks / total : null,
    openRate: total ? opens / total : null,
    bounceRate: sent ? bounced / sent : null,
    complaintRate: sent ? complained / sent : null,
    bounced,
    complained,
    revenue,
    flowRevenue,
    orders: attrib.length,
    unsubscribed: unsubs.count ?? 0,
    subscribers,
    campaigns: [...camps.values()].map((l) => ({ ...l, name: l.name || "Deleted campaign" })).sort(rank),
    automations: [...flows.values()].map((l) => ({ ...l, name: l.name || "Deleted automation" })).sort(rank),
  });
}
