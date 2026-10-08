// Lead-desk WhatsApp ping for promunch.in bulk order inquiries.
//
// Called two ways (both with the Vault service_role_key bearer):
//   {"id": "<bulk_inquiries.id>"}  by the AFTER INSERT trigger, right away;
//   {"sweep": true}                by pg_cron every 10 min: retries rows still
//                                  'pending' after 2 min (trigger lost) up to 2 days old.
// INTERNAL only: this messages the team (LEADS_WA_ID), never the customer.
// Exactly-once: pingLeadDesk() claims `lead_alert:bulk:<id>` before sending,
// so trigger + sweep racing on the same row still ping once.
//
// Migration: supabase/migrations/20261007200000_bulk_inquiries.sql.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { leadsWaId, pingLeadDesk } from "../_shared/lead-alert.ts";

const USE_LABEL: Record<string, string> = {
  gifting: "Corporate gifting",
  pantry: "Office pantry",
  events: "Event",
  resale: "Resale / distribution",
  other: "Bulk order",
};
const QTY_LABEL: Record<string, string> = {
  "50-100": "50-100 units",
  "100-500": "100-500 units",
  "500-2000": "500-2,000 units",
  "2000+": "2,000+ units",
  unsure: "qty not decided",
};

interface Row {
  id: string;
  ref_no: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  city: string;
  use_case: string;
  quantity_band: string;
  needed_by: string | null;
  notes: string | null;
  wa_alert_status: string;
}

const COLS = "id, ref_no, name, company, email, phone, city, use_case, quantity_band, needed_by, notes, wa_alert_status";

async function alertOne(r: Row): Promise<string> {
  if (r.wa_alert_status !== "pending") return r.wa_alert_status;
  if (!leadsWaId()) {
    await db().from("bulk_inquiries").update({ wa_alert_status: "skipped" }).eq("id", r.id).eq("wa_alert_status", "pending");
    return "skipped";
  }
  const details = [
    QTY_LABEL[r.quantity_band] ?? r.quantity_band,
    r.city,
    r.needed_by ? `by ${r.needed_by}` : null,
    r.notes ? r.notes.slice(0, 160) : null,
  ].filter(Boolean).join(" · ");

  const ok = await pingLeadDesk({
    claimKey: `lead_alert:bulk:${r.id}`,
    label: `${USE_LABEL[r.use_case] ?? "Bulk order"} (website form)`,
    ref: `B-${r.ref_no}`,
    name: `${r.name}, ${r.company}`,
    contact: `${r.phone} / ${r.email}`,
    details,
  });
  // ok=false is either a lost claim (someone else is sending / sent) or a
  // failed send (claim released). Leave 'pending' so the sweep can retry a
  // real failure; a sent claim makes later attempts no-ops.
  if (ok) {
    await db().from("bulk_inquiries").update({ wa_alert_status: "sent", wa_alert_at: new Date().toISOString() }).eq("id", r.id);
    return "sent";
  }
  return "pending";
}

Deno.serve(async (req) => {
  const denied = requireInternal(req);
  if (denied) return denied;

  let body: { id?: string; sweep?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body = sweep
  }

  try {
    if (body.id) {
      const { data } = await db().from("bulk_inquiries").select(COLS).eq("id", body.id).maybeSingle();
      if (!data) return Response.json({ ok: false, error: "not found" }, { status: 404 });
      const status = await alertOne(data as Row);
      return Response.json({ ok: true, status });
    }

    const now = Date.now();
    const { data: rows } = await db().from("bulk_inquiries").select(COLS)
      .eq("wa_alert_status", "pending")
      .lt("created_at", new Date(now - 2 * 60_000).toISOString())
      .gt("created_at", new Date(now - 2 * 86_400_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(20);
    const results: Record<string, string> = {};
    for (const r of (rows ?? []) as Row[]) results[`B-${r.ref_no}`] = await alertOne(r);
    return Response.json({ ok: true, swept: results });
  } catch (e) {
    console.error("[bulk-lead-alert]", e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
