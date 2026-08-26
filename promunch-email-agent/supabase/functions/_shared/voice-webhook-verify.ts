// Sarvam documents no signature on the post-call webhook, so authenticity is
// our own: the payload must echo the per-call random token we handed Sarvam in
// webhook_config.metadata AND name the attempt_id we stored, and the row must
// still be waiting. Constant-time compare so the token cannot be guessed byte
// by byte.

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
  if (!p.token || !timingSafeEqual(p.token, row.webhook_token)) return { ok: false, reason: "bad_token" };
  if (!p.attempt_id || !row.attempt_id || p.attempt_id !== row.attempt_id) return { ok: false, reason: "attempt_mismatch" };
  if (row.status !== "dialing") return { ok: false, reason: "already_finished" };
  return { ok: true };
}
