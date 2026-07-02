// Inbound-auth gate for internal (function-to-function / Next.js API-route) callers.
//
// The paid message-send functions run with verify_jwt = false in config.toml,
// so Supabase does NOT authenticate the caller for us. Without this gate anyone
// who knows the URL could send arbitrary paid WhatsApp/Instagram messages.
//
// Every legitimate caller already sends
//   Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}
// (or, if set, the optional INTERNAL_FN_SECRET). This gate rejects anyone who
// doesn't — and FAILS CLOSED (401) if no secret is configured at all.

// Constant-time byte comparison. Avoids leaking the mismatch position (and thus
// the secret, one byte at a time) via an early-exit `===`. A length mismatch is
// rejected up front — the shared secret's length is not itself sensitive.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

// Returns a 401 Response if the request's Authorization header does not match
// the internal shared secret, or null if the caller is authorized. Call this at
// the top of the handler and return its result immediately when non-null.
export function requireInternal(req: Request): Response | null {
  const secret = Deno.env.get("INTERNAL_FN_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  // Fail closed: no secret configured means reject everything.
  if (!secret) return unauthorized();

  const got = req.headers.get("Authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!timingSafeEqual(got, want)) return unauthorized();
  return null;
}
