import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSettings, jsonError, logEvent, requireUser } from "@/lib/influencers/db";
import { UUID_RE } from "@/lib/influencers/normalize";
import { resendBriefReady } from "@/lib/influencers/brief-server";

export const dynamic = "force-dynamic";

// POST /api/influencers/deals/[id]/brief/whatsapp
// "Send WhatsApp again" for a brief that is already published on the portal
// but whose WhatsApp ping failed (or never went out). Only the latest SENT
// brief can be pinged. influencer-send owns the claim + ledger check, so this
// can never message the creator twice: a ping that already landed answers
// whatsapp:'already_sent'.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("deal not found", 404);

  const [{ data: deal }, { data: brief }] = await Promise.all([
    supabaseAdmin.from("influencer_deals").select("id, influencer_id, code, stage").eq("id", id).maybeSingle(),
    supabaseAdmin
      .from("influencer_briefs")
      .select("version")
      .eq("deal_id", id)
      .eq("status", "sent")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!deal) return jsonError("deal not found", 404);
  if (deal.stage === "cancelled" || deal.stage === "ghosted" || deal.stage === "completed") {
    return jsonError(`deal is ${deal.stage}`, 409);
  }
  if (!brief) return jsonError("no brief has been sent yet; approve and send the brief first", 409);

  const settings = await getSettings();
  if (!settings.engine_enabled) {
    return NextResponse.json({ ok: true, code: deal.code, whatsapp: "engine_off" });
  }

  const wa = await resendBriefReady(id);
  if (wa.whatsapp === "sent") {
    await logEvent(
      deal.influencer_id,
      id,
      "brief_whatsapp_resent",
      "dashboard",
      gate.actor,
      `Brief v${brief.version} WhatsApp sent again`,
      { version: brief.version },
    );
  }
  if (wa.whatsapp === "failed") console.warn("influencer-send brief_ready resend failed:", wa.error);
  return NextResponse.json({
    ok: true,
    code: deal.code,
    whatsapp: wa.whatsapp,
    ...(wa.whatsapp === "failed" ? { whatsapp_error: wa.error } : {}),
  });
}
