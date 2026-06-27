import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Public click-tracking redirect. A WhatsApp free-text URL is rewritten to
// /r/<code> (see wa-send + _shared/links.ts); here we log the click and 302 to
// the real destination. Fail-safe: an unknown code or any error still sends the
// user somewhere sane rather than erroring in their face.

const FALLBACK = (process.env.SITE_URL || "https://trypromunch.in").replace(/\/+$/, "");

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  try {
    const { data: link } = await supabaseAdmin
      .from("wa_short_links")
      .select("target_url, contact_id")
      .eq("code", code)
      .maybeSingle();

    if (!link?.target_url) return NextResponse.redirect(FALLBACK, 302);

    // Log the click (best-effort — never block the redirect on it).
    await supabaseAdmin
      .from("wa_link_clicks")
      .insert({ code, contact_id: link.contact_id ?? null, ua: req.headers.get("user-agent")?.slice(0, 300) ?? null })
      .then(undefined, () => {});

    return NextResponse.redirect(link.target_url, 302);
  } catch {
    return NextResponse.redirect(FALLBACK, 302);
  }
}
