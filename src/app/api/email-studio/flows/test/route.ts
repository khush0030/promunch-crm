import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/resend";
import { renderFlowStep } from "@/lib/email/flow-engine";
import type { FlowStep } from "@/lib/email/flow-templates";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";

// "Send me a test" for automation (flow) emails. Renders the step with the
// exact code the flow engine sends with. For the abandoned-cart flow the
// context (recovery link + cart lines) is copied from the most recent real
// cart whose link came from the checkout NOTE (Super Money Breeze), so the
// test shows the real link format. Never touches enrolments or email_sends.
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_CONTACT = "00000000-0000-0000-0000-000000000000"; // unsubscribe link resolves to nobody
const SAMPLE_CONTEXT = {
  checkout_url: "https://promunch.in/cart",
  items: [{ title: "PROMUNCH Diwali Snack Box", quantity: 1, price: 555 }],
  total: 555,
};

export async function POST(req: NextRequest) {
  const me = await caller();
  if (isResponse(me)) return me;
  const body = (await parseBody<{ flowId?: string; step?: number | "all"; to?: string | string[] }>(req)) ?? {};

  const raw = Array.isArray(body.to) ? body.to : body.to ? String(body.to).split(/[,\s]+/) : [me.email];
  const to = [...new Set(raw.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0 || to.length > 5 || to.some((e) => !EMAIL_RE.test(e))) return bad("Send a test to 1 to 5 valid addresses.");

  const { data: flow } = await supabase.from("flows").select("id, name, trigger_type, steps").eq("id", String(body.flowId ?? "")).maybeSingle();
  if (!flow) return bad("flow not found", 404);
  const steps = (Array.isArray(flow.steps) ? flow.steps : []) as FlowStep[];
  const picks = body.step === "all" ? steps.map((_, i) => i) : [Number(body.step ?? 0)];
  if (picks.some((i) => !steps[i])) return bad("no such step");

  let context: Record<string, unknown> = SAMPLE_CONTEXT;
  let source = "sample cart";
  if (flow.trigger_type === "checkout_abandoned") {
    const { data: recent } = await supabase
      .from("flow_enrollments")
      .select("context, entered_at")
      .eq("flow_id", flow.id)
      .like("context->>checkout_url", "%atomsSt=%")
      .order("entered_at", { ascending: false })
      .limit(1);
    if (recent?.[0]?.context) {
      context = recent[0].context as Record<string, unknown>;
      source = `latest real cart with a note link (${String(recent[0].entered_at).slice(0, 10)})`;
    }
  } else if (flow.trigger_type === "order_placed") {
    // Latest real order, shaped like the enrolment context order-confirmation
    // stores (items + one-tap reorder permalink onto the storefront cart).
    const { data: recent } = await supabase
      .from("shopify_orders")
      .select("order_number, line_items, shopify_created_at")
      .gt("total_price", 1)
      .order("shopify_created_at", { ascending: false })
      .limit(1);
    const lines = (Array.isArray(recent?.[0]?.line_items) ? recent[0].line_items : []) as Array<Record<string, unknown>>;
    if (lines.length > 0) {
      const qty = new Map<string, number>();
      for (const li of lines) {
        if (!li.variant_id || !(Number(li.price ?? 0) > 0)) continue;
        const v = String(li.variant_id).replace(/\D/g, "");
        qty.set(v, (qty.get(v) ?? 0) + Math.max(1, Number(li.quantity ?? 1)));
      }
      const perma = [...qty].map(([v, q]) => `${v}:${q}`).join(",");
      context = {
        items: lines.slice(0, 8).map((li) => ({
          title: String(li.title ?? li.name ?? "Item"),
          quantity: Number(li.quantity ?? 1),
          price: Number(li.price ?? 0),
        })),
        reorder_url: perma ? `https://promunch.in/cart/${perma}?storefront=true` : "",
      };
      source = `latest real order ${recent![0].order_number} (${String(recent![0].shopify_created_at).slice(0, 10)})`;
    }
  }

  const firstName = (me.user.user_metadata?.full_name as string | undefined)?.split(" ")[0] || "Khush";
  const sent: { step: number; subject: string }[] = [];
  for (const i of picks) {
    const { subject, html } = renderFlowStep(steps[i], { contactId: TEST_CONTACT, context, firstName, stepIndex: i });
    const r = await sendEmail({ to, subject: `[TEST ${flow.name} ${i + 1}/${steps.length}] ${subject}`, html });
    if (r?.error) return bad(`Resend refused step ${i + 1}: ${r.error.message}`, 502);
    sent.push({ step: i + 1, subject });
  }
  return NextResponse.json({ ok: true, to, source, link: String(context.checkout_url ?? ""), sent });
}
