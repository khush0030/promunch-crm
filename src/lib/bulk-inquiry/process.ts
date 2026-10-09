// Intake for a bulk order inquiry: store it, put it on the deal board, send
// the one auto-reply. The lead-desk WhatsApp ping is NOT sent here: the
// bulk_inquiries insert trigger hands it to the edge function bulk-lead-alert
// (see supabase/migrations/20261007200000_bulk_inquiries.sql).
//
// Never-twice (promunch-email-agent/CLAUDE.md §0):
//   - insert is idempotent on submission_key (double-click, network retry);
//   - the email is claimed by a compare-and-set pending→sending that also
//     writes auto_reply_key (UNIQUE: one auto-reply per address per IST day)
//     BEFORE Resend is called. Losing either race means no send.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/resend";
import { renderBulkInquiryEmail } from "./email";
import { TEAM_ALERT_FROM, renderTeamAlertEmail } from "./team-email";
import { buildOpener } from "./opener";
import { addActivity, findOpenDuplicate, insertDeal, updateDeal } from "@/lib/deals/repo";
import { normalizePhone } from "@/lib/deals/model";
import {
  PRODUCTS,
  QUANTITY_BANDS,
  USE_CASES,
  companyDomain,
  shortDate,
  type BulkInquiryInput,
} from "./schema";

export interface IntakeResult {
  refNo: number;
  duplicate: boolean;
  emailStatus: string;
}

interface Row {
  id: string;
  ref_no: number;
  email_status: string;
  deal_id: string | null;
}

/** IST calendar day, e.g. "2026-10-07". */
function istDay(d = new Date()): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export async function intakeBulkInquiry(q: BulkInquiryInput, userAgent: string | null): Promise<IntakeResult> {
  const db = supabaseAdmin;

  // 1. Store (idempotent on submission_key).
  const { data: inserted, error: insErr } = await db
    .from("bulk_inquiries")
    .insert({
      submission_key: q.submissionKey,
      name: q.name,
      company: q.company,
      email: q.email,
      phone: q.phone,
      city: q.city,
      use_case: q.useCase,
      quantity_band: q.quantityBand,
      products: q.products,
      needed_by: q.neededBy,
      notes: q.notes,
      page_url: q.pageUrl,
      user_agent: userAgent?.slice(0, 300) ?? null,
    })
    .select("id, ref_no, email_status, deal_id")
    .maybeSingle();

  if (insErr) {
    if (insErr.code !== "23505") throw new Error(`bulk_inquiries insert: ${insErr.message}`);
    const { data: existing } = await db
      .from("bulk_inquiries")
      .select("id, ref_no, email_status, deal_id")
      .eq("submission_key", q.submissionKey)
      .maybeSingle();
    if (!existing) throw new Error("bulk_inquiries: duplicate key but row not found");
    return { refNo: existing.ref_no, duplicate: true, emailStatus: existing.email_status };
  }
  const row = inserted as Row;

  // 2. Deal board. Failure here must not block the customer email.
  let dealId: string | null = null;
  try {
    dealId = await attachDeal(row, q);
  } catch (e) {
    console.error("[bulk-inquiry] deal attach failed", e);
  }

  // 3. Auto-reply.
  const emailStatus = await sendAutoReply(row, q);

  // 4. Team email alert. Never blocks or fails the customer flow.
  try {
    await sendTeamAlert(row, q, emailStatus, dealId);
  } catch (e) {
    console.error("[bulk-inquiry] team alert failed", e);
  }
  return { refNo: row.ref_no, duplicate: false, emailStatus };
}

// Bulk form -> deal (source bulk_form, ref B-<n>, phone in contact_phone).
// The follow-up is due today and stamped as a deliberate decision
// (human_touched_at) so the 30-min deal-scan never clears it. A repeat
// submission from the same email or phone reuses the open deal and adds an
// activity entry. Works before the deals_simplify migration too (repo.ts
// falls back to the old columns and notes).
async function attachDeal(row: Row, q: BulkInquiryInput): Promise<string> {
  const db = supabaseAdmin;
  const uc = USE_CASES[q.useCase];
  const products = q.products.map((p) => PRODUCTS[p]).join(", ");
  const facts = [
    uc.label,
    QUANTITY_BANDS[q.quantityBand],
    q.city,
    q.neededBy ? `needed by ${shortDate(q.neededBy)}` : null,
    products ? `products: ${products}` : null,
  ].filter(Boolean).join(" · ");
  const now = new Date().toISOString();
  const today = istDay();
  const ref = `B-${row.ref_no}`;
  const phone = normalizePhone(q.phone);
  const note = `Bulk form ${ref}: ${facts}.${q.notes ? ` Note: ${q.notes}` : ""}`;

  const open = await findOpenDuplicate({ source_ref: null, contact_email: q.email.toLowerCase(), contact_phone: phone });

  let dealId: string;
  if (open) {
    dealId = open.id;
    await updateDeal(dealId, {
      follow_up_needed: true,
      follow_up_reason: "New bulk form submission",
      follow_up_at: today,
      human_touched_at: now,
      next_step: "Send quote",
      next_step_owner: "us",
      last_email_at: now,
      last_email_direction: "inbound",
      ...(open.contact_phone || !phone ? {} : { contact_phone: phone }),
    }, open.notes);
  } else {
    const deal = await insertDeal({
      company_name: q.company,
      company_domain: companyDomain(q.email),
      kind: uc.dealKind,
      contact_name: q.name,
      contact_email: q.email,
      contact_phone: phone,
      stage: "new",
      next_step: "Send quote",
      next_step_owner: "us",
      follow_up_needed: true,
      follow_up_reason: "New bulk form submission",
      follow_up_at: today,
      human_touched_at: now,
      source: "bulk_form",
      source_ref: ref,
      summary: `${q.name} from ${q.company} asked for a bulk quote via promunch.in: ${facts}.`,
      first_email_at: now,
      last_email_at: now,
      last_email_direction: "inbound",
    });
    dealId = deal.id;
  }
  await addActivity(dealId, [{ kind: "system", body: note }], "bulk_form").catch((e) =>
    console.error("[bulk-inquiry] deal activity failed", e),
  );
  await db.from("bulk_inquiries").update({ deal_id: dealId }).eq("id", row.id);
  return dealId;
}

