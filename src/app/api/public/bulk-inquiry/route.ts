// Public intake for the promunch.in bulk order form (widget served by
// /api/public/bulk-form-embed). No session: guarded like the other storefront
// intakes by an Origin allowlist + honeypot. Middleware allowlists
// /api/public/*.
//
// Stores the inquiry, creates/links the deal and sends the one auto-reply
// (src/lib/bulk-inquiry/process.ts). The lead-desk WhatsApp ping happens via
// the DB trigger -> edge fn bulk-lead-alert.

import { NextRequest, NextResponse } from "next/server";
import { parseBulkInquiry } from "@/lib/bulk-inquiry/schema";
import { intakeBulkInquiry } from "@/lib/bulk-inquiry/process";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_ORIGINS = new Set([
  "https://promunch.in",
  "https://www.promunch.in",
  "https://trypromunch.in",
  "https://www.trypromunch.in",
  "https://a1e4f4-2.myshopify.com",
]);

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400, headers });
  }

  // Honeypot: a bot filled the hidden field. Pretend success, do nothing.
  if (body.website) return NextResponse.json({ ok: true }, { headers });

  const parsed = parseBulkInquiry(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 422, headers });
  }

  try {
    const r = await intakeBulkInquiry(parsed.value, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true, ref: `B-${r.refNo}`, emailed: r.emailStatus === "sent" }, { headers });
  } catch (e) {
    console.error("[bulk-inquiry] intake failed", e);
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Please try again or email hello@promunch.in." },
      { status: 500, headers },
    );
  }
}
