// wa-ticket-watchdog
// ---------------------------------------------------------------------------
// The SLA fallback for the two-number WhatsApp escalation ladder.
//
// When a ticket is raised, wa-ai-reply pings the FIRST human on WhatsApp:
//   • order issues (cancel / tracking / delivery / refund) → OPS_WA_ID (number 1)
//   • everything else                                       → ESCALATION_WA_ID (owner)
//
// This cron is the fallback: if a ticket is STILL open ~45 min later, it pings
// the SECOND person once, then stops (no firehose):
//   • order issues → OPS_WA_ID_2 (Narendra)
//   • everything else → ESCALATION_WA_ID (owner, a reminder nudge)
//
// A ticket is closed by any of those numbers replying "done <ticket#>" on
// WhatsApp (handled in wa-webhook) or from the dashboard — which resets the
// counters and stops all further pings. Slack is intentionally gone: the two
// WhatsApp numbers are the only escalation channel now.
//
//   reping (default, every 15 min) — send the one fallback ping for tickets
//     past the window that were never escalated (ticket_alert_count == 0).
//   digest (daily) — returns queue counts as JSON only (no Slack, no send).
//
// verify_jwt=false — invoked by pg_cron via net.http_post (see
// scripts/wa-ticket-watchdog-cron.sql).

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { errStr } from "../_shared/connector-log.ts";

// How long a ticket may sit after the first ping before the second person is
// looped in. Default 45 min; override with OPS_FALLBACK_HOURS.
const FALLBACK_HOURS = Number(Deno.env.get("OPS_FALLBACK_HOURS") ?? "0.75");

// Categories that ride the ORDER lane (number 1 → Narendra). Everything else
// routes to the owner. Must match wa-ai-reply's ORDER_LANE.
const ORDER_LANE = new Set(["order_issue", "refund"]);
const TYPE_LABEL: Record<string, string> = {
  order_issue: "Order issue",
  refund: "Refund / return",
  product_query: "Product question",
  partnership: "Partnership lead",
  complaint: "Complaint",
  wholesale: "Wholesale lead",
  general: "Ticket",
};

interface Ticket {
  id: string;
  wa_id: string | null;
  ticket_number: number | null;
  ticket_status: string;
  ticket_priority: string | null;
  ticket_category: string | null;
  ticket_subject: string | null;
  escalation_reason: string | null;
  ticket_opened_at: string | null;
  ticket_alert_count: number | null;
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const mode = new URL(req.url).searchParams.get("mode") ?? "reping";
  const sb = db();

  const { data, error } = await sb
    .from("wa_threads")
    .select(
      "id, wa_id, ticket_number, ticket_status, ticket_priority, ticket_category, ticket_subject, escalation_reason, ticket_opened_at, ticket_alert_count",
    )
    .in("ticket_status", ["open", "pending"])
    .is("archived_at", null);
  if (error) return j({ ok: false, error: error.message }, 500);

  const tickets = (data ?? []) as Ticket[];
  if (mode === "digest") return runDigest(tickets);
  return await runReping(sb, tickets);
});

const ageHours = (iso: string | null) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : Infinity;
const prio = (t: Ticket) => (t.ticket_priority ?? "normal").toLowerCase();

// ---- fallback ping ---------------------------------------------------------
async function runReping(sb: ReturnType<typeof db>, tickets: Ticket[]) {
  let escalated = 0;

  // Fire the ONE fallback ping: past the window and never escalated yet.
  const due = tickets.filter((t) =>
    (t.ticket_alert_count ?? 0) === 0 &&
    ageHours(t.ticket_opened_at) >= FALLBACK_HOURS
  );

  for (const t of due) {
    const ok = await pingFallback(t).catch((e) => {
      console.warn("[wa-ticket-watchdog] fallback ping failed", errStr(e));
      return false;
    });
    // Bump the counter regardless of send outcome — one fallback attempt per
    // ticket, never a retry storm if the template/number isn't live yet.
    await sb.from("wa_threads").update({
      ticket_last_alert_at: new Date().toISOString(),
      ticket_alert_count: (t.ticket_alert_count ?? 0) + 1,
    }).eq("id", t.id);
    if (ok) escalated++;
  }

  return j({ ok: true, mode: "reping", open: tickets.length, escalated });
}

// Ping the SECOND person on WhatsApp with the generic ops_ticket_alert template.
// Order issues → Narendra (OPS_WA_ID_2); everything else → owner
// (ESCALATION_WA_ID). Gated on the env var — a no-op until it's set.
async function pingFallback(t: Ticket): Promise<boolean> {
  const clean = (v: string | undefined) => (v ?? "").replace(/^\+/, "").replace(/\D/g, "");
  const cat = (t.ticket_category ?? "general").toLowerCase();
  const to = ORDER_LANE.has(cat)
    ? clean(Deno.env.get("OPS_WA_ID_2"))
    : clean(Deno.env.get("ESCALATION_WA_ID"));
  if (!to) return false;

  const tpl = Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert";
  const vars = {
    "1": `Still open: ${TYPE_LABEL[cat] ?? "Ticket"}`,
    "2": String(t.ticket_number ?? "—"),
    "3": "—",
    "4": t.wa_id ? `+${t.wa_id}` : "—",
    "5": (t.escalation_reason ?? t.ticket_subject ?? "Ticket still open past SLA").slice(0, 300),
  };

  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      kind: "template",
      sent_by: "ticket_watchdog_fallback",
      template: { name: tpl, language: "en", vars },
    }),
  });
  const out = await r.json().catch(() => ({ ok: false }));
  return !!out?.ok;
}

// ---- daily digest (JSON only, no Slack) ------------------------------------
function runDigest(tickets: Ticket[]) {
  const open = tickets.length;
  const byPrio = (p: string) => tickets.filter((t) => prio(t) === p).length;
  const breaching = tickets.filter((t) => ageHours(t.ticket_opened_at) >= FALLBACK_HOURS).length;
  return j({
    ok: true,
    mode: "digest",
    open,
    urgent: byPrio("urgent"),
    high: byPrio("high"),
    breaching,
    posted: false,
    note: "Slack disabled — escalation is the two WhatsApp numbers only",
  });
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
