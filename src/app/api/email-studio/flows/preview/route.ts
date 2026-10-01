import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/api-helpers";
import { renderFlowStep } from "@/lib/email/flow-engine";
import { sampleFlowContext, TEST_CONTACT } from "@/lib/email/flow-sample";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";
import type { FlowStep } from "@/lib/email/flow-templates";

// Live preview for the automation editor: renders an UNSAVED email with the
// exact code the flow engine sends with, filled from real sample data.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const me = await caller();
  if (isResponse(me)) return me;
  const body = (await parseBody<{ trigger_type?: string; flowId?: string; step?: Partial<FlowStep>; stepIndex?: number }>(req)) ?? {};
  const st = body.step ?? {};
  const step: FlowStep = {
    type: "email",
    delay_hours: 0,
    subject: String(st.subject ?? ""),
    body_html: String(st.body_html ?? ""),
    preview_text: st.preview_text ? String(st.preview_text) : undefined,
    coupon_code: st.coupon_code ? String(st.coupon_code) : undefined,
    // Layout + offer shape the render (plain letter, TEST code in previews).
    format: st.format === "plain" ? "plain" : "designed",
    signature: st.signature ? String(st.signature) : undefined,
    coupon: st.coupon && Number(st.coupon.percent_off) > 0
      ? { percent_off: Number(st.coupon.percent_off), expires_in_days: Number(st.coupon.expires_in_days ?? 7) || 7, prefix: st.coupon.prefix ? String(st.coupon.prefix) : undefined }
      : undefined,
  };
  if (step.body_html.length > 100_000) return bad("Email body is too large.");
  const { context, source } = await sampleFlowContext(String(body.trigger_type ?? ""), body.flowId);
  const firstName = (me.user.user_metadata?.full_name as string | undefined)?.split(" ")[0] || "Khush";
  const { subject, html } = await renderFlowStep(step, { contactId: TEST_CONTACT, context, firstName, stepIndex: Number(body.stepIndex ?? 0) });
  return NextResponse.json({ subject, html, source });
}
