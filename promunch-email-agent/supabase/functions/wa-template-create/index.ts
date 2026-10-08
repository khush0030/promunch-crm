// deno-lint-ignore-file no-explicit-any -- raw Meta Graph JSON is untyped
// Create, edit, delete & sync WhatsApp message templates at Meta.
//
// The wa_templates table is only a LOCAL registry — marking a row
// status='approved' there does nothing. A template must also exist and be
// approved inside the WhatsApp Business Account, or wa-send gets Meta error
// 132001 ("Template name does not exist in the translation").
//
// POST modes (JSON body):
//   { names?: string[] }   — create one/all of the predefined journey set
//   { template: {...} }    — create one arbitrary template (dashboard builder);
//                            also { action: "create", template }
//   { action: "edit", template: {...} }
//                          — edit a dashboard template at Meta (POST
//                            /{meta_template_id}) with its FULL component set.
//                            Works for rejected, paused and approved templates.
//                            Approved: category can't change; Meta allows
//                            roughly 1 edit / 24h and 10 / 30 days.
//   { action: "delete", name, language }
//                          — delete at Meta (by name + hsm_id, so only this
//                            language) and then locally. If Meta refuses, the
//                            local row is kept.
//   { edit: true, names? } — resubmit PREDEFINED templates' content (e.g. copy
//                            changes) to Meta by their stored meta_template_id
//   { editDb: true, name, language?, button_url? }
//                          — legacy: rebuild a dashboard template from its row,
//                            optionally swapping the URL button link
//   { sync: true } | { action: "sync" }
//                          — pull every template from Meta, mirror real
//                            status/body/category/quality back into wa_templates
//                            (pg_cron runs this every 15 min, see migration
//                            20260929110000_wa_templates_v2.sql)
//   { waba?: "..." }       — optional explicit WABA id (else secret/discovery)
//
// Blank labels: the dashboard may send template.body_labels (one per body
// blank, "" = none). They are stored as wa_templates.variables[i].label and
// kept across edit and sync (Meta never sees them); see
// _shared/template-variables.ts.
//
// Dashboard templates are re-validated server-side with the same rules the
// builder uses (_shared/template-rules.ts, twin of the app's
// src/lib/whatsapp/template-rules-core.ts). Failures return
//   400 { ok:false, error, issues:[{field,message,fix?}] }
// Meta API failures return { ok:false, error, meta_error:{code,subcode,...} }.
//
// GET ?debug=1 — dump token + WABA discovery diagnostics.
//
// Auth: service-role bearer via requireInternal (verify_jwt alone is NOT
// authorization — the public anon key passes it). Called by the Next.js API
// routes and pg_cron with the service-role bearer.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { uploadResumable, fetchMediaBytes } from "../_shared/whatsapp.ts";
import { intentLabel, quickRepliesFor } from "../_shared/quick-replies.ts";
import { finalFooter, validateCore, type CoreIssue } from "../_shared/template-rules.ts";
import {
  FEEDBACK_CHOICES,
  FEEDBACK_TEMPLATE_BODY,
  FEEDBACK_TEMPLATE_BUTTON_LABELS,
  REVIEW_FEEDBACK_FOOTER,
  REVIEW_FEEDBACK_TEMPLATE,
} from "../_shared/review-feedback.ts";
import { buildVariables, incomingLabels, storedLabels } from "../_shared/template-variables.ts";

type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;
const WA_MEDIA_BUCKET = Deno.env.get("WA_MEDIA_BUCKET") ?? "wa-media";

function token(): string {
  const t = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!t) throw new Error("Missing WHATSAPP_ACCESS_TOKEN");
  return t;
}

type MetaCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

