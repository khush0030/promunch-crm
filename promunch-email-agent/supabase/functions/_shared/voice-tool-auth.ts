import { logConnector } from "./connector-log.ts";

// Constant-time compare so the secret cannot be recovered one byte at a time.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Sarvam HTTPS tools authenticate with a DEDICATED secret, VOICE_TOOL_SECRET,
// not requireInternal. Two reasons.
// (1) The caller is a third party (Sarvam's tool runner), not one of our own
// functions, so it must never hold a credential that opens the rest of the
// internal surface. (2) requireInternal's shared secret is the platform-injected
// SUPABASE_SERVICE_ROLE_KEY, whose value has drifted from every key the dashboard
// or CLI reports here, so it cannot be pasted into Sarvam's tool config at all,
// and setting INTERNAL_FN_SECRET to work around that would 401 every legitimate
// function-to-function call (wa-journey-tick -> wa-send and friends) at once.
//
// Fails closed: no secret configured means reject everything. Logs the
// REJECTION (never the credential). Without this, "Sarvam never called the
// tool" and "Sarvam called it with the wrong bearer" look identical from our
// side. Shape only: whether a header arrived and what scheme it used.
export async function checkVoiceToolAuth(req: Request, fnName: string): Promise<Response | null> {
  const secret = Deno.env.get("VOICE_TOOL_SECRET") ?? "";
  const got = req.headers.get("Authorization") ?? "";
  if (secret && timingSafeEqual(got, `Bearer ${secret}`)) return null;
  const scheme = got ? got.split(" ")[0] : "none";
  await logConnector({
    connector: "shopify_wa",
    level: "warn",
    event: "voice_tool_unauthorized",
    message: `${fnName} rejected a call: ${!secret ? "VOICE_TOOL_SECRET is not set" : `bad bearer (auth scheme: ${scheme})`}.`,
    throttleMinutes: 5,
  }).catch(() => {});
  return new Response(JSON.stringify({ ok: false, message: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
