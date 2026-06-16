// Slack slash command handler.
// Single command: /shopify today|week|month (sales), /shopify order #1234 (lookup).
// Verifies Slack signature with SLACK_SIGNING_SECRET (single "Maya" app).

import { salesSummary, orderLookup } from "../_shared/shopify-stats.ts";

async function verifySlackSig(rawBody: string, sig: string | null, ts: string | null, secret: string): Promise<boolean> {
  if (!sig || !ts) return false;
  // Reject if timestamp older than 5 min
  const drift = Math.abs(Date.now() / 1000 - Number(ts));
  if (drift > 300) return false;
  const basestring = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(basestring));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = `v0=${hex}`;
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const raw = await req.text();
  const secret = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!secret) return new Response("server-misconfig", { status: 500 });
  if (!(await verifySlackSig(raw, req.headers.get("x-slack-signature"), req.headers.get("x-slack-request-timestamp"), secret))) {
    return new Response("bad-sig", { status: 401 });
  }
  const form = new URLSearchParams(raw);
  const command = form.get("command") || "";
  const text = (form.get("text") || "").trim();

  let response: string;
  if (command === "/shopify") {
    // Single command, subcommand-style: `/shopify today|week|month`, `/shopify order #1234`, `/shopify help`.
    const parts = text.split(/\s+/).filter(Boolean);
    const sub = (parts[0] || "").toLowerCase();
    const arg = parts.slice(1).join(" ").trim();
    if (sub === "order") response = await orderLookup(arg);
    else if (sub === "help") response = "Usage:\n• `/shopify today` · `/shopify week` · `/shopify month` — sales\n• `/shopify order #1234` — order lookup";
    else response = await salesSummary(sub || "today");
  }
  else response = `Unknown command ${command}`;

  return new Response(JSON.stringify({ response_type: "ephemeral", text: response }), {
    headers: { "content-type": "application/json" },
  });
});