// `example` is a string when authored in the dashboard, but Meta returns it as
// a one-element array on synced rows; buildComponents normalises both.
type TplButton =
  | { type: "URL"; text: string; url: string; example?: string | string[] }
  | { type: "QUICK_REPLY"; text: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

interface TemplateDef {
  name: string;
  language: string;
  category: MetaCategory;
  header?: string;          // optional TEXT header
  headerFormat?: HeaderFormat;  // media header type; defaults to TEXT when `header` set
  headerMediaUrl?: string;  // public URL to the sample/brand media (create-time only)
  body: string;             // positional {{1}} {{2}} …
  footer?: string;
  bodyExample: string[];    // one sample value per body variable, in order
  headerExample?: string[]; // one sample value per header variable
  // optional URL button — static link, or dynamic when url carries a trailing
  // {{1}} (filled per send), in which case `example` provides a sample URL.
  // Kept for the predefined journey set; the dashboard builder uses `buttons`.
  button?: { text: string; url: string; example?: string };
  // optional typed button set from the dashboard builder (up to 10).
  buttons?: TplButton[];
  // Dashboard-only names for the body blanks ({"1":"First name"}); never sent
  // to Meta, stored as variables[i].label. Undefined = the caller sent none
  // (older dashboard build), so existing stored labels are kept.
  bodyLabels?: Record<string, string>;
}

type MetaErr = {
  code?: number;
  subcode?: number;
  message?: string;
  user_title?: string;
  user_msg?: string;
  details?: string;
};

class ValidationFailed extends Error {
  constructor(public issues: CoreIssue[]) {
    super(issues[0]?.message ?? "template is not valid");
  }
}

// Predefined journey set — variable contracts mirror what shopify-wa /
// wa-journey-tick actually send.
//   order_confirmation     : 1=name 2=orderRef 3=total
//   shipping_update        : 1=name 2=orderRef 3=tracking
//   order_confirmation_v3        : 1=name 2=orderRef   (buttoned successor)
//   order_confirmation_repeat_v2 : 1=name 2=orderRef   (buttoned successor)
//   shipping_update_v2           : 1=name 2=orderRef 3=tracking (buttoned successor)
//   abandoned_checkout     : 1=name 2=coupon   3=cartUrl
//   review_request         : 1=name 2=reviewUrl
//   review_feedback_v1     : 1=name   (3 quick replies, rvf: payloads)
//   replenishment_reminder : 1=name 2=siteUrl
// Button text for the service quick replies comes from _shared/quick-replies.ts,
// which is also what builds the per-send payloads. One source of truth: a label
// can never drift between what Meta approved and what we send a payload for.
const serviceButtons = (tplName: string): TplButton[] =>
  quickRepliesFor(tplName).map((i) => ({ type: "QUICK_REPLY" as const, text: intentLabel(i) }));

const TEMPLATES: TemplateDef[] = [
  {
    name: "order_confirmation",
    language: "en",
    category: "UTILITY",
    body:
      "You're in, {{1}}! 🎉\n\n" +
      "Order {{2}} is confirmed — total {{3}}. Our team is already packing your protein, and we'll ping you the second it ships.\n\n" +
      "Welcome to the PROMUNCH family — happy munching!",
    bodyExample: ["Aarav", "#PM1042", "₹598"],
    footer: "PROMUNCH — snack smart",
  },
  {
    // Returning-customer order confirmation — same 2-var contract as
    // order_confirmation_v2 (1=name 2=orderRef). The Flows tab "Returning
    // customer template" setting points at this; the send path falls back to
    // the first-order template until Meta approves it.
    name: "order_confirmation_repeat_v1",
    language: "en",
    category: "UTILITY",
    body:
      "Welcome back, {{1}}! 🎉\n\n" +
      "Order {{2}} is confirmed. Your protein is already being packed and we'll ping you the second it ships.\n\n" +
      "Happy munching!",
    bodyExample: ["Aarav", "#PM1042"],
    footer: "PROMUNCH",
  },
  {
    name: "shipping_update",
    language: "en",
    category: "UTILITY",
    body:
      "It's on the way, {{1}}! 🚚\n\n" +
      "Order {{2}} is packed, sealed and moving. Track it live:\n{{3}}\n\n" +
      "Get the bowls ready — munch time soon!",
    bodyExample: ["Aarav", "#PM1042", "https://track.promunch.in/PM1042"],
    footer: "PROMUNCH — snack smart",
  },
  // ---- WINDOW-MANUFACTURING UTILITY SET -----------------------------------
  // These three are the buttoned successors to order_confirmation_v2,
  // order_confirmation_repeat_v1 and shipping_update. They are NEW names, not
  // edits: an edit re-submits an approved template for review and the old copy
  // keeps sending until Meta re-approves, so live-editing the order
  // confirmation would put the business's 99%-delivered lifeline through Meta
  // review for a button. Same variable contracts as their predecessors, so
  // switching over is a Flows-tab / template-name change with no code contract
  // change and an instant rollback (point the name back).
  //
  // The buttons are SERVICE intents only (see _shared/quick-replies.ts for the
  // Meta category reasoning). Each tap is an inbound message, which opens the
  // 24h service window where free-form delivery is ~99% instead of ~16%.
  {
    // Buttoned first-order confirmation. 1=name 2=orderRef
    name: "order_confirmation_v3",
    language: "en",
    category: "UTILITY",
    body:
      "You're in, {{1}}! 🎉\n\n" +
      "Order {{2}} is confirmed. We're packing your protein right now and we'll message you the moment it ships.\n\n" +
      "Need anything before it goes out? Tap below and we'll sort it.",
    bodyExample: ["Aarav", "#PM1042"],
    footer: "Your Munchy Pal",
    buttons: serviceButtons("order_confirmation_v3"),
  },
  {
    // Buttoned returning-customer confirmation. 1=name 2=orderRef
    name: "order_confirmation_repeat_v2",
    language: "en",
    category: "UTILITY",
    body:
      "Welcome back, {{1}}! 🎉\n\n" +
      "Order {{2}} is confirmed. Your protein is already being packed and we'll ping you the second it ships.\n\n" +
      "Need anything before it goes out? Tap below and we'll sort it.",
    bodyExample: ["Aarav", "#PM1042"],
    footer: "Your Munchy Pal",
    buttons: serviceButtons("order_confirmation_repeat_v2"),
  },
  {
    // Buttoned shipping notification. 1=name 2=orderRef 3=tracking
    // The tracking link stays in the body (it is the Shopify order-status page,
    // never a guessed carrier deep link) and the buttons cover what a customer
    // actually needs once a parcel is moving.
    name: "shipping_update_v2",
    language: "en",
    category: "UTILITY",
    body:
      "It's on the way, {{1}}! 🚚\n\n" +
      "Order {{2}} is packed, sealed and moving. Track it live:\n{{3}}\n\n" +
      "Anything not right? Tap below and we'll help.",
    bodyExample: ["Aarav", "#PM1042", "https://track.promunch.in/PM1042"],
    footer: "Your Munchy Pal",
    buttons: serviceButtons("shipping_update_v2"),
  },
  {
    // Sent mid-call by the Sarvam voice agent when the customer asks for their
    // cart link. UTILITY: the customer requested it seconds ago on the phone.
    // 1=name 2=full https checkout URL (body param, not a button, so the
    // partner recovery URL survives untouched).
    name: "cart_link_requested",
    language: "en",
    category: "UTILITY",
    body:
      "Hi {{1}}, here is the PROMUNCH checkout link you asked for on our call:\n{{2}}\n\n" +
      "Your cart is saved, just tap to finish.",
    bodyExample: ["Aarav", "https://promunch.in/12345/checkouts/abc123/recover"],
    footer: "Your Munchy Pal",
  },
  {
    // Abandoned-cart reminder (step 1) — NO discount. Just a nudge back to the
    // customer's own recovery checkout. The "Complete Order" URL button is a
    // dynamic link: base https://promunch.in/{{1}}, filled with the recovery
    // checkout path so tapping it drops them straight back on their cart.
    name: "abandoned_cart_reminder",
    language: "en",
    category: "MARKETING",
    body:
      "Hey {{1}}, you forgot something tasty 👀\n\n" +
      "Your PROMUNCH picks are still sitting in the cart, waiting for you. Tap below to finish in seconds — right where you left off.\n\n" +
      "— Your Munchy Pal 💚",
    bodyExample: ["Aarav"],
    footer: "Reply STOP to unsubscribe",
    button: {
      text: "Complete Order",
      url: "https://promunch.in/{{1}}",
      example: "https://promunch.in/12345/checkouts/abc123/recover",
    },
  },
  {
    // Abandoned-cart recovery (step 2/3) — image-free, with a "Checkout Now"
    // URL button. The button is a dynamic Shopify discount link: it applies the
    // coupon and redirects to the customer's own recovery checkout (discount
    // pre-applied). Sent only after the reminder fails to convert.
    name: "abandoned_cart_recovery",
    language: "en",
    category: "MARKETING",
    body:
      "Still thinking it over, {{1}}? Let's make it easy 😉\n\n" +
      "We've unlocked a special discount on your cart — already applied, no code needed. Just tap below and it's done.\n\n" +
      "— Your Munchy Pal 💚",
    bodyExample: ["Aarav"],
    footer: "Reply STOP to unsubscribe",
    button: {
      text: "Checkout Now",
      url: "https://promunch.in/{{1}}",
      example: "https://promunch.in/discount/PROMUNCH10?redirect=%2Fcart",
    },
  },
  {
    name: "review_request",
    language: "en",
    category: "MARKETING",
    body:
      "Hey {{1}}! Have the snacks hit the spot yet? 😋\n\n" +
      "If PROMUNCH made your munch-time better, a quick review would make our day, 30 seconds, promise:\n{{2}}\n\n" +
      "Your Munchy Pal 💚",
    bodyExample: ["Aarav", "https://promunch.in/reviews"],
    footer: "Reply STOP to unsubscribe",
  },
  {
    // Review FEEDBACK ask (owner-approved Oct 9 2026), the buttoned successor
    // to review_request, sent only when wa_flow_settings.review_feedback_enabled
    // is on. Three quick replies; the rvf:<choice>:<journey run id> payload is
    // injected per send (_shared/review-feedback.ts buildFeedbackTemplateComponents),
    // so button ORDER here must stay Loved / okay / Not happy. Button labels
    // carry no emoji (template-rules: Meta rejects emojis in template buttons);
    // the in-window interactive version uses the emoji labels.
    // finalFooter() appends the STOP notice (MARKETING), so the footer Meta sees
    // is "Your Munchy Pal · Reply STOP to unsubscribe".
    //   1=name
    name: REVIEW_FEEDBACK_TEMPLATE,
    language: "en",
    category: "MARKETING",
    body: FEEDBACK_TEMPLATE_BODY,
    bodyExample: ["Aarav"],
    footer: REVIEW_FEEDBACK_FOOTER,
    buttons: FEEDBACK_CHOICES.map((c) => ({ type: "QUICK_REPLY" as const, text: FEEDBACK_TEMPLATE_BUTTON_LABELS[c] })),
  },
  {
    name: "replenishment_reminder",
    language: "en",
    category: "MARKETING",
    body:
      "Snack check, {{1}} — running low? 👀\n\n" +
      "It's been about a month since your last PROMUNCH haul. Restock before the jar hits empty:\n{{2}}\n\n" +
      "— Your Munchy Pal 💚",
    bodyExample: ["Aarav", "https://promunch.in"],
    footer: "Reply STOP to unsubscribe",
  },
  {
    // COD confirmation gate (RTO reduction). Sent instead of order_confirmation
    // for COD orders. Two quick-reply buttons; the CONFIRM_/CANCEL_ payload is
    // injected per send (buildVerifyComponents), so the button text here is
    // cosmetic and the payload carries the Shopify order id.
    //   1=name 2=orderRef 3=total
    name: "order_verify_v1",
    language: "en",
    category: "UTILITY",
    body:
      "Hi {{1}}! Your PROMUNCH order {{2}} is in 🎉\n\n" +
      "Total {{3}}, payable Cash on Delivery. We ship COD orders only after a quick confirmation.\n\n" +
      "Please tap below to confirm 👇",
    bodyExample: ["Priya", "#PM2091", "₹398"],
    footer: "Your Munchy Pal",
    buttons: [
      { type: "QUICK_REPLY", text: "Confirm order" },
      { type: "QUICK_REPLY", text: "Cancel order" },
    ],
  },
  {
    // COD gate reminder — one nudge if the customer hasn't tapped. Same buttons
    // and same 3-var contract as order_verify_v1.
    //   1=name 2=orderRef 3=total
    name: "order_verify_reminder_v1",
    language: "en",
    category: "UTILITY",
    body:
      "Hi {{1}}! Just a quick nudge about your PROMUNCH order {{2}} ({{3}}, Cash on Delivery).\n\n" +
      "We pack it the moment you confirm. Tap below 👇",
    bodyExample: ["Priya", "#PM2091", "₹398"],
    footer: "Your Munchy Pal",
    buttons: [
      { type: "QUICK_REPLY", text: "Confirm order" },
      { type: "QUICK_REPLY", text: "Cancel order" },
    ],
  },
  {
    // INTERNAL ops alert — sent to OPS_WA_ID (not a customer) the instant a
    // customer explicitly cancels, so the order is pulled before dispatch.
    //   1=orderRef 2=customerName 3=customerPhone 4=reason
    name: "order_cancel_ops",
    language: "en",
    category: "UTILITY",
    body:
      "🚨 CANCEL ASAP — Order {{1}}\n\n" +
      "Customer: {{2}}\n" +
      "Phone: {{3}}\n" +
      "Reason: {{4}}\n\n" +
      "Pull this order before dispatch and confirm the cancellation back to the team.",
    bodyExample: ["#PM1042", "Aarav Sharma", "+919876543210", "Ordered the wrong flavour, wants to cancel"],
  },
  {
    // INTERNAL generic ops alert — sent to a human's WhatsApp (never a customer)
    // the moment the AI raises a ticket. Routed by lane: order issues go to the
    // ops guard (OPS_WA_ID) then Narendra (OPS_WA_ID_2) on SLA fallback; every
    // other ticket goes to the owner (ESCALATION_WA_ID). Reply "done <ticket#>"
    // back on WhatsApp to close it — no dashboard needed.
    //   1=type label  2=ticket#  3=customerName  4=customerPhone  5=details
    name: "ops_ticket_alert",
    language: "en",
    category: "UTILITY",
    body:
      "🚨 {{1}} — Ticket {{2}}\n\n" +
      "Customer: {{3}}\n" +
      "Phone: {{4}}\n" +
      "Details: {{5}}\n\n" +
      "Reply \"done {{2}}\" here once it is handled.",
    bodyExample: ["Order issue", "1042", "Aarav Sharma", "+919876543210", "Wants to cancel, ordered the wrong flavour"],
  },
];

Deno.serve(async (req) => {
  // Internal auth first — this covers GET ?debug=1 too (it dumps token/WABA
  // diagnostics, which must never be publicly reachable). There is no Meta
  // webhook verify path here; every caller sends the service-role bearer.
  const gate = requireInternal(req);
  if (gate) return gate;

  // GET ?debug=1 — diagnose WABA discovery.
  if (req.method === "GET" && new URL(req.url).searchParams.get("debug")) {
    return j(await diagnose());
  }
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = typeof b?.action === "string" ? b.action : null;

  // Resolve the WhatsApp Business Account id: explicit body > secret > discovery.
  let waba: string | null =
    (typeof b?.waba === "string" && b.waba.trim()) ||
    Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID") ||
    null;
  if (!waba) waba = await discoverWaba().catch(() => null);
  if (!waba) {
    return j({
      error:
        "Could not resolve WhatsApp Business Account id. Set the " +
        "WHATSAPP_BUSINESS_ACCOUNT_ID secret, or ensure the access token has " +
        "whatsapp_business_management permission.",
    }, 400);
  }

  const sb = db();

  // --- sync mode: pull Meta's templates into wa_templates --------------------
  if (b?.sync === true || action === "sync") {
    try {
      const synced = await syncFromMeta(waba, sb);
      return j({ ok: true, mode: "sync", waba, synced });
    } catch (e) {
      return j({ ok: false, error: String(e) }, 500);
    }
  }

  // --- delete: at Meta first, then locally ---------------------------------
  if (action === "delete") {
    const name = typeof b?.name === "string" ? b.name : null;
    const language = typeof b?.language === "string" ? b.language : "en";
    if (!name) return j({ ok: false, error: "delete requires name" }, 400);
    const { data: row } = await sb.from("wa_templates").select("id, meta_template_id")
      .eq("name", name).eq("language", language).maybeSingle();
    if (!row) return j({ ok: false, error: `template '${name}' (${language}) not found` }, 404);
    // Campaigns reference templates (FK, no cascade). A live campaign would
    // fail mid-send, so refuse BEFORE touching Meta. A template only used by
    // finished campaigns is deleted at Meta but its row is kept (disabled) so
    // campaign history stays intact and the FK can't strand a half-delete.
    const { data: users, error: usersErr } = await sb.from("wa_campaigns").select("id, name, status")
      .eq("template_id", row.id).limit(1000);
    if (usersErr) return j({ ok: false, mode: "delete", error: `could not check campaigns: ${usersErr.message}` }, 500);
    const live = (users ?? []).filter((c) => ["draft", "scheduled", "sending", "paused"].includes(String(c.status)));
    if (live.length) {
      return j({
        ok: false,
        mode: "delete",
        error: `This template is used by ${live.length} campaign(s) that have not finished (${
          live.slice(0, 3).map((c) => `"${c.name}"`).join(", ")
        }). Cancel them or switch their template first.`,
      }, 409);
    }
    if (row.meta_template_id) {
      const deleted = await deleteAtMeta(waba, name, String(row.meta_template_id));
      if (!deleted.ok) return j({ mode: "delete", ...deleted });
    }
    if ((users ?? []).length) {
      const { error } = await sb.from("wa_templates").update({ status: "disabled" }).eq("id", row.id);
      if (error) return j({ ok: false, mode: "delete", error: `deleted at Meta but local update failed: ${error.message}` }, 500);
      return j({ ok: true, mode: "delete", name, language, meta_deleted: !!row.meta_template_id, kept_for_history: true });
    }
    const { error } = await sb.from("wa_templates").delete().eq("id", row.id);
    if (error) return j({ ok: false, mode: "delete", error: `deleted at Meta but local delete failed: ${error.message}` }, 500);
    return j({ ok: true, mode: "delete", name, language, meta_deleted: !!row.meta_template_id });
  }

  // --- edit: full-component edit of a dashboard template -------------------
  if (action === "edit") {
    let def: TemplateDef;
    try {
      def = normalizeIncoming((b?.template ?? {}) as Record<string, unknown>);
    } catch (e) {
      return invalid(e);
    }
    const { data: row } = await sb.from("wa_templates").select("*")
      .eq("name", def.name).eq("language", def.language).maybeSingle();
    if (!row) return j({ ok: false, error: `template '${def.name}' (${def.language}) not found` }, 404);
    if (!row.meta_template_id) {
      return j({ ok: false, error: "This template was never submitted to Meta, so submit it as new instead of editing." }, 400);
    }
    // Meta only edits APPROVED, REJECTED or PAUSED templates; one still in
    // review is refused, so say so instead of relaying a cryptic Graph error.
    if (row.status === "pending") {
      return j({ ok: false, error: "Meta is still reviewing this template. Wait for the verdict, then edit it." }, 409);
    }
    const oldCat = metaCategory(String(row.category ?? "marketing"));
    const categoryChanged = oldCat !== def.category;
    if (categoryChanged && row.status === "approved") {
      return j({
        ok: false,
        error: "Category cannot be changed on an approved template. Use Duplicate as new version to submit it under the new category.",
        issues: [{ field: "category", message: "Category cannot be changed on an approved template.", fix: "Use Duplicate as new version instead." }],
      }, 400);
    }
    const edited = await editTemplate(String(row.meta_template_id), def, categoryChanged ? def.category : undefined);
    if (edited.ok) {
      await writeTolerant((r) => sb.from("wa_templates").update(r).eq("id", row.id), {
        status: "pending",
        // Keep the CRM-only 'offer' bucket when Meta's category is unchanged.
        category: categoryChanged ? localCategory(def.category) : row.category,
        header_type: def.headerFormat ?? null,
        header_text: def.header ?? null,
        header_media_url: def.headerFormat && def.headerFormat !== "TEXT" ? def.headerMediaUrl ?? null : null,
        body: def.body,
        footer: def.footer ?? null,
        buttons: def.buttons ?? null,
        // Labels the marketer gave the blanks; keep the stored ones when this
        // request carried none (older dashboard build).
        variables: buildVariables(def.bodyExample, def.bodyLabels ?? {}, def.bodyLabels ? {} : storedLabels(row.variables)),
        header_samples: def.headerExample?.length ? def.headerExample : null,
        rejection_reason: null,
        rejected_reason_detail: null,
        pending_edit: null,
        needs_media: false,
      });
    }
    return j({ mode: "edit", name: def.name, language: def.language, ...edited });
  }

  // --- edit mode: resubmit existing templates' content to Meta --------------
  // { edit: true, names?: [...] } — rebuild components from the local TEMPLATES
  // defs and PATCH them at Meta by their stored meta_template_id. Used to push
  // copy changes (e.g. the brand tagline) onto already-approved templates.
  if (b?.edit === true) {
    const names: string[] | undefined = Array.isArray(b?.names) && b.names.length
      ? (b.names as string[])
      : undefined;
    const editDefs = names ? TEMPLATES.filter((t) => names.includes(t.name)) : TEMPLATES;
    if (editDefs.length === 0) return j({ error: "no matching template names" }, 400);

    const results: Array<Record<string, unknown>> = [];
    for (const def of editDefs) {
      const { data: row } = await sb
        .from("wa_templates")
        .select("meta_template_id, variables")
        .eq("name", def.name).eq("language", def.language)
        .maybeSingle();
      const id = row?.meta_template_id;
      if (!id) {
        results.push({ name: def.name, ok: false, error: "no meta_template_id on file — create it first" });
        continue;
      }
      const edited = await editTemplate(String(id), def);
      results.push({ name: def.name, ...edited });
      if (edited.ok) {
        await sb.from("wa_templates").update({
          status: "pending",
          body: def.body,
          footer: def.footer ?? null,
          variables: buildVariables(def.bodyExample, {}, storedLabels(row?.variables)),
          rejection_reason: null,
        }).eq("name", def.name).eq("language", def.language);
      }
    }
    return j({ ok: results.every((r) => r.ok), mode: "edit", waba, results });
  }

  // --- editDb mode: edit a DASHBOARD-made template (one NOT in the hardcoded
  // TEMPLATES set) by rebuilding its Meta components from its wa_templates row.
  // { editDb:true, name, language?, button_url? } — optionally swap the URL
  // button's link. Re-uploads any media header, PATCHes Meta (re-review ->
  // pending) and mirrors the change locally.
  if (b?.editDb === true) {
    const name = typeof b?.name === "string" ? b.name : null;
    if (!name) return j({ error: "editDb requires name" }, 400);
    const language = typeof b?.language === "string" ? b.language : "en";
    const { data: row } = await sb.from("wa_templates").select("*")
      .eq("name", name).eq("language", language).maybeSingle();
    if (!row) return j({ error: `template '${name}' (${language}) not found` }, 404);
    if (!row.meta_template_id) return j({ error: "no meta_template_id on file — create it first" }, 400);

    const dbButtons: TplButton[] = Array.isArray(row.buttons) ? row.buttons : [];
    const newUrl = typeof b?.button_url === "string" ? b.button_url : null;
    const buttons = dbButtons.map((bt) =>
      bt.type === "URL" && newUrl ? { ...bt, url: newUrl } : bt
    );
    const def: TemplateDef = {
      name: row.name,
      language: row.language ?? language,
      category: String(row.category ?? "marketing").toUpperCase() === "OFFER"
        ? "MARKETING"
        : String(row.category ?? "marketing").toUpperCase() as MetaCategory,
      headerFormat: (row.header_type ?? "TEXT") as HeaderFormat,
      headerMediaUrl: row.header_media_url ?? undefined,
      header: row.header_text ?? undefined,
      body: row.body ?? "",
      footer: row.footer ?? undefined,
      bodyExample: Array.isArray(row.variables)
        ? row.variables.map((v: { sample?: string }) => v.sample ?? "")
        : [],
      headerExample: Array.isArray(row.header_samples) ? row.header_samples.map(String) : undefined,
      buttons: buttons.length ? buttons : undefined,
    };
    const edited = await editTemplate(String(row.meta_template_id), def);
    if (edited.ok) {
      await sb.from("wa_templates").update({
        status: "pending",
        buttons: buttons.length ? buttons : null,
        rejection_reason: null,
      }).eq("id", row.id);
    }
    return j({ mode: "editDb", name, language, button_url: newUrl, ...edited });
  }

  // --- build the list of definitions to create ------------------------------
  let defs: TemplateDef[];
  if (b?.template) {
    try {
      defs = [normalizeIncoming(b.template as Record<string, unknown>)];
    } catch (e) {
      return invalid(e);
    }
  } else {
    const names: string[] | undefined = Array.isArray(b?.names) && b.names.length
      ? (b.names as string[])
      : undefined;
    defs = names ? TEMPLATES.filter((t) => names.includes(t.name)) : TEMPLATES;
  }
  if (defs.length === 0) return j({ error: "no matching template names" }, 400);

  const results: Array<Record<string, unknown>> = [];
  for (const def of defs) {
    const created = await createTemplate(waba, def);
    results.push({ name: def.name, ...created });

    // Mirror Meta's response into the local registry.
    if (created.ok) {
      // A local draft of the same name may already hold blank labels; keep
      // them unless this request carried its own.
      const { data: prior } = def.bodyLabels
        ? { data: null }
        : await sb.from("wa_templates").select("variables").eq("name", def.name).eq("language", def.language).maybeSingle();
      // Keep the CRM-only 'offer' bucket if the dashboard sent it.
      const incomingCat = b?.template ? String((b.template as Record<string, unknown>).category ?? "").toLowerCase() : "";
      await writeTolerant((r) => sb.from("wa_templates").upsert(r, { onConflict: "name,language" }), {
        name: def.name,
        language: def.language,
        category: incomingCat === "offer" ? "offer" : localCategory(def.category),
        status: localStatus(created.status),
        meta_template_id: created.id ?? null,
        header_type: def.headerFormat ?? (def.header ? "TEXT" : null),
        header_text: def.header ?? null,
        header_media_url: def.headerMediaUrl ?? null,
        body: def.body,
        footer: def.footer ?? null,
        buttons: def.buttons ?? (def.button ? [{ type: "URL", ...def.button }] : null),
        variables: buildVariables(def.bodyExample, def.bodyLabels ?? {}, storedLabels(prior?.variables)),
        header_samples: def.headerExample?.length ? def.headerExample : null,
        rejection_reason: null,
        rejected_reason_detail: null,
        needs_media: false,
      });
    }
  }

  return j({ ok: results.every((r) => r.ok), waba, results });
});

function invalid(e: unknown): Response {
  if (e instanceof ValidationFailed) {
    return j({ ok: false, error: e.message, issues: e.issues }, 400);
  }
  return j({ ok: false, error: String(e instanceof Error ? e.message : e) }, 400);
}

// Accept a dashboard-builder template object and shape it into a TemplateDef.
// Re-validates with the same core rules as the dashboard builder; throws
// ValidationFailed with every issue so the UI can show them all at once.
function normalizeIncoming(t: Record<string, unknown>): TemplateDef {
  const name = String(t.name ?? "").trim();
  const body = String(t.body ?? "").trim();
  const header = t.header_text ? String(t.header_text).trim() : undefined;
  const footer = t.footer ? String(t.footer).trim() : undefined;

  // Media header (image/video/document). header_media_url is a public URL we
  // resolve into a Meta upload handle at create time.
  const hf = String(t.header_format ?? "").toUpperCase();
  const headerFormat: HeaderFormat | undefined =
    hf === "IMAGE" || hf === "VIDEO" || hf === "DOCUMENT" ? hf : (header ? "TEXT" : undefined);
  const headerMediaUrl = t.header_media_url ? String(t.header_media_url).trim() : undefined;

  const bodyExample = (Array.isArray(t.body_samples) ? t.body_samples : []).map(String);
  const headerExample = (Array.isArray(t.header_samples) ? t.header_samples : []).map(String);

  // Legacy single `button` shape → typed buttons for validation.
  const legacyButton = t.button && typeof t.button === "object" ? t.button as Record<string, unknown> : null;
  const rawButtons: Record<string, unknown>[] = Array.isArray(t.buttons) && t.buttons.length
    ? t.buttons as Record<string, unknown>[]
    : legacyButton && legacyButton.text && legacyButton.url
    ? [{ type: "URL", ...legacyButton }]
    : [];

  const issues = validateCore({
    name,
    category: String(t.category ?? "utility"),
    header_type: headerFormat ?? null,
    header_text: header ?? null,
    header_media_url: headerMediaUrl ?? null,
    body,
    footer: footer ?? null,
    buttons: rawButtons.map((raw) => ({
      type: String(raw.type ?? ""),
      text: String(raw.text ?? ""),
      url: raw.url === undefined ? undefined : String(raw.url),
      example: Array.isArray(raw.example) ? raw.example.map(String) : raw.example ? String(raw.example) : undefined,
      phone_number: raw.phone_number === undefined ? undefined : String(raw.phone_number),
    })),
    body_samples: bodyExample,
    header_samples: headerExample,
  });
  if (issues.length) throw new ValidationFailed(issues);

  const bodyVars = countVars(body);
  const headerVars = header ? countVars(header) : 0;

  let buttons: TplButton[] | undefined;
  if (rawButtons.length) {
    buttons = rawButtons.map((raw) => {
      const type = String(raw.type ?? "").toUpperCase();
      const text = String(raw.text ?? "").trim();
      if (type === "URL") {
        const url = String(raw.url ?? "").trim();
        const ex = Array.isArray(raw.example) ? raw.example[0] : raw.example;
        const example = ex ? String(ex).trim() : undefined;
        return { type: "URL", text, url, example: countVars(url) > 0 ? example : undefined };
      }
      if (type === "PHONE_NUMBER") {
        const phone = String(raw.phone_number ?? "").replace(/[\s-]/g, "");
        return { type: "PHONE_NUMBER", text, phone_number: phone };
      }
      return { type: "QUICK_REPLY", text };
    });
  }

  return {
    name,
    language: String(t.language ?? "en").trim() || "en",
    category: metaCategory(String(t.category ?? "utility")),
    header: headerFormat === "TEXT" ? header : undefined,
    headerFormat,
    headerMediaUrl: headerFormat && headerFormat !== "TEXT" ? headerMediaUrl : undefined,
    body,
    footer,
    bodyExample: bodyExample.slice(0, bodyVars),
    headerExample: headerExample.slice(0, headerVars),
    buttons,
    bodyLabels: t.body_labels === undefined ? undefined : incomingLabels(t.body_labels),
  };
}

function countVars(s: string): number {
  const m = s.match(/\{\{(\d+)\}\}/g) ?? [];
  return new Set(m.map((x) => x.replace(/[{}]/g, ""))).size;
}

// Local category ('offer' is a CRM-only bucket) → Meta category.
function metaCategory(c: string): MetaCategory {
  const v = c.toLowerCase();
  if (v === "authentication") return "AUTHENTICATION";
  if (v === "utility") return "UTILITY";
  return "MARKETING"; // marketing + offer
}
function localCategory(c: MetaCategory): string {
  return c.toLowerCase();
}
// Meta template status → wa_templates.status check set
// ('draft','pending','approved','rejected','disabled'; the UI shows
// 'disabled' as Paused).
function localStatus(s?: string): string {
  const v = String(s ?? "PENDING").toUpperCase();
  if (v === "APPROVED") return "approved";
  if (v === "REJECTED") return "rejected";
  if (v === "PAUSED" || v === "DISABLED") return "disabled";
  return "pending";
}

// Columns added by migration 20260929110000_wa_templates_v2.sql. If the edge
// function is deployed before that migration is applied, writes that include
// them fail with "column does not exist"; retry without them so create, edit
// and sync keep working (deploy-order safe).
const V2_COLUMNS = [
  "quality_score", "rejected_reason_detail", "previous_category", "header_samples",
  "needs_media", "pending_edit", "last_synced_at",
];

async function writeTolerant(
  run: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string; code?: string } | null }>,
  row: Record<string, unknown>,
): Promise<string | null> {
  const first = await run(row);
  if (!first.error) return null;
  const msg = `${first.error.code ?? ""} ${first.error.message ?? ""}`;
  if (!/42703|PGRST204|column/i.test(msg)) return first.error.message ?? "write failed";
  const stripped = Object.fromEntries(Object.entries(row).filter(([k]) => !V2_COLUMNS.includes(k)));
  const second = await run(stripped);
  return second.error ? second.error.message ?? "write failed" : null;
}

