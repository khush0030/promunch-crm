// Public email capture for the storefront signup popup. No session — this is
// called from promunch.in, so it self-guards with an Origin allowlist + a
// honeypot field (mirrors /api/public/wa-optin). Middleware allowlists
// /api/public/*.
//
// On success: merge-upsert the contact with marketing consent, then enrol the
// welcome flow (once per contact). Never sends here — the flow engine does.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enrollEmailFlow } from "@/lib/email/enroll";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://trypromunch.in",
  "https://www.trypromunch.in",
  "https://promunch.in",
  "https://www.promunch.in",
  "https://a1e4f4-2.myshopify.com",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ ok: false, error: "origin" }, { status: 403, headers });
  }

  let body: { email?: string; name?: string; source?: string; hp?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400, headers });
  }

  // Honeypot: a bot filled the hidden field. Pretend success, do nothing.
  if (body.hp) return NextResponse.json({ ok: true }, { headers });

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid email" }, { status: 400, headers });
  }
  const first = body.name ? String(body.name).trim().slice(0, 80) : null;
  const source = body.source === "website_widget" ? "website_widget" : "website_popup";
  const nowIso = new Date().toISOString();

  // Merge-never-clobber: keep an existing contact's data, just add consent + tag.
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id, tags")
    .eq("email", email)
    .maybeSingle();

  const tags = new Set<string>(Array.isArray(existing?.tags) ? (existing!.tags as string[]) : []);
  tags.add("popup");

  let contactId = existing?.id as string | undefined;
  const consent = {
    accepts_marketing: true,
    email_consent: "subscribed",
    consent_source: source,
    consent_timestamp: nowIso,
    tags: [...tags],
    status: "active",
  };

  if (contactId) {
    await supabaseAdmin.from("contacts").update(consent).eq("id", contactId);
  } else {
    const { data: ins } = await supabaseAdmin
      .from("contacts")
      .insert({ email, first_name: first, source: "manual", ...consent })
      .select("id")
      .maybeSingle();
    contactId = ins?.id as string | undefined;
  }

  if (contactId) {
    await enrollEmailFlow("customer_created", {
      email,
      entityRef: contactId,
      dedupPrefix: "welcome",
      firstName: first,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, already: !!existing }, { headers });
}
