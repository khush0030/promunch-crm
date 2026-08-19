// Partnership / wholesale LEAD alerts on WhatsApp.
//
// Commercial leads (a distributor asking for pricing on WhatsApp, a brand
// mailing hello@ about a collab) used to land only with the owner
// (ESCALATION_WA_ID) or silently in /dashboard/deals. LEADS_WA_ID gets a copy
// the moment one appears, so nobody has to be watching a dashboard.
//
// INTERNAL only — this never messages a customer. Uses the approved
// `ops_ticket_alert` UTILITY template so it lands outside any 24h window, and
// is gated on LEADS_WA_ID: a no-op until the secret is set.
//
// §0 no-duplicate discipline: every ping takes the generic atomic claim
// (claimSend, see _shared/confirmations.ts) on a namespaced key, so a cron
// re-run or a double trigger can never ping the same lead twice.

import { claimSend, markSendSent, releaseSend } from "./confirmations.ts";

// wa-ai-reply ticket categories that ARE commercial leads.
export const LEAD_TICKET_CATEGORIES = new Set(["partnership", "wholesale"]);

// deal-scan kinds that are the same thing arriving by email.
export const LEAD_DEAL_KINDS = new Set(["distribution_wholesale", "brand_partnership"]);

export const DEAL_KIND_LABEL: Record<string, string> = {
  distribution_wholesale: "Wholesale lead",
  brand_partnership: "Partnership lead",
};

const clean = (v: string | undefined) => (v ?? "").replace(/^\+/, "").replace(/\D/g, "");

// The lead desk's WhatsApp number, digits only. Empty when unset.
export function leadsWaId(): string {
  return clean(Deno.env.get("LEADS_WA_ID"));
}

// Ping the lead desk once per lead. `claimKey` must be namespaced and stable
// for the lead (e.g. `lead_alert:ticket:1042`) — winning the claim is what
// makes the ping exactly-once. Returns true only when Meta accepted the send.
export async function pingLeadDesk(o: {
  claimKey: string;
  label: string; // {{1}} e.g. "Wholesale lead"
  ref: string | number | null; // {{2}} ticket number, or "—"
  name: string | null; // {{3}} person / company
  contact: string | null; // {{4}} phone or email
  details: string; // {{5}}
  skipIfSameAs?: string; // don't double-message a number already pinged
}): Promise<boolean> {
  const to = leadsWaId();
  if (!to) return false;
  if (o.skipIfSameAs && clean(o.skipIfSameAs) === to) return false;

  if (!(await claimSend(o.claimKey))) return false;

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
        sent_by: "lead_alert",
        template: {
          name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert",
          language: "en",
          vars: {
            "1": o.label,
            "2": String(o.ref ?? "—"),
            "3": (o.name || "—").slice(0, 120),
            "4": (o.contact || "—").slice(0, 120),
            "5": (o.details || "See dashboard").slice(0, 300),
          },
        },
      }),
    });
    const out = await r.json().catch(() => ({ ok: false }));
    ok = !!out?.ok;
  } catch (e) {
    console.error("[lead-alert] ping failed", e);
  }

  // Lock it on success; release on failure so a later run may retry.
  if (ok) await markSendSent(o.claimKey);
  else await releaseSend(o.claimKey);
  return ok;
}