// debug_token on the token itself exposes granular_scopes; the WhatsApp scopes
// carry the WABA id(s) in target_ids.
async function discoverWaba(): Promise<string | null> {
  const t = token();
  const res = await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`,
  );
  const json = await res.json().catch(() => ({}));
  const scopes = json?.data?.granular_scopes;
  if (!Array.isArray(scopes)) return null;
  for (const s of scopes) {
    if (typeof s?.scope === "string" && s.scope.includes("whatsapp")) {
      const ids = s?.target_ids;
      if (Array.isArray(ids) && ids.length) return String(ids[0]);
    }
  }
  return null;
}

async function diagnose(): Promise<Record<string, unknown>> {
  const t = token();
  const out: Record<string, unknown> = {};
  try {
    const r = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`,
    );
    out.debug_token = await r.json().catch(() => ({}));
  } catch (e) { out.debug_token_error = String(e); }
  out.discovered_waba = await discoverWaba().catch(() => null);
  return out;
}

// Build the Meta component array for a template def. Shared by create + edit so
// an edit always resends the FULL component set (body + footer + buttons) — Meta
// drops any component you omit on an edit.
// `headerHandle` is the Meta upload handle for a media header — resolved by the
// caller (createTemplate/editTemplate) via uploadResumable() before building.
function buildComponents(def: TemplateDef, headerHandle?: string): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];

  if (def.headerFormat && def.headerFormat !== "TEXT" && headerHandle) {
    // Image / video / document header. The handle stands in as the sample media.
    components.push({
      type: "HEADER",
      format: def.headerFormat,
      example: { header_handle: [headerHandle] },
    });
  } else if (def.header) {
    const h: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: def.header };
    if (countVars(def.header) > 0) h.example = { header_text: def.headerExample ?? [] };
    components.push(h);
  }

  const bodyComp: Record<string, unknown> = { type: "BODY", text: def.body };
  if (countVars(def.body) > 0) bodyComp.example = { body_text: [def.bodyExample] };
  components.push(bodyComp);

  // Marketing templates MUST carry an unsubscribe notice — Meta best practice,
  // and our opt-out flow (wa-webhook) keys on a bare "STOP". finalFooter (shared
  // with the dashboard preview) appends it unless the footer already has the
  // whole word STOP. It never truncates; over-long footers are rejected by
  // validateCore before we get here.
  const footer = finalFooter(def.category, def.footer);
  if (footer) components.push({ type: "FOOTER", text: footer });

  if (def.buttons && def.buttons.length) {
    // Typed multi-button set from the dashboard builder (or a synced row).
    const buttons = def.buttons.map((b) => {
      if (b.type === "URL") {
        const o: Record<string, unknown> = { type: "URL", text: b.text, url: b.url };
        // Synced rows already hold Meta's array shape; never double-wrap.
        const ex = Array.isArray(b.example) ? b.example[0] : b.example;
        if (countVars(b.url) > 0 && ex) o.example = [ex];
        return o;
      }
      if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number };
      return { type: "QUICK_REPLY", text: b.text };
    });
    components.push({ type: "BUTTONS", buttons });
  } else if (def.button) {
    const btn: Record<string, unknown> = {
      type: "URL",
      text: def.button.text,
      url: def.button.url,
    };
    // Meta requires a sample URL only when the button url has a {{1}} suffix.
    if (countVars(def.button.url) > 0 && def.button.example) {
      btn.example = [def.button.example];
    }
    components.push({ type: "BUTTONS", buttons: [btn] });
  }
  return components;
}

