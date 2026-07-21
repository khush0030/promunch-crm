// Shared campaign sender. Called by the manual send route AND the scheduler
// cron, so the atomic claim lives here (never double-blast the audience).
//
// Invariants (AGENTS.md §4): claim-before-send per recipient (one
// campaign_emails row is the claim), email IS NOT NULL on every audience read,
// 1000-row pagination on every list read (PostgREST truncates at 1000 — that
// caused a duplicate incident on the WhatsApp side), and the suppression list
// is honored even when a contact still reads 'active'.

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail, DEFAULT_FROM } from "@/lib/resend";
import { renderMarketingEmail } from "@/lib/email/layout";
import { marketingHeaders } from "@/lib/email/unsubscribe";

const PAGE = 1000; // PostgREST hard cap per response
const CONCURRENCY = 5;
const RATE_MS = 120; // ~8 sends/sec, comfortably under Resend's default 10/s

type Contact = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

export type CampaignSendResult = {
  ok: boolean;
  status: number; // suggested HTTP status for a route wrapper
  error?: string;
  total_recipients?: number;
  total_sent?: number;
  total_failed?: number;
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Apply the campaign's segment_filter (audience preset + explicit filters). */
type Filters = Record<string, unknown>;
function contactPage(filter: Filters | null, from: number) {
  let q = supabase
    .from("contacts")
    .select("id, email, first_name, last_name")
    .eq("status", "active")
    .not("email", "is", null)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);

  const f = filter ?? {};

  // Audience presets from the New Campaign picker (all | vip | new | lapsed).
  switch (f.audience) {
    case "vip":
      q = q.gte("total_orders", 3);
      break;
    case "new":
      q = q.gte("first_purchase_date", isoDaysAgo(30));
      break;
    case "lapsed":
      q = q.lte("last_purchase_date", isoDaysAgo(90)).gte("total_orders", 1);
      break;
    // "all" or unset → no extra constraint
  }

  // Explicit filters (compose with the preset).
  if (Array.isArray(f.tags) && f.tags.length > 0) q = q.overlaps("tags", f.tags as string[]);
  if (typeof f.min_orders === "number") q = q.gte("total_orders", f.min_orders);
  if (typeof f.min_spent === "number") q = q.gte("total_spent", f.min_spent);

  return q;
}

