import { NextRequest } from "next/server";
import { actionHandler, preflightHandler } from "@/lib/brevo-action-route";

// Email campaign actions: test, send_now, schedule, suspend, archive,
// unarchive, replicate, export_recipients, send_report, release_claim.
// Admin for everything; send/schedule/release are owner-only inside.
// GET = send preflight for the confirm dialog.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return preflightHandler("email", req, (await ctx.params).id);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return actionHandler("email", req, (await ctx.params).id);
}