function metaError(json: any, status: number): { error: string; meta_error: MetaErr } {
  const e = json?.error ?? {};
  const meta_error: MetaErr = {
    code: typeof e.code === "number" ? e.code : undefined,
    subcode: typeof e.error_subcode === "number" ? e.error_subcode : undefined,
    message: e.message,
    user_title: e.error_user_title,
    user_msg: e.error_user_msg,
    details: e.error_data?.details,
  };
  const error = [
    e.message,
    e.error_user_title,
    e.error_user_msg,
    e.error_data?.details,
    e.error_subcode ? `subcode ${e.error_subcode}` : null,
  ].filter(Boolean).join(" | ") || `HTTP ${status}`;
  return { error, meta_error };
}

async function headerHandleFor(def: TemplateDef): Promise<{ handle?: string; error?: string }> {
  if (!(def.headerFormat && def.headerFormat !== "TEXT" && def.headerMediaUrl)) return {};
  try {
    const media = await fetchMediaBytes(def.headerMediaUrl);
    return { handle: await uploadResumable(media.bytes, media.mime) };
  } catch (e) {
    return { error: `header media upload failed: ${e instanceof Error ? e.message : e}` };
  }
}

async function createTemplate(
  waba: string,
  def: TemplateDef,
): Promise<{ ok: boolean; id?: string; status?: string; error?: string; meta_error?: MetaErr; meta?: unknown }> {
  const hh = await headerHandleFor(def);
  if (hh.error) return { ok: false, error: hh.error };
  const components = buildComponents(def, hh.handle);

  const reqBody = {
    name: def.name,
    language: def.language,
    category: def.category,
    components,
  };
  const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // surface the full Meta error AND the request we sent, for diagnosis
    const { error, meta_error } = metaError(json, res.status);
    return { ok: false, error, meta_error, meta: { status: res.status, error: json?.error, sent: reqBody } };
  }
  return { ok: true, id: json?.id, status: json?.status ?? "PENDING" };
}

