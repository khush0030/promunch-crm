// Email flow engine — the email twin of the WhatsApp wa-journey-tick machine.
//
// Drains due flow_enrollments and sends the current step. The atomic claim is an
// insert into email_sends under the (enrollment_id, step_index) partial-unique
// index: if the row already exists the step was already sent, so we skip and
// advance (never email a customer twice, AGENTS.md §4.1). Nothing here sends
// until a flow is set status='active' AND the email-flow-tick cron runs.

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail, DEFAULT_FROM } from "@/lib/resend";
import { renderMarketingEmail } from "./layout";
import { marketingHeaders } from "./unsubscribe";
import type { FlowStep } from "./flow-templates";

const BATCH = 200;
const PAGE = 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_HOURS = 6;
const PAUSE_DEFER_HOURS = 6;

type Enrollment = {
  id: string;
  flow_id: string;
  contact_id: string;
  current_step: number;
  context: Record<string, unknown> | null;
  deadline_at: string | null;
  attempts: number | null;
};

export type FlowTickResult = {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  completed: number;
  cancelled: number;
};

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Render the customer's actual cart as a table. Showing the real items is the
 * single biggest lift in a recovery email: "your cart is waiting" is generic,
 * "your 2 Cream & Onion Crunchies are waiting" is theirs. Item titles come from
 * Shopify, so they are escaped.
 */
function cartItemsHtml(ctx: Record<string, unknown>): string {
  const raw = Array.isArray(ctx.items) ? (ctx.items as Array<Record<string, unknown>>) : [];
  if (raw.length === 0) return "";
  const rows = raw.slice(0, 8).map((it) => {
    const title = esc(String(it.title ?? it.name ?? "Item"));
    const qty = Number(it.quantity ?? 1);
    const line = Number(it.price ?? 0) * qty;
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #EFE8DB;font-size:15px;color:#1A1714;">${title}${qty > 1 ? ` <span style="color:#6E665A;">x${qty}</span>` : ""}</td>
      <td style="padding:10px 0;border-bottom:1px solid #EFE8DB;font-size:15px;color:#1A1714;text-align:right;white-space:nowrap;">${money(line)}</td>
    </tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">${rows}</table>`;
}

/**
 * Stamp the recovery link so a recovered order is attributable to the exact
 * email that won it. utm_content carries the step number, which is what tells
 * us whether the coupon step is actually earning its margin give-away.
 */
function trackedCheckoutUrl(url: string, stepIndex: number): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "email");
    u.searchParams.set("utm_medium", "cart_recovery");
    u.searchParams.set("utm_campaign", "abandoned_cart");
    u.searchParams.set("utm_content", `email_${stepIndex + 1}`);
    return u.toString();
  } catch {
    return url;
  }
}

function personalize(
  html: string,
  ctx: Record<string, unknown> | null,
  first: string | null,
  stepIndex = 0,
  coupon = "",
): string {
  const c = ctx ?? {};
  const checkout = trackedCheckoutUrl(
    String(c.checkout_url ?? c.url ?? "https://promunch.in"),
    stepIndex,
  );
  const totalNum = Number(c.total ?? 0);
  return html
    .replace(/\{\{\s*first_name\s*\}\}/g, esc(first || "there"))
    .replace(/\{\{\s*checkout_url\s*\}\}/g, checkout)
    .replace(/\{\{\s*cart_items\s*\}\}/g, cartItemsHtml(c))
    .replace(/\{\{\s*cart_total\s*\}\}/g, totalNum > 0 ? money(totalNum) : "your cart")
    .replace(/\{\{\s*coupon_code\s*\}\}/g, esc(coupon));
}

