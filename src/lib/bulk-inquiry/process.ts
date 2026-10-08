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
import { buildOpener } from "./opener";
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
  try {
    await attachDeal(row, q);
  } catch (e) {
    console.error("[bulk-inquiry] deal attach failed", e);
  }

  // 3. Auto-reply.
  const emailStatus = await sendAutoReply(row, q);
  return { refNo: row.ref_no, duplicate: false, emailStatus };
}

async function attachDeal(row: Row, q: BulkInquiryInput) {
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

  // Same person already has an open deal (repeat submission): reuse it.
  const { data: open } = await db
    .from("deals")
    .select("id, notes")
    .ilike("contact_email", q.email)
    .not("stage", "in", "(won,lost)")
    .order("created_at", { ascending: false })
    .limit(1);

  const note = `Bulk form B-${row.ref_no} (${istDay()}): ${facts}. Phone ${q.phone}.${q.notes ? ` Note: ${q.notes}` : ""}`;

  let dealId: string;
  if (open?.length) {
    dealId = open[0].id;
    await db.from("deals").update({
      notes: [open[0].notes, note].filter(Boolean).join("\n\n").slice(0, 8000),
      follow_up_needed: true,
      follow_up_reason: "New bulk form submission",
      next_step: "Send quote",
      next_step_owner: "us",
      last_email_at: now,
      last_email_direction: "inbound",
    }).eq("id", dealId);
  } else {
    const { data, error } = await db.from("deals").insert({
      company_name: q.company,
      company_domain: companyDomain(q.email),
      kind: uc.dealKind,
      contact_name: q.name,
      contact_email: q.email,
      stage: "new_inquiry",
      next_step: "Send quote",
      next_step_owner: "us",
      follow_up_needed: true,
      follow_up_reason: "New bulk form submission",
      summary: `${q.name} from ${q.company} asked for a bulk quote via promunch.in: ${facts}.`,
      notes: note,
      first_email_at: now,
      last_email_at: now,
      last_email_direction: "inbound",
    }).select("id").single();
    if (error) throw new Error(`deals insert: ${error.message}`);
    dealId = data.id;
  }
  await db.from("bulk_inquiries").update({ deal_id: dealId }).eq("id", row.id);
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
    whatsappDisplay: settings?.whatsapp_display || "+91 72722 58545",
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
