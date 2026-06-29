// wa-ticket-watchdog
// ---------------------------------------------------------------------------
// The "no ticket gets missed" engine. A ticket today is just a flag on a thread
// that someone has to remember to look at — so tickets rot (urgent cancels sat
// 4–6 days, one 38 days, none assigned). This cron makes an open ticket KEEP
// NAGGING the team until a human owns it.
//
// Two modes (selected by ?mode=):
//
//   reping (default, every 15 min) — for each open/pending ticket that is past
//     its SLA and still UNOWNED (no ticket_assignee), re-post a Slack reminder
//     that escalates with each nag, with a deep link to claim it in the
//     dashboard. URGENT tickets also ping the ops "guard" on WhatsApp (gated on
//     OPS_WA_ID) so a cancel can be pulled before dispatch even if nobody's in
//     Slack. Nagging stops the moment someone is assigned OR the ticket is
//     resolved/closed (both done from the dashboard).
//
//   digest (daily) — one summary to Slack: how many open, the oldest, how many
//     breaching SLA, how many still unowned. A standing heartbeat so "is the
//     queue clear?" is answered every morning without anyone asking.
//
// SLA by priority (hours): how long a ticket may sit before the first nag, and
// the interval between subsequent nags.
//   urgent 1h · high 4h · normal 24h · low 24h
//
// verify_jwt=false — invoked by pg_cron via net.http_post (see
// scripts/wa-ticket-watchdog-cron.sql).

import { db } from "../_shared/supabase.ts";
import { errStr, logConnector, postSlack, slackChannelFor } from "../_shared/connector-log.ts";

const DASH = (Deno.env.get("DASHBOARD_URL") ?? "https://promunch-crm.vercel.app").replace(/\/$/, "");

// hours a ticket may sit before the first nag (and the gap between nags after)
const SLA_HOURS: Record<string, number> = { urgent: 1, high: 4, normal: 24, low: 24 };
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

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
  ticket_assignee: string | null;
  ticket_last_alert_at: string | null;
  ticket_alert_count: number | null;
}

Deno.serve(async (req) => {
  const mode = new URL(req.url).searchParams.get("mode") ?? "reping";
  const sb = db();

  const { data, error } = await sb
    .from("wa_threads")
    .select(
      "id, wa_id, ticket_number, ticket_status, ticket_priority, ticket_category, ticket_subject, escalation_reason, ticket_opened_at, ticket_assignee, ticket_last_alert_at, ticket_alert_count",
    )
    .in("ticket_status", ["open", "pending"])
    .is("archived_at", null);
  if (error) return j({ ok: false, error: error.message }, 500);

  const tickets = (data ?? []) as Ticket[];
  if (mode === "digest") return await runDigest(tickets);
  return await runReping(sb, tickets);
});

const ageHours = (iso: string | null) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : Infinity;
const prio = (t: Ticket) => (t.ticket_priority ?? "normal").toLowerCase();
const sla = (t: Ticket) => SLA_HOURS[prio(t)] ?? 24;

function fmtAge(h: number): string {
  if (!isFinite(h)) return "unknown";
  return h >= 48 ? `${(h / 24).toFixed(1)}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.round(h * 60)}m`;
}

// ---- re-ping ---------------------------------------------------------------
async function runReping(sb: ReturnType<typeof db>, tickets: Ticket[]) {
  const channel = slackChannelFor("whatsapp");
  let alerted = 0, opsPinged = 0;

  // Loudest (most overdue, highest priority) first.
  const due = tickets
    .filter((t) => {
      if (t.ticket_assignee) return false;                 // owned → stop nagging
      const age = ageHours(t.ticket_opened_at);
      if (age < sla(t)) return false;                      // still within SLA
      const sinceAlert = ageHours(t.ticket_last_alert_at); // ∞ if never alerted
      return sinceAlert >= sla(t);                         // nag at most once per SLA window
    })
    .sort((a, b) => (PRIORITY_RANK[prio(a)] ?? 9) - (PRIORITY_RANK[prio(b)] ?? 9) ||
      ageHours(b.ticket_opened_at) - ageHours(a.ticket_opened_at));

  for (const t of due) {
    const n = (t.ticket_alert_count ?? 0) + 1;
    if (channel) await postSlack(channel, renderReminder(t, n));

    // Urgent (cancel / address change) → also nudge ops on WhatsApp so the order
    // can be pulled before dispatch even if nobody is watching Slack. Gated on
    // OPS_WA_ID — a no-op until ops set their number. Best-effort.
    if (prio(t) === "urgent") {
      const ok = await pingOps(t).catch((e) => {
        console.warn("[wa-ticket-watchdog] ops ping failed", errStr(e));
        return false;
      });
      if (ok) opsPinged++;
    }

    await sb.from("wa_threads").update({
      ticket_last_alert_at: new Date().toISOString(),
      ticket_alert_count: n,
    }).eq("id", t.id);
    alerted++;
  }

  // If tickets are overdue but Slack isn't wired, that's itself a miss worth surfacing.
  if (due.length && !channel) {
    await logConnector({
      connector: "whatsapp", level: "error", event: "ticket_watchdog_no_channel",
      message: `${due.length} ticket(s) past SLA but no Slack channel configured (set WA_HEALTH_CHANNEL_ID / SLACK_CHANNEL_ID + SLACK_BOT_TOKEN)`,
      throttleMinutes: 60,
    }).catch(() => {});
  }

  return j({ ok: true, mode: "reping", open: tickets.length, alerted, ops_pinged: opsPinged });
}

