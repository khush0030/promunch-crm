import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSecret } from "@/lib/secrets";
import { buildEmbedJs, normalizeGrowthConfig } from "@/lib/wa-embed";

export const dynamic = "force-dynamic";

// PUBLIC: the storefront loads this as a <script src>. Shopify injects it via
// a script tag created from WhatsApp → Growth (or a manually pasted loader).
// Config lives in app_secrets (WA_GROWTH_CONFIG) so dashboard edits reach the
// live site within the cache window — no theme edit needed.

const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER || "919981310247";

export async function GET() {
  let cfg = normalizeGrowthConfig(null);
  try {
    const raw = await getSecret("WA_GROWTH_CONFIG");
    if (raw) cfg = normalizeGrowthConfig(JSON.parse(raw));
  } catch { /* defaults */ }

  let widgetLink: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("wa_short_links")
      .select("code")
      .eq("sent_by", "growth:widget")
      .limit(1)
      .maybeSingle();
    if (data?.code) {
      const site = (process.env.SITE_APP_URL || "https://promunch-crm.vercel.app").replace(/\/+$/, "");
      widgetLink = `${site}/r/${data.code}`;
    }
  } catch { /* widget just won't render */ }

  const js = buildEmbedJs(cfg, {
    appOrigin: (process.env.SITE_APP_URL || "https://promunch-crm.vercel.app").replace(/\/+$/, ""),
    widgetLink,
    waNumber: WA_NUMBER,
  });

  return new NextResponse(js, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // Config edits go live within ~5 min on the storefront.
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
