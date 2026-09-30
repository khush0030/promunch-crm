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
  };
  if (step.body_html.length > 100_000) return bad("Email body is too large.");
  const { context, source } = await sampleFlowContext(String(body.trigger_type ?? ""), body.flowId);
  const firstName = (me.user.user_metadata?.full_name as string | undefined)?.split(" ")[0] || "Khush";
  const { subject, html } = renderFlowStep(step, { contactId: TEST_CONTACT, context, firstName, stepIndex: Number(body.stepIndex ?? 0) });
  return NextResponse.json({ subject, html, source });
}
