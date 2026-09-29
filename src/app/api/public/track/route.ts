// Storefront behaviour intake for the PROMUNCH Shopify Web Pixel
// (shopify-app/extensions/promunch-storefront-pixel). Receives product_viewed,
// product_added_to_cart and checkout_started, stores them in storefront_events,
// and feeds the hourly browse-abandonment cron (/api/cron/email-browse-tick).
//
// Public (middleware allowlists /api/public/*), so it self-guards:
//   - Origin allowlist (storefront + myshopify). Shopify runs app
//     pixels in a sandboxed iframe/worker whose Origin is often the opaque
//     "null", so "null" is accepted too. Missing Origin (curl etc.) is refused.
//   - 4 KB body cap, strict shape validation, per-IP + per-client rate limits.
//   - It NEVER returns 5xx: tracking must not break or slow the storefront.
//     Errors are logged and answered 204.
//
// The pixel posts with Content-Type text/plain (a CORS "simple request", no
// preflight) and keepalive, so the JSON body is parsed from text here.
//
// Identity: a logged-in customer's email (from the pixel's init data) or a
// signed pm_c token from an email click. When an identified event arrives, the
// same client's earlier anonymous events are linked to that contact so views
// before login / before the click-through still count.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { MAX_TRACK_BODY_BYTES, parseTrackPayload, verifyContactToken } from "@/lib/email/browse-abandon";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://promunch.in",
  "https://www.promunch.in",
  "https://trypromunch.in",
  "https://www.trypromunch.in",
  "https://a1e4f4-2.myshopify.com",
  "null", // Shopify's strict pixel sandbox (opaque origin)
]);

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// ---- Rate limiting (best effort, per serverless instance) -----------------
// Not a hard guarantee across instances, but caps a single noisy client/bot
// from flooding the table through one warm instance.
const WINDOW_MS = 60_000;
const PER_IP_LIMIT = 120;
const PER_CLIENT_LIMIT = 60;
const buckets = new Map<string, { n: number; reset: number }>();

function limited(key: string, limit: number, now: number): boolean {
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
      if (buckets.size > 5000) buckets.clear();
    }
    buckets.set(key, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.n += 1;
  return b.n > limit;
}

function noContent(headers: Record<string, string>) {
  return new NextResponse(null, { status: 204, headers });
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

  try {
    const now = Date.now();
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (limited(`ip:${ip}`, PER_IP_LIMIT, now)) {
      return NextResponse.json({ ok: false, error: "rate" }, { status: 429, headers });
    }

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_TRACK_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "too large" }, { status: 413, headers });
    }
    const text = await req.text();
    if (text.length > MAX_TRACK_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "too large" }, { status: 413, headers });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "bad json" }, { status: 400, headers });
    }
    const payload = parseTrackPayload(raw);
    if (!payload) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400, headers });

    if (limited(`c:${payload.clientId}`, PER_CLIENT_LIMIT, now)) {
      return NextResponse.json({ ok: false, error: "rate" }, { status: 429, headers });
    }

    // ---- Resolve identity: signed email-click token wins over pixel email.
    let contactId: string | null = null;
    let email: string | null = payload.email;
    const tokenContact = payload.contactToken ? verifyContactTokenSafe(payload.contactToken) : null;
    if (tokenContact) {
      const { data } = await supabaseAdmin.from("contacts").select("id, email").eq("id", tokenContact).maybeSingle();
      if (data?.id) {
        contactId = data.id as string;
        email = (data.email as string | null)?.toLowerCase() ?? email;
      }
    } else if (email) {
      const { data } = await supabaseAdmin.from("contacts").select("id").eq("email", email).maybeSingle();
      contactId = (data?.id as string | undefined) ?? null;
    }

    const { error } = await supabaseAdmin.from("storefront_events").insert({
      client_id: payload.clientId,
      contact_id: contactId,
      email,
      event: payload.event,
      product: payload.product,
      url: payload.url,
    });
    if (error) {
      console.error("storefront_track_insert_failed", { message: error.message });
      return noContent(headers);
    }

    // ---- Back-attribute this device's earlier anonymous events (bounded to 30 days).
    if (email) {
      const { error: linkErr } = await supabaseAdmin
        .from("storefront_events")
        .update({ contact_id: contactId, email })
        .eq("client_id", payload.clientId)
        .is("email", null)
        .gte("created_at", new Date(now - 30 * 86_400_000).toISOString());
      if (linkErr) console.error("storefront_track_link_failed", { message: linkErr.message });
    }

    return noContent(headers);
  } catch (e) {
    console.error("storefront_track_failed", { message: e instanceof Error ? e.message : String(e) });
    return noContent(headers);
  }
}

function verifyContactTokenSafe(token: string): string | null {
  try {
    return verifyContactToken(token);
  } catch {
    return null; // UNSUBSCRIBE_SECRET unset: treat as anonymous, never fail the storefront
  }
}
