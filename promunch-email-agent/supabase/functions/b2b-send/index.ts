// B2B outreach send — sends a new email from the Gmail mailbox (service-account
// auth, domain-wide delegation; see _shared/gmail.ts). Replaces Resend for the
// lead-gen pipeline: real-mailbox sends inbox better at low volume, and replies
// land natively in the mailbox.
//
// POST { to, subject, body, fromName? } → { ok, id, threadId }
//
// Auth: service-role bearer via requireInternal (verify_jwt alone is NOT
// authorization — the public anon key passes it). Called with the service-role
// bearer.

import { sendNewEmail } from "../_shared/gmail.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector } from "../_shared/connector-log.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }

  let body: { to?: string; subject?: string; body?: string; fromName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { to, subject, body: bodyPlain, fromName } = body;
  if (!to || !subject || !bodyPlain) {
    return Response.json({ error: "to, subject, body are required" }, { status: 400 });
  }

  try {
    const result = await sendNewEmail({ to, subject, bodyPlain, fromName });
    return Response.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logConnector({
      connector: "b2b_outreach",
      level: "error",
      event: "send_failed",
      message: `B2B outreach send to ${to} failed: ${msg}`,
    });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