/** Subjects support the same tokens; a name in the subject lifts opens. */
function personalizeSubject(
  subject: string,
  ctx: Record<string, unknown> | null,
  first: string | null,
  coupon = "",
): string {
  const totalNum = Number((ctx ?? {}).total ?? 0);
  return subject
    .replace(/\{\{\s*first_name\s*\}\}/g, first || "there")
    .replace(/\{\{\s*cart_total\s*\}\}/g, totalNum > 0 ? money(totalNum) : "your cart")
    .replace(/\{\{\s*coupon_code\s*\}\}/g, coupon);
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

async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  await supabase
    .from("flow_enrollments")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

async function advance(e: Enrollment, steps: FlowStep[]) {
  const next = e.current_step + 1;
  if (next >= steps.length) {
    await setStatus(e.id, "completed", { current_step: next, completed_at: new Date().toISOString() });
  } else {
    await supabase
      .from("flow_enrollments")
      .update({
        current_step: next,
        next_action_at: hoursFromNow(steps[next].delay_hours || 0),
        attempts: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", e.id);
  }
}

export async function tick(): Promise<FlowTickResult> {
  const res: FlowTickResult = { scanned: 0, sent: 0, skipped: 0, failed: 0, completed: 0, cancelled: 0 };
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("flow_enrollments")
    .select("id, flow_id, contact_id, current_step, context, deadline_at, attempts")
    .eq("status", "active")
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(error.message);
  if (!due || due.length === 0) return res;

  const flowIds = [...new Set(due.map((e) => e.flow_id))];
  const { data: flowRows } = await supabase
    .from("flows")
    .select("id, status, steps")
    .in("id", flowIds);
  const flows = new Map((flowRows ?? []).map((f) => [f.id, f]));

  const suppressed = await fetchSuppressedSet();

  for (const e of due as Enrollment[]) {
    res.scanned++;
    const flow = flows.get(e.flow_id);

    if (!flow) {
      await setStatus(e.id, "cancelled", { last_error: "flow deleted" });
      res.cancelled++;
      continue;
    }
    // Paused/draft flow: keep the enrolment, try again later.
    if (flow.status !== "active") {
      await supabase
        .from("flow_enrollments")
        .update({ next_action_at: hoursFromNow(PAUSE_DEFER_HOURS), updated_at: new Date().toISOString() })
        .eq("id", e.id);
      continue;
    }
    // Deadline (e.g. abandoned cart 72h): stop trying.
    if (e.deadline_at && new Date(e.deadline_at).getTime() < Date.now()) {
      await setStatus(e.id, "exited", { last_error: "deadline passed" });
      continue;
    }

    const steps: FlowStep[] = Array.isArray(flow.steps) ? (flow.steps as FlowStep[]) : [];
    const step = steps[e.current_step];
    if (!step) {
      await setStatus(e.id, "completed", { completed_at: new Date().toISOString() });
      res.completed++;
      continue;
    }

    // Eligibility: reachable, still subscribed, not suppressed.
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, first_name, status, accepts_marketing")
      .eq("id", e.contact_id)
      .maybeSingle();
    const email = (contact?.email as string | undefined)?.toLowerCase();
    if (!email || contact?.status !== "active" || contact?.accepts_marketing === false || suppressed.has(email)) {
      await setStatus(e.id, "cancelled", { last_error: "contact not marketable" });
      res.cancelled++;
      continue;
    }

    // Atomic claim: insert the step's ledger row. Conflict = already sent → skip.
    const { error: claimErr } = await supabase.from("email_sends").insert({
      enrollment_id: e.id,
      flow_id: e.flow_id,
      step_index: e.current_step,
      contact_id: e.contact_id,
      email,
      status: "queued",
    });
    if (claimErr) {
      await advance(e, steps);
      res.skipped++;
      continue;
    }

    try {
      const first = (contact?.first_name as string | null) ?? null;
      const coupon = step.coupon_code ?? "";
      const html = renderMarketingEmail({
        contactId: e.contact_id,
        bodyHtml: personalize(step.body_html, e.context, first, e.current_step, coupon),
        previewText: step.preview_text
          ? personalizeSubject(step.preview_text, e.context, first, coupon)
          : undefined,
      });
      const r = await sendEmail({
        to: contact!.email as string,
        subject: personalizeSubject(step.subject, e.context, first, coupon),
        html,
        from: DEFAULT_FROM,
        headers: marketingHeaders(e.contact_id),
      });
      const resendId = r?.data?.id;
      if (r?.error || !resendId) throw new Error(r?.error?.message ?? "send failed");

      await supabase
        .from("email_sends")
        .update({ status: "sent", resend_id: resendId, sent_at: new Date().toISOString() })
        .eq("enrollment_id", e.id)
        .eq("step_index", e.current_step)
        .eq("status", "queued");
      res.sent++;
      await advance(e, steps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "send error";
      // Fail the queued claim so a retry can re-insert (row leaves the index).
      await supabase
        .from("email_sends")
        .update({ status: "failed", error: msg })
        .eq("enrollment_id", e.id)
        .eq("step_index", e.current_step)
        .eq("status", "queued");
      const attempts = (e.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await setStatus(e.id, "failed", { last_error: msg, attempts });
      } else {
        await supabase
          .from("flow_enrollments")
          .update({ attempts, next_action_at: hoursFromNow(BACKOFF_HOURS), last_error: msg, updated_at: new Date().toISOString() })
          .eq("id", e.id);
      }
      res.failed++;
    }
  }

  return res;
}
