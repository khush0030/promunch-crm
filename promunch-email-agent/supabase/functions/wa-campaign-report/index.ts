// Campaign analytics report -> Slack.
// POST { campaign_id }  (invoked by pg_cron after a campaign fires).
// Computes ACCURATE per-recipient counts straight from wa_messages (not the
// cached campaign columns) and posts a readable summary to the WA health channel.
//
// "Received" = delivered + read (Meta confirmed it reached the phone).
// "Sent"     = Meta accepted it but no delivery receipt yet (still settling).
// "Failed"   = Meta declined delivery; broken down by reason (131049 = the
//              normal marketing-throttle, vs everything else which is worth a look).

import { db } from "../_shared/supabase.ts";
import { logConnector, postSlack, slackChannelFor } from "../_shared/connector-log.ts";

interface Body { campaign_id?: string; settled?: boolean }

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const body = (await req.json().catch(() => ({}))) as Body;
  const campaignId = body.campaign_id;
  if (!campaignId) return j({ error: "campaign_id required" }, 400);

  const settled = body.settled === true;
  const sb = db();
  const { data: campaign } = await sb.from("wa_campaigns").select("*").eq("id", campaignId).single();
  if (!campaign) return j({ error: "campaign not found" }, 404);

  // Exact counts via head-only count queries — never capped by PostgREST's
  // 1000-row page limit, so the numbers are accurate at any campaign size.
  const countOf = async (apply: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>): Promise<number> => {
    const { count } = await apply(baseQuery());
    return count ?? 0;
  };
  const baseQuery = () =>
    sb.from("wa_messages").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId);

  const total = await countOf((q) => q);
  const received = await countOf((q) => q.in("status", ["delivered", "read"]));
  const sent = await countOf((q) => q.eq("status", "sent"));
  const failed = await countOf((q) => q.eq("status", "failed"));
  // 131049 surfaces as the "healthy ecosystem engagement" decline.
  const throttled = await countOf((q) => q.eq("status", "failed").ilike("error", "%ecosystem%"));
  const other = Math.max(0, failed - throttled);

  // Top non-throttle failure reasons (detail only; capped fetch is fine here).
  const reasons = new Map<string, number>();
  const { data: badRows } = await sb
    .from("wa_messages")
    .select("error")
    .eq("campaign_id", campaignId)
    .eq("status", "failed")
    .not("error", "ilike", "%ecosystem%")
    .limit(1000);
  for (const r of badRows ?? []) {
    const key = (r.error ?? "unknown").slice(0, 80);
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  const pct = (n: number) => total ? `${Math.round((n / total) * 100)}%` : "0%";
  const otherLines = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, n]) => `        • ${n}× ${msg}`)
    .join("\n");

  const phase = settled ? "final" : "initial — delivery still settling";
  const lines = [
    `📊 *Campaign report — ${campaign.name}* (${phase})`,
    `*Status:* ${campaign.status}`,
    `*Audience messaged:* ${total}`,
    ``,
    `✅ *Received (delivered/read):* ${received}  (${pct(received)})`,
    `📤 *Sent, awaiting receipt:* ${sent}  (${pct(sent)})`,
    `❌ *Failed:* ${failed}  (${pct(failed)})`,
    failed ? `      • marketing throttle 131049 (expected): ${throttled}` : null,
    failed && other ? `      • other failures (worth a look): ${other}` : null,
    otherLines || null,
    ``,
    `_Received/sent keep settling for ~15 min as Meta delivery receipts arrive._`,
  ].filter((x) => x !== null);

  const channel = slackChannelFor("whatsapp");
  const posted = channel ? await postSlack(channel, lines.join("\n")) : false;

  // Ledger row — lets wa-jobs-tick dedup the settled report (fire it exactly once).
  await logConnector({
    connector: "whatsapp",
    level: "info",
    event: settled ? "campaign_report_settled" : "campaign_report_initial",
    message: `Campaign '${campaign.name}' report (${phase}): ${received} received, ${sent} sent, ${failed} failed.`,
    ref: campaignId,
    detail: { total, received, sent, failed, throttled, other },
  }).catch(() => {});

  return j({ ok: true, campaign: campaign.name, settled, total, received, sent, failed, throttled, other, posted });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
