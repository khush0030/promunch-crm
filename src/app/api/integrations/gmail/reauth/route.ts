import { NextResponse } from "next/server";

// One-click Gmail OAuth re-auth: redirects the operator straight into the
// Google consent flow. SETUP_TOKEN gates the underlying Supabase function;
// keeping it server-side means the token never reaches the browser.
//
// Operator clicks the button on /dashboard/integrations → this route 302s to
// /oauth-callback?action=start&token=... on Supabase → Google consent →
// /oauth-callback (callback) writes the fresh refresh_token to oauth_tokens.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const setupToken = process.env.GMAIL_OAUTH_SETUP_TOKEN;
  if (!supabaseUrl || !setupToken) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL or GMAIL_OAUTH_SETUP_TOKEN env" },
      { status: 500 },
    );
  }
  const url = `${supabaseUrl}/functions/v1/oauth-callback?action=start&token=${encodeURIComponent(setupToken)}`;
  return NextResponse.redirect(url, 302);
}
