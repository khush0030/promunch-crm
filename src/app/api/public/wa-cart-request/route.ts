import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSecret } from "@/lib/secrets";
import { CART_REQUEST_PREFIX, requestedCartUrl, STOREFRONT_ORIGINS } from "../../../../../promunch-email-agent/supabase/functions/_shared/cart-request";

export const dynamic = "force-dynamic";

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin && STOREFRONT_ORIGINS.has(origin) ? origin : "https://trypromunch.in",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store", Vary: "Origin" };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

// Creates a product-only cart snapshot, never a contact, opt-in or outbound
// message. A signed Meta inbound must arrive before any reply can be sent.
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
  if (!origin || !STOREFRONT_ORIGINS.has(origin)) return fail("origin", 403);
  if ((await getSecret("WA_CART_REQUEST_ENABLED")) !== "true") return fail("unavailable", 503);
  const raw = await req.text();
  if (raw.length > 16000) return fail("cart too large", 413);
  let cart: unknown;
  try { cart = JSON.parse(raw); } catch { return fail("invalid cart", 400); }
  const target = requestedCartUrl(cart, origin);
  if (!target) return fail("Please use the checkout on this page for this cart, or ask us for help on WhatsApp.", 422);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return fail("unavailable", 503);
  const hash = (value: string) => createHmac("sha256", key).update(value).digest("hex").slice(0, 32);
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const source = `growth:cart-request:${hash(ip)}`;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: rateError } = await supabaseAdmin.from("wa_short_links")
    .select("code", { count: "exact", head: true }).eq("sent_by", source).gte("created_at", since);
  if (rateError) return fail("unavailable", 503);
  if ((count ?? 0) >= 20) return fail("Please try again later.", 429);
  // Duplicate clicks for the same basket/hour reuse one snapshot. No personal
  // checkout token, email, phone, address, price or cart note is stored here.
  const code = `cr_${hash(`${source}:${Math.floor(Date.now() / 3600_000)}:${target}`)}`;
  const { error } = await supabaseAdmin.from("wa_short_links").upsert({
    code, target_url: target, sent_by: source,
  }, { onConflict: "code", ignoreDuplicates: true });
  if (error) return fail("unavailable", 503);
  const number = process.env.NEXT_PUBLIC_WA_NUMBER || "919981310247";
  return NextResponse.json({ url: `https://wa.me/${number}?text=${encodeURIComponent(CART_REQUEST_PREFIX + code)}` }, { headers });
}