async function sendAutoReply(row: Row, q: BulkInquiryInput): Promise<string> {
  const db = supabaseAdmin;

  const { data: settings } = await db
    .from("bulk_inquiry_settings")
    .select("autoreply_enabled, whatsapp_display")
    .eq("id", 1)
    .maybeSingle();
  if (settings && settings.autoreply_enabled === false) {
    await db.from("bulk_inquiries").update({ email_status: "skipped_disabled" }).eq("id", row.id).eq("email_status", "pending");
    return "skipped_disabled";
  }

  // Claim: compare-and-set + unique per-address-per-day key.
  const key = `${q.email.toLowerCase()}:${istDay()}`;
  const { data: claimed, error: claimErr } = await db
    .from("bulk_inquiries")
    .update({ email_status: "sending", auto_reply_key: key })
    .eq("id", row.id)
    .eq("email_status", "pending")
    .select("id")
    .maybeSingle();
  if (claimErr) {
    if (claimErr.code === "23505") {
      await db.from("bulk_inquiries").update({ email_status: "skipped_duplicate" }).eq("id", row.id).eq("email_status", "pending");
      return "skipped_duplicate";
    }
    throw new Error(`bulk auto-reply claim: ${claimErr.message}`);
  }
  if (!claimed) return "claimed_elsewhere";

  const { opener } = await buildOpener(q);
  const mail = renderBulkInquiryEmail({
    inquiry: q,
    refNo: row.ref_no,
    opener,
    whatsappDisplay: settings?.whatsapp_display || "+91 99813 10247",
  });

  try {
    const res = await sendEmail({ to: q.email, subject: mail.subject, html: mail.html, text: mail.text });
    const err = (res as { error?: { message?: string } | null }).error;
    const id = (res as { data?: { id?: string } | null }).data?.id ?? null;
    if (err || !id) throw new Error(err?.message || "Resend returned no id");
    await db.from("bulk_inquiries").update({
      email_status: "sent",
      resend_email_id: id,
      email_sent_at: new Date().toISOString(),
      email_subject: mail.subject,
      email_opener: opener,
    }).eq("id", row.id);
    return "sent";
  } catch (e) {
    // Resend did not accept it: free the daily key so a later submission (or a
    // person) can retry. Status failed is never retried automatically.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bulk-inquiry] auto-reply failed", msg);
    await db.from("bulk_inquiries").update({
      email_status: "failed",
      auto_reply_key: null,
      email_error: msg.slice(0, 500),
      email_subject: mail.subject,
      email_opener: opener,
    }).eq("id", row.id);
    return "failed";
  }
}

const DEFAULT_TEAM = ["hello@promunch.in", "parth.mutha@vippysoya.com"];

/** One internal email per inquiry to the team list (claimed pending→sending). */
async function sendTeamAlert(row: Row, q: BulkInquiryInput, emailStatus: string, dealId: string | null) {
  const db = supabaseAdmin;
  const { data: claimed } = await db
    .from("bulk_inquiries")
    .update({ team_email_status: "sending" })
    .eq("id", row.id)
    .eq("team_email_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  const { data: settings } = await db.from("bulk_inquiry_settings").select("team_alert_emails").eq("id", 1).maybeSingle();
  const to = ((settings?.team_alert_emails as string[] | null) ?? DEFAULT_TEAM).filter((e) => /@/.test(e));
  if (!to.length) {
    await db.from("bulk_inquiries").update({ team_email_status: "skipped" }).eq("id", row.id);
    return;
  }

  const base = (process.env.SITE_APP_URL || "https://admin.promunch.in").replace(/\/+$/, "");
  const mail = renderTeamAlertEmail({ inquiry: q, refNo: row.ref_no, autoReply: emailStatus, crmUrl: `${base}/dashboard/deals${dealId ? `?deal=${dealId}` : ""}` });
  try {
    const res = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, from: TEAM_ALERT_FROM, replyTo: q.email });
    const err = (res as { error?: { message?: string } | null }).error;
    if (err) throw new Error(err.message || "Resend error");
    await db.from("bulk_inquiries").update({ team_email_status: "sent", team_email_at: new Date().toISOString() }).eq("id", row.id);
  } catch (e) {
    await db.from("bulk_inquiries").update({ team_email_status: "failed" }).eq("id", row.id);
    throw e;
  }
}