// Edit an EXISTING template at Meta (POST /{template_id}). Name and language
// can't change. Category can change only while the template is NOT approved
// (pass `category` only then). Meta puts the template back into review;
// an approved template keeps delivering its OLD content until the edit is
// approved, so an edit never causes a send gap (unlike a delete+recreate).
// Meta limits edits of approved templates (~1 per 24h, 10 per 30 days).
async function editTemplate(
  templateId: string,
  def: TemplateDef,
  category?: MetaCategory,
): Promise<{ ok: boolean; status?: string; error?: string; meta_error?: MetaErr; meta?: unknown }> {
  const hh = await headerHandleFor(def);
  if (hh.error) return { ok: false, error: hh.error };
  const reqBody: Record<string, unknown> = { components: buildComponents(def, hh.handle) };
  if (category) reqBody.category = category;
  const res = await fetch(`${GRAPH}/${templateId}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, meta_error } = metaError(json, res.status);
    return { ok: false, error, meta_error, meta: { status: res.status, error: json?.error, sent: reqBody } };
  }
  return { ok: true, status: "PENDING" };
}

// Delete ONE language of a template at Meta: DELETE
// /{waba}/message_templates?name=...&hsm_id=... (name alone would delete every
// language). A template Meta no longer has counts as deleted.
async function deleteAtMeta(
  waba: string,
  name: string,
  hsmId: string,
): Promise<{ ok: boolean; error?: string; meta_error?: MetaErr }> {
  const url = `${GRAPH}/${waba}/message_templates?name=${encodeURIComponent(name)}&hsm_id=${encodeURIComponent(hsmId)}`;
  const res = await fetch(url, { method: "DELETE", headers: { "Authorization": `Bearer ${token()}` } });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) return { ok: true };
  const { error, meta_error } = metaError(json, res.status);
  if (/does not exist|not found|no template|nonexist/i.test(error)) return { ok: true };
  return { ok: false, error, meta_error };
}

// Short readable text per review rejection code, stored as
// rejected_reason_detail when Meta itself gives no detail. The dashboard has a
// fuller explanation (src/lib/whatsapp/template-errors.ts).
const REJECTION_TEXT: Record<string, string> = {
  INVALID_FORMAT: "Formatting problem (placeholders, emojis in header/footer/buttons, or layout).",
  TAG_CONTENT_MISMATCH: "The category does not match the message content.",
  INCORRECT_CATEGORY: "Meta thinks the template belongs in a different category.",
  PROMOTIONAL: "Promotional content in a Utility template.",
  ABUSIVE_CONTENT: "Content breaks WhatsApp's business or commerce policy.",
  SCAM: "Meta thinks the message could mislead people.",
  INVALID_URL: "One of the links was not accepted.",
};

// Fetch every template (all pages). Asks for quality_score + previous_category
// first; if this Graph version rejects those fields (#100), retries without.
async function fetchAllTemplates(waba: string): Promise<any[]> {
  const base = "name,language,status,category,components,rejected_reason,id";
  const attempts = [`${base},quality_score,previous_category`, base];
  for (let a = 0; a < attempts.length; a++) {
    const items: any[] = [];
    let url: string | null = `${GRAPH}/${waba}/message_templates?fields=${attempts[a]}&limit=200`;
    let fieldError = false;
    let pages = 0;
    while (url && pages < 20) {
      pages++;
      const res: Response = await fetch(url, { headers: { "Authorization": `Bearer ${token()}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (a === 0 && json?.error?.code === 100) { fieldError = true; break; }
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      if (Array.isArray(json?.data)) items.push(...json.data);
      url = typeof json?.paging?.next === "string" ? json.paging.next : null;
    }
    if (!fieldError) return items;
  }
  return [];
}