function renderReminder(t: Ticket, nth: number): string {
  const age = fmtAge(ageHours(t.ticket_opened_at));
  const p = prio(t);
  const emoji = p === "urgent" ? ":rotating_light:" : p === "high" ? ":large_orange_diamond:" : ":ticket:";
  const ordinal = nth === 1 ? "still unassigned" : `reminder #${nth}`;
  const link = `${DASH}/dashboard/whatsapp?tab=tickets`;
  return [
    `${emoji} *Ticket #${t.ticket_number ?? "?"} ${p.toUpperCase()} — ${ordinal}*`,
    `*Open for:* ${age} (SLA ${sla(t)}h) · *nobody has claimed it*`,
    `*Issue:* ${(t.escalation_reason ?? t.ticket_subject ?? "(no summary)").slice(0, 300)}`,
    `*Customer:* ${t.wa_id ? `+${t.wa_id}` : "—"} · *category:* ${t.ticket_category ?? "general"}`,
    `*Claim it:* ${link} — open the ticket, assign yourself, and resolve it to stop these reminders.`,
  ].join("\n");
}

// Ping the ops guard on WhatsApp for an urgent ticket. Reuses the approved
// order-cancel ops template (urgent tickets are cancels / address changes).
// Pulls an order number out of the escalation reason if present. Gated on
// OPS_WA_ID; a no-op until that's set so this ships safely.
async function pingOps(t: Ticket): Promise<boolean> {
  const opsWaId = (Deno.env.get("OPS_WA_ID") ?? "").replace(/\D/g, "");
  if (!opsWaId) return false;
  const tpl = Deno.env.get("OPS_CANCEL_TEMPLATE") ?? "order_cancel_ops";
  const orderNo = (t.escalation_reason ?? "").match(/#(\d{3,})/)?.[1] ?? "see dashboard";
  const vars = {
    "1": orderNo,
    "2": "—",
    "3": t.wa_id ? `+${t.wa_id}` : "—",
    "4": (t.escalation_reason ?? "Urgent ticket needs action").slice(0, 250),
  };
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: opsWaId,
      kind: "template",
      sent_by: "ticket_watchdog_ops",
      template: { name: tpl, language: "en", vars },
    }),
  });
  const out = await r.json().catch(() => ({ ok: false }));
  return !!out?.ok;
}

// ---- daily digest ----------------------------------------------------------
async function runDigest(tickets: Ticket[]) {
  const channel = slackChannelFor("whatsapp");
  const open = tickets.length;
  const byPrio = (p: string) => tickets.filter((t) => prio(t) === p).length;
  const breaching = tickets.filter((t) => !t.ticket_assignee && ageHours(t.ticket_opened_at) >= sla(t)).length;
  const unassigned = tickets.filter((t) => !t.ticket_assignee).length;
  const oldest = tickets.reduce<Ticket | null>(
    (m, t) => (!m || ageHours(t.ticket_opened_at) > ageHours(m.ticket_opened_at) ? t : m),
    null,
  );

  if (!channel) return j({ ok: true, mode: "digest", open, posted: false, note: "no slack channel" });

  if (open === 0) {
    await postSlack(channel, ":white_check_mark: *WhatsApp tickets:* queue is clear — 0 open. Nice.");
    return j({ ok: true, mode: "digest", open: 0, posted: true });
  }

  const link = `${DASH}/dashboard/whatsapp?tab=tickets`;
  const text = [
    `:ticket: *WhatsApp tickets — daily digest*`,
    `*Open:* ${open}  ·  urgent ${byPrio("urgent")} · high ${byPrio("high")} · normal ${byPrio("normal")} · low ${byPrio("low")}`,
    `*Unowned:* ${unassigned}  ·  *past SLA:* ${breaching}`,
    oldest
      ? `*Oldest:* #${oldest.ticket_number ?? "?"} (${fmtAge(ageHours(oldest.ticket_opened_at))}) — ${(oldest.escalation_reason ?? "").slice(0, 120)}`
      : "",
    `*Work the queue:* ${link}`,
  ].filter(Boolean).join("\n");
  await postSlack(channel, text);
  return j({ ok: true, mode: "digest", open, breaching, unassigned, posted: true });
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
