// Shared campaign sender. Called by the manual send route AND the scheduler
// cron, so the atomic claim lives here (never double-blast the audience).
//
// Invariants (AGENTS.md §4): claim-before-send per recipient (one
// campaign_emails row is the claim, unique per (campaign, contact) since
// migration 016), email IS NOT NULL + marketing consent + suppression list on
// every audience (Email Studio segments.ts), 1000-row pagination on every
// list read, and the Email Studio guardrails (approval, warm-up cap) are
// re-checked here so the cron path can't skip them.

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail, DEFAULT_FROM } from "@/lib/resend";
import { renderMarketingEmail } from "@/lib/email/layout";
import { marketingHeaders } from "@/lib/email/unsubscribe";
import { parseDesign, productIds } from "@/lib/email-studio/design";
import { parseRules, rulesFromLegacy, type AudienceRules } from "@/lib/email-studio/segments";
import { getFreqCapHours, resolveAudience, type ResolvedContact } from "@/lib/email-studio/audience-server";
import { getStudioSettings, productMap, renderForContact, utmSlug } from "@/lib/email-studio/server";
import { mergeText } from "@/lib/email-studio/render";
import { tokenizeStorefrontLinks } from "@/lib/email/link-tokens";
import { withContactToken } from "@/lib/email/browse-abandon";

const PAGE = 1000; // PostgREST hard cap per response
const CONCURRENCY = 5;
const RATE_MS = 120; // ~8 sends/sec, comfortably under Resend's default 10/s

