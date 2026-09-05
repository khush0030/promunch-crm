// Support-team fan-out for internal ticket alerts.
//
// Ticket escalation used to reach exactly ONE person: the ops guard for order
// issues, the owner for everything else. A single point of failure — if that
// person's phone was off, a live complaint sat unseen (see ticket #9793, a food
// safety report that went three days without a call back).
//
// SUPPORT_ALERT_WA_IDS is a comma-separated list of the people who must see
// EVERY support ticket regardless of lane (owner, ops, founder). The lane
// recipient is still pinged first and unchanged; this only adds copies.
//
// INTERNAL only — never messages a customer.
//
// §0 no-duplicate discipline: each recipient's copy takes its own atomic claim
// on a namespaced key (`<claimPrefix>:<wa_id>`), so a cron re-run, a retry, or
// a second trigger can never ping the same person about the same ticket twice.

import { claimSend, markSendSent, releaseSend } from "./confirmations.ts";

const clean = (v: string | undefined | null) => (v ?? "").replace(/^\+/, "").replace(/\D/g, "");

// Everyone who gets a copy of every support ticket. Digits only, de-duplicated,
// empty entries dropped. Empty list = feature off (no behaviour change).
export function supportAlertWaIds(): string[] {
  const raw = Deno.env.get("SUPPORT_ALERT_WA_IDS") ?? "";
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const n = clean(part);
    if (n) seen.add(n);
  }
  return [...seen];
}

// Send the ops_ticket_alert template to every support-team number that has not
// already been pinged about this ticket. `alreadySent` is the lane recipient
// (or anyone else) that a caller has handled itself — never messaged twice.
//
// Best-effort: a failure to any one recipient is logged and skipped, and this
// never blocks the customer-facing reply.
export async function fanOutSupportAlert(o: {
  claimPrefix: string;   // e.g. "support_alert:ticket:1042"
  vars: Record<string, string>; // ops_ticket_alert {{1}}..{{5}}
  sentBy: string;        // wa_messages.sent_by tag
  alreadySent?: Array<string | null | undefined>;
}): Promise<number> {
  const skip = new Set((o.alreadySent ?? []).map(clean).filter(Boolean));
  const tpl = Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert";
  let sent = 0;

  for (const to of supportAlertWaIds()) {
    if (skip.has(to)) continue;
    const key = `${o.claimPrefix}:${to}`;
    if (!(await claimSend(key))) continue; // someone already pinged this person

    let ok = false;
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          kind: "template",
          sent_by: o.sentBy,
          template: { name: tpl, language: "en", vars: o.vars },
        }),
      });
      const out = await r.json().catch(() => ({ ok: false }));
      ok = !!out?.ok;
    } catch (e) {
      console.error("[support-alert] send failed", to, e);
    }

    // Release a lost send so a later retry can try this person again; only a
    // real Meta acceptance makes the claim terminal.
    if (ok) { await markSendSent(key); sent++; }
    else { await releaseSend(key); }
  }
  return sent;
}
