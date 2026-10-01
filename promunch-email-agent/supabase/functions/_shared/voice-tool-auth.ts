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

// Sarvam HTTPS tools authenticate with a DEDICATED secret, VOICE_TOOL_SECRET
// (never requireInternal: a third party must not hold our internal credential).
// Fails closed. Logs the rejection shape, never the credential.
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
