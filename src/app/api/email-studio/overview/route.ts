import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getStudioSettings } from "@/lib/email-studio/server";
import { resolveAudience } from "@/lib/email-studio/audience-server";
import { DEFAULT_FROM } from "@/lib/resend";

// Email Studio home: last-30-day results, subscriber count, what's queued,
// what's waiting for approval, and deliverability health.
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const PAGE = 1000;

export async function GET() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const rows: { status: string; opened_at: string | null; clicked_at: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("campaign_emails")
      .select("status, opened_at, clicked_at")
      .gte("sent_at", since)
      .order("id")
      .range(from, from + PAGE - 1);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  const flow: { status: string | null; opened_at: string | null; clicked_at: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("email_sends")
      .select("status, opened_at, clicked_at")
      .gte("sent_at", since)
      .order("id")
      .range(from, from + PAGE - 1);
    flow.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }

  const sent = rows.filter((r) => r.status !== "queued" && r.status !== "failed").length;
  const flowSent = flow.filter((r) => r.status !== "failed").length;
  const clicks = rows.filter((r) => r.clicked_at).length + flow.filter((r) => r.clicked_at).length;
  const opens = rows.filter((r) => r.opened_at).length + flow.filter((r) => r.opened_at).length;
  const bounced = rows.filter((r) => r.status === "bounced").length;
  const complained = rows.filter((r) => r.status === "complained").length;

  const { data: attrib } = await supabase.from("email_attributions").select("revenue, campaign_id, flow_id").gte("order_at", since);
  const revenue = (attrib ?? []).reduce((s, a) => s + (Number(a.revenue) || 0), 0);
  const flowRevenue = (attrib ?? []).filter((a) => a.flow_id).reduce((s, a) => s + (Number(a.revenue) || 0), 0);

  const [{ data: upcoming }, { data: pending }, settings, subscribers] = await Promise.all([
    supabase.from("campaigns").select("id, name, scheduled_at").eq("status", "scheduled").order("scheduled_at").limit(5),
    supabase.from("campaigns").select("id, name, created_by, scheduled_at").eq("approval_status", "pending").limit(10),
    getStudioSettings(),
    resolveAudience({ conditions: [] }).then((l) => l.length).catch(() => null),
  ]);

  const total = sent + flowSent;
  return NextResponse.json({
    period: "last 30 days",
    emailsSent: total,
    campaignSent: sent,
    flowSent,
    opens,
    clicks,
    clickRate: total ? clicks / total : null,
    openRate: total ? opens / total : null,
    bounceRate: sent ? bounced / sent : null,
    complaintRate: sent ? complained / sent : null,
    revenue,
    flowRevenue,
    orders: (attrib ?? []).length,
    subscribers,
    upcoming: upcoming ?? [],
    pending: pending ?? [],
    warmupMax: settings.warmup_max_recipients,
    approvalThreshold: settings.approval_threshold,
    domain: DEFAULT_FROM.match(/@([^>\s]+)/)?.[1] ?? null,
  });
}
