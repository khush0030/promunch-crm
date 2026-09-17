import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSecret } from "@/lib/secrets";
import { parseBody, verifyBearer } from "@/lib/brevo-webhook";

// Brevo webhooks (marketing email, transactional email, SMS). Public route
// (middleware leaves /api/webhooks/* open); authenticated by the bearer token
// Brevo sends, which /api/brevo/webhooks sets when registering. Fails closed.
//
// Every event is written to brevo_events first (unique event_key, so a
// redelivery is a no-op). Unsubscribe / spam / hard bounce then land in
// `suppressions`, the do-not-email list the CRM's own email senders check.
// Suppression only ever gets stricter here; nothing is ever removed.

const REASON_RANK: Record<string, number> = { manual: 3, complaint: 3, unsubscribe: 2, bounce: 1 };

export async function POST(req: NextRequest) {
  const secret = await getSecret("BREVO_WEBHOOK_SECRET");
  if (!verifyBearer(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const events = parseBody(body);
  if (events.length === 0) return NextResponse.json({ received: 0 });

  const rows = events.map((e) => ({
    event_key: e.eventKey,
    channel: e.channel,
    event: e.event,
    email: e.email,
    phone: e.phone,
    campaign_id: e.campaignId,
    message_id: e.messageId,
    tag: e.tag,
    url: e.url,
    reason: e.reason,
    occurred_at: e.occurredAt,
    payload: e.payload,
  }));

  // ignoreDuplicates: a redelivered event_key is silently skipped. The ledger
  // write failing is a 500 so Brevo retries rather than losing an unsubscribe.
  const { error } = await supabaseAdmin.from("brevo_events").upsert(rows, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) {
    console.error("[webhooks/brevo] ledger insert failed", error.message);
    return NextResponse.json({ error: "ledger write failed" }, { status: 500 });
  }

  // Strongest reason per address in this delivery.
  const toSuppress = new Map<string, string>();
  for (const e of events) {
    if (!e.suppress || !e.email) continue;
    const prev = toSuppress.get(e.email);
    if (!prev || REASON_RANK[e.suppress] > REASON_RANK[prev]) toSuppress.set(e.email, e.suppress);
  }

  if (toSuppress.size > 0) {
    const emails = [...toSuppress.keys()];
    const { data: existing, error: readErr } = await supabaseAdmin.from("suppressions").select("email, reason").in("email", emails);
    if (readErr) {
      console.error("[webhooks/brevo] suppressions read failed", readErr.message);
      return NextResponse.json({ error: "suppression read failed" }, { status: 500 });
    }
    const current = new Map((existing ?? []).map((r) => [r.email as string, r.reason as string]));
    // Insert new addresses; upgrade a weaker reason (bounce -> unsubscribe).
    const upserts = emails
      .filter((email) => {
        const had = current.get(email);
        return !had || (REASON_RANK[toSuppress.get(email)!] ?? 0) > (REASON_RANK[had] ?? 0);
      })
      .map((email) => ({ email, reason: toSuppress.get(email)! }));
    if (upserts.length > 0) {
      const { error: supErr } = await supabaseAdmin.from("suppressions").upsert(upserts, { onConflict: "email" });
      if (supErr) {
        console.error("[webhooks/brevo] suppressions upsert failed", supErr.message);
        return NextResponse.json({ error: "suppression write failed" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: events.length, suppressed: toSuppress.size });
}
