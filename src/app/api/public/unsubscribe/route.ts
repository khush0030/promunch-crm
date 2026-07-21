// Public one-click unsubscribe endpoint (no session — the HMAC token is the
// auth). Middleware allowlists /api/public/*.
//
//   POST ?token=...  → RFC 8058 one-click (mailbox providers POST here from the
//                      List-Unsubscribe header). Returns 200 JSON.
//   GET  ?token=...  → a human clicked the footer link. Suppress, then redirect
//                      to the /u/<token> confirmation page.

import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubToken, appBaseUrl } from "@/lib/email/unsubscribe";
import { applyUnsubscribe } from "@/lib/email/apply-unsubscribe";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const contactId = verifyUnsubToken(token);
  if (!contactId) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }
  await applyUnsubscribe(contactId);
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const contactId = verifyUnsubToken(token);
  if (!contactId) {
    return NextResponse.redirect(`${appBaseUrl()}/u/invalid`);
  }
  await applyUnsubscribe(contactId);
  return NextResponse.redirect(`${appBaseUrl()}/u/${encodeURIComponent(token)}`);
}