async function fetchAllContacts(filter: Filters | null): Promise<Contact[]> {
  const out: Contact[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await contactPage(filter, from);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Contact[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchSuppressedSet(): Promise<Set<string>> {
  const set = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("suppressions")
      .select("email")
      .order("email", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) set.add((r.email as string).toLowerCase());
    if (rows.length < PAGE) break;
  }
  return set;
}

async function fetchClaimedContactIds(campaignId: string): Promise<Set<string>> {
  const set = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("campaign_emails")
      .select("contact_id")
      .eq("campaign_id", campaignId)
      .order("contact_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) set.add(r.contact_id as string);
    if (rows.length < PAGE) break;
  }
  return set;
}

/**
 * Claim, resolve the audience, and send. Idempotent to resume: a paused/failed
 * campaign can be re-run and only un-claimed recipients are emailed.
 */
export async function sendCampaign(campaignId: string): Promise<CampaignSendResult> {
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) return { ok: false, status: 404, error: "Campaign not found" };
  if (campaign.status === "sent") return { ok: false, status: 400, error: "Campaign already sent" };
  if (!campaign.subject || !campaign.body_html) {
    return { ok: false, status: 400, error: "Campaign must have subject and body_html before sending" };
  }

  // Atomic claim: exactly one caller moves draft|scheduled|paused → sending.
  const { data: claimed, error: claimError } = await supabase
    .from("campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)
    .in("status", ["draft", "scheduled", "paused"])
    .select("id");

  if (claimError) return { ok: false, status: 500, error: claimError.message };
  if (!claimed || claimed.length === 0) {
    return { ok: false, status: 409, error: "campaign already sending or sent" };
  }

  let contacts: Contact[];
  let suppressed: Set<string>;
  let alreadyClaimed: Set<string>;
  try {
    [contacts, suppressed, alreadyClaimed] = await Promise.all([
      fetchAllContacts(campaign.segment_filter as Filters | null),
      fetchSuppressedSet(),
      fetchClaimedContactIds(campaignId),
    ]);
  } catch (e) {
    await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "audience read failed" };
  }

  if (contacts.length === 0) {
    await supabase.from("campaigns").update({ status: "draft" }).eq("id", campaignId);
    return { ok: false, status: 400, error: "No contacts match the segment filter" };
  }

  const recipients = contacts.filter(
    (c) => c.email && !suppressed.has(c.email.toLowerCase()) && !alreadyClaimed.has(c.id),
  );

  if (recipients.length === 0) {
    // Everyone is suppressed or was already claimed by a prior attempt.
    await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
    return { ok: false, status: 409, error: "no new eligible recipients (all suppressed or already sent)" };
  }

  // Per-recipient claim rows.
  const { data: campaignEmails, error: insertError } = await supabase
    .from("campaign_emails")
    .insert(recipients.map((c) => ({ campaign_id: campaignId, contact_id: c.id, status: "queued" })))
    .select("id, contact_id");

  if (insertError) {
    await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
    return { ok: false, status: 500, error: insertError.message };
  }

  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const subject = campaign.subject as string;
  const bodyHtml = campaign.body_html as string;
  const previewText = (campaign.preview_text as string | null) ?? undefined;

  let totalSent = 0;
  let totalFailed = 0;
  let lastStart = 0;

  async function paceGate() {
    const now = Date.now();
    const wait = Math.max(0, lastStart + RATE_MS - now);
    lastStart = Math.max(now, lastStart + RATE_MS);
    if (wait > 0) await sleep(wait);
  }

  async function sendOne(row: { id: string; contact_id: string }) {
    const contact = contactMap.get(row.contact_id);
    if (!contact?.email) {
      await supabase.from("campaign_emails").update({ status: "failed", error: "no email" }).eq("id", row.id);
      totalFailed++;
      return;
    }
    await paceGate();
    try {
      const html = renderMarketingEmail({ contactId: contact.id, bodyHtml, previewText });
      const res = await sendEmail({
        to: contact.email,
        subject,
        html,
        from: DEFAULT_FROM,
        headers: marketingHeaders(contact.id),
      });
      const resendId = res?.data?.id;
      if (res?.error || !resendId) {
        await supabase
          .from("campaign_emails")
          .update({ status: "failed", error: res?.error?.message ?? "send failed" })
          .eq("id", row.id);
        totalFailed++;
        return;
      }
      await supabase
        .from("campaign_emails")
        .update({ status: "sent", resend_id: resendId, sent_at: new Date().toISOString() })
        .eq("id", row.id);
      totalSent++;
    } catch (e) {
      await supabase
        .from("campaign_emails")
        .update({ status: "failed", error: e instanceof Error ? e.message : "send error" })
        .eq("id", row.id);
      totalFailed++;
    }
  }

  const queue = [...(campaignEmails ?? [])];
  async function worker() {
    let next = queue.shift();
    while (next) {
      await sendOne(next);
      next = queue.shift();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  // Circuit breaker: nothing sent, everything failed → systemic (bad key,
  // unverified domain). Park instead of marking sent so it can be retried.
  if (totalSent === 0 && totalFailed > 0) {
    await supabase
      .from("campaigns")
      .update({ status: "paused", total_recipients: contacts.length })
      .eq("id", campaignId);
    return { ok: false, status: 502, error: "every send failed — campaign paused", total_failed: totalFailed };
  }

  await supabase
    .from("campaigns")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      total_recipients: contacts.length,
      total_sent: totalSent,
    })
    .eq("id", campaignId);

  return {
    ok: true,
    status: 200,
    total_recipients: contacts.length,
    total_sent: totalSent,
    total_failed: totalFailed,
  };
}
