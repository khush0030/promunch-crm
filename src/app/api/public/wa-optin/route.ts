import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { POPUP_CONSENT_TEXT, TIER_TAGS } from "@/lib/wa-engagement";

export const dynamic = "force-dynamic";

// PUBLIC endpoint (allowlisted in middleware): the website popup posts phone
// numbers here to join the WhatsApp list. Upserts into wa_contacts with a full,
// auditable consent trail — who agreed, to exactly what wording, when, from
// which page — and writes an append-only row in wa_consent_events.
//
// This is the ONLY path that produces a real marketing opt-in. Everything else
// in wa_contacts arrived through a Shopify order or a CSV/CRM import and carries
// no consent, which is why those rows tier as `tier:imported` and this one tiers
// as `tier:subscribed` (see src/lib/wa-engagement.ts + migration 014).
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

// Consent records need to be attributable without storing a raw IP against a
// phone number. A salted one-way hash is enough to show two sign-ups came from
// the same place, and cannot be read back into an address.
function hashIp(req: NextRequest): string | null {
  const raw = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (!raw) return null;
  const salt = process.env.CRON_SECRET ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "promunch";
  return createHash("sha256").update(`${salt}:${raw}`).digest("hex").slice(0, 32);
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
    | { phone?: string; name?: string; source?: string; hp?: string; consent_text?: string; page_url?: string }
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
  // Record what they actually read. The embed posts its own rendered wording; if
  // an older cached snippet posts nothing, fall back to the current wording
  // rather than storing an empty consent record.
  const consentText = String(body.consent_text ?? "").trim().slice(0, 500) || POPUP_CONSENT_TEXT;
  const pageUrl = /^https?:\/\//.test(String(body.page_url ?? ""))
    ? String(body.page_url).slice(0, 500)
    : null;
  const consentedAt = new Date().toISOString();

  // Merge, never clobber: an existing contact keeps their name/tags and gains
  // the popup tag + a verified consent trail.
  const { data: existing } = await supabaseAdmin
    .from("wa_contacts")
    .select("id, name, tags")
    .eq("wa_id", waId)
    .maybeSingle();

  const tags = new Set<string>((existing?.tags as string[] | null) ?? []);
  tags.add(source);
  // Tier them immediately so the campaign builder can target this cohort before
  // the nightly refresh runs. recompute_wa_engagement_tags() will promote them to
  // tier:engaged the moment they message us.
  for (const t of [...tags]) if (t.startsWith("tier:")) tags.delete(t);
  tags.add(TIER_TAGS.subscribed);
  const row = {
    wa_id: waId,
    phone: `+${waId}`,
    name: existing?.name ?? name,
    tags: [...tags],
    opted_in: true,
    consent_source: source,
    consent_verified_at: consentedAt,
    consent_text: consentText,
  };
  const { data: saved, error } = existing
    ? await supabaseAdmin.from("wa_contacts").update(row).eq("id", existing.id).select("id").maybeSingle()
    : await supabaseAdmin.from("wa_contacts").insert(row).select("id").maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "storage" }, { status: 500, headers });

  // Append-only audit row. Best effort: a shopper who just consented must not
  // see an error because the log table is unavailable, and the contact row above
  // already carries the current consent state.
  await supabaseAdmin.from("wa_consent_events").insert({
    wa_id: waId,
    contact_id: saved?.id ?? existing?.id ?? null,
    action: "opt_in",
    source,
    consent_text: consentText,
    page_url: pageUrl,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
    ip_hash: hashIp(req),
  });

  return NextResponse.json({ ok: true, already: !!existing }, { headers });
}