export type CampaignSendResult = {
  ok: boolean;
  status: number; // suggested HTTP status for a route wrapper
  error?: string;
  total_recipients?: number;
  total_sent?: number;
  total_failed?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/** The campaign's audience rules: saved segment > inline rules > legacy filter. */
export async function campaignRules(campaign: Record<string, unknown>): Promise<AudienceRules> {
  if (campaign.segment_id) {
    const { data } = await supabase.from("email_segments").select("rules").eq("id", campaign.segment_id).maybeSingle();
    if (data?.rules) return parseRules(data.rules);
  }
  if (campaign.audience_rules) return parseRules(campaign.audience_rules);
  return rulesFromLegacy(campaign.segment_filter);
}

/**
 * Why this campaign may not go out right now (null = clear to send).
 * Same rules the Review step shows; re-checked at send time.
 */
export function sendBlocker(
  campaign: Record<string, unknown>,
  recipients: number,
  settings: { approval_threshold: number; warmup_max_recipients: number | null },
): string | null {
  const approved = campaign.approval_status === "approved";
  if (campaign.approval_status === "rejected") return "This campaign was rejected by an admin.";
  if (settings.warmup_max_recipients != null) {
    if (recipients > settings.warmup_max_recipients) {
      return `Domain warm-up is on: campaigns are limited to ${settings.warmup_max_recipients} recipients (this one has ${recipients}). Narrow the audience or ask an admin to raise the limit.`;
    }
    if (!approved) return "Domain warm-up is on: every campaign needs an admin's approval.";
  }
  if (recipients > settings.approval_threshold && !approved) {
    return `Campaigns over ${settings.approval_threshold} recipients need an admin's approval.`;
  }
  return null;
}

/**
 * Resolve the audience, check guardrails, claim, and send. Idempotent to
 * resume: a paused campaign can be re-run and only un-claimed recipients are
 * emailed.
 */
export async function sendCampaign(
  campaignId: string,
  opts: {
    /**
     * Frequency cap (default ON): skip contacts who got any other marketing
     * email (a flow step or another campaign) within the cap window
     * (getFreqCapHours, default 16h). Pass false for a deliberate override,
     * e.g. an urgent recall notice. This campaign's own earlier sends never
     * count against it, so a paused campaign resumes cleanly.
     */
    respectFreqCap?: boolean;
  } = {},
): Promise<CampaignSendResult> {
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) return { ok: false, status: 404, error: "Campaign not found" };
  if (campaign.status === "sent") return { ok: false, status: 400, error: "Campaign already sent" };

  const design = campaign.design ? parseDesign(campaign.design) : null;
  if (!campaign.subject || (!design && !campaign.body_html)) {
    return { ok: false, status: 400, error: "Campaign needs a subject and content before sending" };
  }

  let audience: ResolvedContact[];
  let settings: Awaited<ReturnType<typeof getStudioSettings>>;
  try {
    const rules = await campaignRules(campaign);
    const capHours = opts.respectFreqCap === false ? 0 : await getFreqCapHours();
    [audience, settings] = await Promise.all([
      resolveAudience(rules, capHours > 0 ? { freqCap: { hours: capHours, excludeCampaignId: campaignId } } : {}),
      getStudioSettings(),
    ]);
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "audience read failed" };
  }

  const blocker = sendBlocker(campaign, audience.length, settings);
  if (blocker) {
    // A scheduled campaign that fails a guardrail stops retrying every tick.
    if (campaign.status === "scheduled") {
      await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId).eq("status", "scheduled");
    }
    return { ok: false, status: 403, error: blocker };
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

  if (audience.length === 0) {
    await supabase.from("campaigns").update({ status: "draft" }).eq("id", campaignId);
    return { ok: false, status: 400, error: "Nobody subscribed matches this audience" };
  }

  let alreadyClaimed: Set<string>;
  try {
    alreadyClaimed = await fetchClaimedContactIds(campaignId);
  } catch (e) {
    await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "claim read failed" };
  }

  const recipients = audience.filter((c) => !alreadyClaimed.has(c.id));
  if (recipients.length === 0) {
    await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
    return { ok: false, status: 409, error: "no new eligible recipients (all already sent)" };
  }

  // Per-recipient claim rows. With the (campaign_id, contact_id) unique index
  // a racing insert can only drop duplicates, never send twice. Before
  // migration 016 the index is missing, so fall back to a plain insert.
  const claimRows = recipients.map((c) => ({ campaign_id: campaignId, contact_id: c.id, status: "queued" }));
  let { data: campaignEmails, error: insertError } = await supabase
    .from("campaign_emails")
    .upsert(claimRows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true })
    .select("id, contact_id");
  if (insertError && /no unique or exclusion constraint/i.test(insertError.message)) {
    ({ data: campaignEmails, error: insertError } = await supabase
      .from("campaign_emails")
      .insert(claimRows)
      .select("id, contact_id"));
  }

  if (insertError) {
    await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
    return { ok: false, status: 500, error: insertError.message };
  }

  const contactMap = new Map(audience.map((c) => [c.id, c]));
  const subject = campaign.subject as string;
  const previewText = (campaign.preview_text as string | null) ?? undefined;
  const utmCampaign = (campaign.utm_campaign as string | null) || utmSlug(String(campaign.name ?? "email"), campaignId);
  const products = design ? await productMap(productIds(design)).catch(() => ({})) : {};

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
      const merge = { first_name: contact.first_name, last_name: contact.last_name, email: contact.email };
      const pre = previewText ? mergeText(previewText, merge) : undefined;
      const rendered = design
        ? renderForContact(design, { brand: settings.brand, products, contact, previewText: pre, utmCampaign })
        : renderMarketingEmail({ contactId: contact.id, bodyHtml: campaign.body_html as string, previewText: pre });
      // Signed pm_c on promunch.in links only (storefront pixel identity for
      // browse abandonment). UTMs are kept; the CRM-hosted unsubscribe link
      // is a different host and is never touched.
      const html = tokenizeStorefrontLinks(rendered, (u) => withContactToken(u, contact.id));
      const res = await sendEmail({
        to: contact.email,
        subject: mergeText(subject, merge),
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
      .update({ status: "paused", total_recipients: audience.length })
      .eq("id", campaignId);
    return { ok: false, status: 502, error: "every send failed, campaign paused", total_failed: totalFailed };
  }

  await supabase
    .from("campaigns")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      total_recipients: audience.length,
      total_sent: totalSent + ((campaign.total_sent as number | null) ?? 0),
    })
    .eq("id", campaignId);

  return {
    ok: true,
    status: 200,
    total_recipients: audience.length,
    total_sent: totalSent,
    total_failed: totalFailed,
  };
}
