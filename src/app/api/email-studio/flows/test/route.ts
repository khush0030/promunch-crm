import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/resend";
import { renderFlowStep } from "@/lib/email/flow-engine";
import type { FlowStep } from "@/lib/email/flow-templates";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";
import { sampleFlowContext, TEST_CONTACT } from "@/lib/email/flow-sample";

// "Send me a test" for automation (flow) emails. Renders the step with the
// exact code the flow engine sends with, filled from real data (see
// flow-sample.ts). Sends the SAVED version. Never touches enrolments or
// email_sends.
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

  const { context, source } = await sampleFlowContext(flow.trigger_type as string, flow.id as string);

  const firstName = (me.user.user_metadata?.full_name as string | undefined)?.split(" ")[0] || "Khush";
  const sent: { step: number; subject: string }[] = [];
  for (const i of picks) {
    const { subject, html } = await renderFlowStep(steps[i], { contactId: TEST_CONTACT, context, firstName, stepIndex: i });
    const r = await sendEmail({ to, subject: `[TEST ${flow.name} ${i + 1}/${steps.length}] ${subject}`, html });
    if (r?.error) return bad(`Resend refused step ${i + 1}: ${r.error.message}`, 502);
    sent.push({ step: i + 1, subject });
  }
  return NextResponse.json({ ok: true, to, source, link: String(context.checkout_url ?? ""), sent });
}
