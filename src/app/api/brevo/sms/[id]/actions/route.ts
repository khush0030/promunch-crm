import { NextRequest } from "next/server";
import { actionHandler, preflightHandler } from "@/lib/brevo-action-route";

// SMS campaign actions (same guard and send claim as email). SMS sends are
// refused while brevo_settings.sms_enabled is off.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return preflightHandler("sms", req, (await ctx.params).id);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return actionHandler("sms", req, (await ctx.params).id);
}
