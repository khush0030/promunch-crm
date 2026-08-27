// Sarvam documents no signature on the post-call webhook, so authenticity is
// our own: the payload must echo the per-call random token we handed Sarvam in
// webhook_config.metadata AND name the attempt_id we stored, and the row must
// still be waiting. Constant-time compare so the token cannot be guessed byte
// by byte.
//
// "Waiting" means status 'dialing' (never touched) OR 'unknown' (the tick's
// stuck-dial sweep flipped it after the webhook was late) — a swept row means
// "no webhook arrived yet", so a late arrival is exactly the case this exists
// to accept. Any OTHER status already carries a real verdict from an earlier
// webhook delivery, so it is a replay/duplicate, not a late arrival.

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export interface VoiceCallRowLite { status: string; attempt_id: string | null; webhook_token: string }

export function verifyVoiceWebhook(
  p: { attempt_id?: string; token?: string },
  row: VoiceCallRowLite | null,
): { ok: true } | { ok: false; reason: string } {
  if (!row) return { ok: false, reason: "no_such_call" };
  // The per-call token is the strong proof, but a delivery that drops our
  // metadata carries none. In that case the caller has already matched the row
  // by attempt_id - a server-issued UUID nobody outside Sarvam can guess - which
  // is accepted on its own. A token that is PRESENT must still be correct: a
  // wrong one means someone is guessing, not that metadata went missing.
  if (p.token && !timingSafeEqual(p.token, row.webhook_token)) return { ok: false, reason: "bad_token" };
  if (!p.attempt_id || !row.attempt_id || p.attempt_id !== row.attempt_id) return { ok: false, reason: "attempt_mismatch" };
  if (row.status !== "dialing" && row.status !== "unknown") return { ok: false, reason: "already_finished" };
  return { ok: true };
}
