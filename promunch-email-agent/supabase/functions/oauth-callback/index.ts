// oauth-callback
// ---------------------------------------------------------------------------
// One-time-use endpoint to bootstrap the Gmail OAuth refresh token.
//
// Flow:
//   1. Visit /oauth-callback?action=start in a browser → 302 to Google consent.
//   2. Google redirects back to /oauth-callback?code=...
//   3. We exchange the code for tokens and persist the refresh_token to the
//      oauth_tokens table.
//
// After you've done this once for hello@promunch.in you never need to run it
// again (refresh tokens don't expire unless explicitly revoked).
//
// Security: gate the function with a one-time SETUP_TOKEN to prevent random
// people from triggering the flow. Set SETUP_TOKEN env var and visit:
//   /oauth-callback?action=start&token=YOUR_TOKEN

import { db } from "../_shared/supabase.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const REDIRECT_URI = Deno.env.get("OAUTH_REDIRECT_URI")!;       // e.g. https://<project>.supabase.co/functions/v1/oauth-callback
const SETUP_TOKEN = Deno.env.get("SETUP_TOKEN") ?? "";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",                // read + label modify
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (SETUP_TOKEN && url.searchParams.get("token") !== SETUP_TOKEN && !url.searchParams.get("code")) {
    return new Response("forbidden", { status: 403 });
  }

  // Step 1: start the flow
  if (url.searchParams.get("action") === "start") {
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");              // force refresh_token issuance
    return Response.redirect(authUrl.toString(), 302);
  }

  // Step 2: handle the callback
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response(
      "Missing ?code. Start the flow at ?action=start&token=YOUR_SETUP_TOKEN",
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!tokenResp.ok) {
    return new Response(`Token exchange failed: ${await tokenResp.text()}`, { status: 500 });
  }
  const tokens = await tokenResp.json() as {
    access_token: string;
    refresh_token?: string;
    scope: string;
    id_token?: string;
  };

  if (!tokens.refresh_token) {
    return new Response(
      "No refresh_token in response. Make sure you used prompt=consent and access_type=offline, and revoke the app in your Google account before retrying.",
      { status: 400 },
    );
  }

  // Look up the email this token belongs to (use Gmail profile endpoint)
  const profileResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResp.ok) {
    return new Response("Could not fetch Gmail profile", { status: 500 });
  }
  const profile = await profileResp.json() as { emailAddress: string };

  // Store the refresh token
  const { error } = await db().from("oauth_tokens").upsert(
    {
      email: profile.emailAddress,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
    },
    { onConflict: "email" },
  );
  if (error) {
    return new Response(`DB error: ${error.message}`, { status: 500 });
  }

  return new Response(
    `<html><body style="font-family:system-ui;padding:2rem">
       <h2>✅ OAuth complete</h2>
       <p>Refresh token saved for <b>${profile.emailAddress}</b>.</p>
       <p>Next: invoke <code>gmail-watch-renew</code> once to start the Pub/Sub subscription.</p>
     </body></html>`,
    { headers: { "content-type": "text/html" } },
  );
});
