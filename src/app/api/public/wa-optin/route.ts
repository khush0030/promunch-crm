import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// PUBLIC endpoint (allowlisted in middleware): the website popup posts phone
// numbers here to join the WhatsApp list. Upserts into wa_contacts with an
// explicit consent trail (consent_source + consent_verified_at) — this is the
// marketing-safe opt-in cohort, unlike imported order phones.
//
// Abuse posture (v1): browser origin allowlist + honeypot field + strict phone
// validation. No secrets — anything in the public snippet is visible anyway.
// Worst case an abuser adds junk contacts; they can't read anything and can't
// trigger a send (no send path fires from here — §0).

const ALLOWED_ORIGINS = new Set([
  "https://trypromunch.in",
  "https://www.trypromunch.in",
  "https://promunch.in",
  "https://www.promunch.in",
  "https://a1e4f4-2.myshopify.com",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://trypromunch.in";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  // Browsers always send Origin on cross-site POST; a missing/foreign one is
  // not a shopper on our storefront.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ ok: false, error: "origin" }, { status: 403, headers });
  }

  const body = await req.json().catch(() => null) as
    | { phone?: string; name?: string; source?: string; hp?: string }
    | null;
  if (!body) return NextResponse.json({ ok: false, error: "bad json" }, { status: 400, headers });
  if (body.hp) return NextResponse.json({ ok: true }, { headers }); // honeypot: pretend success

  const digits = String(body.phone ?? "").replace(/\D/g, "");
  const waId = digits.length === 10 ? `91${digits}`
    : digits.length === 12 && digits.startsWith("91") ? digits
    : null;
  // Indian mobiles start 6-9.
  if (!waId || !/^91[6-9]\d{9}$/.test(waId)) {
    return NextResponse.json({ ok: false, error: "invalid phone" }, { status: 400, headers });
  }
  const name = String(body.name ?? "").trim().slice(0, 80) || null;
  const source = body.source === "website_widget" ? "website_widget" : "website_popup";

  // Merge, never clobber: an existing contact keeps their name/tags and gains
  // the popup tag + a verified consent trail.
  const { data: existing } = await supabaseAdmin
    .from("wa_contacts")
    .select("id, name, tags")
    .eq("wa_id", waId)
    .maybeSingle();

  const tags = new Set<string>((existing?.tags as string[] | null) ?? []);
  tags.add(source);
  const row = {
    wa_id: waId,
    phone: `+${waId}`,
    name: existing?.name ?? name,
    tags: [...tags],
    opted_in: true,
    consent_source: source,
    consent_verified_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await supabaseAdmin.from("wa_contacts").update(row).eq("id", existing.id)
    : await supabaseAdmin.from("wa_contacts").insert(row);
  if (error) return NextResponse.json({ ok: false, error: "storage" }, { status: 500, headers });

  return NextResponse.json({ ok: true, already: !!existing }, { headers });
}