// Re-host a Meta example header file (Meta CDN URLs expire) into wa-media so
// campaigns can send it. Returns the public URL, or null if it can't be fetched.
async function rehostHeaderMedia(
  sb: ReturnType<typeof db>,
  srcUrl: string,
  name: string,
  language: string,
  format: string,
): Promise<string | null> {
  try {
    const r = await fetch(srcUrl);
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = mime === "image/png" ? "png"
      : mime === "image/jpeg" ? "jpg"
      : mime === "video/mp4" ? "mp4"
      : mime === "video/3gpp" ? "3gp"
      : mime === "application/pdf" ? "pdf"
      : format === "IMAGE" ? "jpg" : format === "VIDEO" ? "mp4" : "pdf";
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length) return null;
    const path = `templates/${name}-${language}-${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(WA_MEDIA_BUCKET).upload(path, bytes, {
      contentType: mime || undefined,
      upsert: false,
    });
    if (error) return null;
    return sb.storage.from(WA_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl ?? null;
  } catch {
    return null;
  }
}

// Pull every template Meta has for this WABA and mirror it into wa_templates.
async function syncFromMeta(
  waba: string,
  sb: ReturnType<typeof db>,
): Promise<Array<{ name: string; status: string }>> {
  const list = await fetchAllTemplates(waba);

  // Current local rows, to detect category changes and keep local-only data.
  // select("*") so this works before AND after the v2 migration.
  const { data: localRows } = await sb.from("wa_templates").select("*");
  const local = new Map<string, Record<string, any>>();
  for (const r of localRows ?? []) local.set(`${r.name}:${r.language}`, r);

  const out: Array<{ name: string; status: string }> = [];
  const now = new Date().toISOString();

  for (const t of list) {
    const metaStatus = String(t.status ?? "").toUpperCase();
    // Being deleted at Meta: never resurrect it locally.
    if (metaStatus === "PENDING_DELETION" || metaStatus === "DELETED") continue;

    const comps: any[] = Array.isArray(t.components) ? t.components : [];
    const find = (type: string) => comps.find((c) => c?.type === type);
    const bodyC = find("BODY");
    const headerC = find("HEADER");
    const footerC = find("FOOTER");
    const buttonsC = find("BUTTONS");

    const language = t.language ?? "en";
    const existing = local.get(`${t.name}:${language}`);
    const status = localStatus(t.status);
    const metaCat = String(t.category ?? "marketing").toLowerCase();
    let cat = ["marketing", "utility", "authentication"].includes(metaCat) ? metaCat : "marketing";
    // 'offer' is a CRM-only flavour of marketing; keep it.
    if (existing?.category === "offer" && cat === "marketing") cat = "offer";

    const row: Record<string, unknown> = {
      name: t.name,
      language,
      category: cat,
      status,
      meta_template_id: t.id ?? null,
      header_type: headerC?.format ?? null,
      header_text: headerC?.format === "TEXT" ? (headerC?.text ?? null) : null,
      body: bodyC?.text ?? "",
      footer: footerC?.text ?? null,
      buttons: buttonsC?.buttons ?? null,
      rejection_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : (status === "rejected" ? "NONE" : null),
      quality_score: t.quality_score?.score ?? null,
      last_synced_at: now,
    };

    // Meta's approved example values: keep samples in step for edits.
    const bodyEx = bodyC?.example?.body_text?.[0];
    if (Array.isArray(bodyEx) && bodyEx.length) {
      // Meta knows nothing of blank labels: keep the ones we already store
      // (merged by blank number) instead of wiping them every sync.
      row.variables = buildVariables(bodyEx, {}, storedLabels(existing?.variables));
    }
    const headerEx = headerC?.example?.header_text;
    if (Array.isArray(headerEx) && headerEx.length) row.header_samples = headerEx.map(String);

    // Readable rejection detail. Don't overwrite a richer one (wa-webhook
    // writes Meta's own text there when the status event arrives).
    if (status === "rejected") {
      if (!existing?.rejected_reason_detail) {
        row.rejected_reason_detail = REJECTION_TEXT[String(t.rejected_reason ?? "").toUpperCase()] ?? null;
      }
    } else {
      row.rejected_reason_detail = null;
    }

    // Category changes: remember where it came from so the UI can say
    // "Meta changed this from Utility to Marketing".
    const metaPrev = typeof t.previous_category === "string" ? t.previous_category.toLowerCase() : null;
    const oldCat = existing?.category === "offer" ? "marketing" : existing?.category;
    if (metaPrev && metaPrev !== metaCat) row.previous_category = metaPrev;
    else if (existing && existing.status !== "draft" && oldCat && oldCat !== metaCat) row.previous_category = existing.category;

    // Media headers created in WhatsApp Manager have no header_media_url here,
    // which makes them unusable in campaigns. Re-host Meta's example file.
    const fmt = String(headerC?.format ?? "").toUpperCase();
    if (fmt === "IMAGE" || fmt === "VIDEO" || fmt === "DOCUMENT") {
      if (!existing?.header_media_url) {
        const handle = headerC?.example?.header_handle?.[0];
        const hosted = typeof handle === "string" && /^https?:\/\//.test(handle)
          ? await rehostHeaderMedia(sb, handle, t.name, language, fmt)
          : null;
        if (hosted) {
          row.header_media_url = hosted;
          row.needs_media = false;
        } else {
          row.needs_media = true;
        }
      } else if (existing.needs_media) {
        row.needs_media = false;
      }
    } else {
      row.needs_media = false;
    }

    const err = await writeTolerant((r) => sb.from("wa_templates").upsert(r, { onConflict: "name,language" }), row);
    if (err) console.error("wa-template-create sync upsert failed", t.name, err);

    out.push({ name: t.name, status });
  }
  return out;
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });
}
