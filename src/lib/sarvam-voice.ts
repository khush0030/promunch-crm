// Server-only client for Sarvam's voice-agent ANALYTICS API (read-only).
//
// Why this exists in src/lib (Next.js control plane) instead of an edge
// function: the architecture rule is "Next.js never talks to a provider
// directly for a SEND" (see AGENTS.md rule 1) — voice-call-start already
// owns the outbound-dial leg from the edge side, and this file never dials
// anyone. Sarvam's post-call webhook is not currently being delivered to us
// (six live test calls, zero webhooks — see .superpowers/sdd/voice-tab-brief.md),
// so the only way to learn how a call actually went is to pull it back out of
// Sarvam's analytics API. That is a read, not a send, so it is safe to do
// from the dashboard's own API routes via the sync endpoint. It still never
// reaches the browser: every function here is called from route handlers
// only, and the API key is read from server env, never returned to a client.
//
// Base + auth: https://apps.sarvam.ai/api, header X-API-Key: <key>.

const BASE = "https://apps.sarvam.ai/api";

export interface SarvamVoiceConfig {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  appId: string;
}

function getConfig(): SarvamVoiceConfig | null {
  const apiKey = process.env.SARVAM_VOICE_API_KEY || process.env.SARVAM_API_KEY;
  const orgId = process.env.SARVAM_ORG_ID;
  const workspaceId = process.env.SARVAM_WORKSPACE_ID;
  const appId = process.env.SARVAM_APP_ID;
  if (!apiKey || !orgId || !workspaceId || !appId) return null;
  return { apiKey, orgId, workspaceId, appId };
}

export function sarvamVoiceConfigured(): boolean {
  return getConfig() !== null;
}

// --- pure normalisation helpers (exported for unit tests) -----------------

// Sarvam's analytics API returns sentinel strings instead of nulls for
// "no value" fields — observed: NO_INTERACTION_ID, NO_FAILURE_REASON,
// NO_END_REASON. Generalised as a pattern (NO_ + shouting case) so a future
// sentinel we haven't seen yet still normalises instead of leaking a fake
// string value into the UI or the DB.
const SENTINEL_RE = /^NO_[A-Z_]+$/;

export function normalizeSentinel(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  if (s.length === 0) return null;
  return SENTINEL_RE.test(s) ? null : s;
}

export type SyncedCallStatus = "connected" | "no_answer" | "busy" | "failed" | "unknown";
const CONNECTIVITY_STATUSES: ReadonlySet<string> = new Set(["connected", "busy", "no_answer", "failed"]);

// Maps Sarvam's connectivity_status onto our voice_calls status vocabulary.
// Anything unrecognised clamps to "unknown" rather than throwing or writing a
// value the table's CHECK constraint would reject.
export function mapConnectivityStatus(v: unknown): SyncedCallStatus {
  const s = String(v ?? "").toLowerCase().trim();
  return (CONNECTIVITY_STATUSES.has(s) ? s : "unknown") as SyncedCallStatus;
}

export type VoiceOutcome = "will_buy" | "asked_link" | "not_interested" | "do_not_call" | "callback_later" | "unknown";
const OUTCOMES: ReadonlySet<string> = new Set([
  "will_buy", "asked_link", "not_interested", "do_not_call", "callback_later", "unknown",
]);

// Clamps the agent's free-form call_disposition variable to our enum. This is
// the safety-relevant clamp: do_not_call flips wa_contacts.voice_dnd, so a
// value that slips through unclamped could either wrongly silence a customer
// or (worse) fail to record a real do-not-call request. Anything outside the
// known set becomes "unknown", never a passthrough.
export function clampOutcome(v: unknown): VoiceOutcome {
  const s = String(v ?? "unknown").toLowerCase().trim();
  return (OUTCOMES.has(s) ? s : "unknown") as VoiceOutcome;
}

export type NormalizedAttempt = {
  attemptId: string;
  interactionId: string | null;
  status: SyncedCallStatus;
  durationSeconds: number | null;
  endedBy: string | null;
  failureReason: string | null;
  userContact: string | null;
  agentVariables: Record<string, unknown>;
  attemptedAt: string | null;
};

function normalizeAttempt(raw: Record<string, unknown>): NormalizedAttempt {
  const duration = raw?.duration_in_seconds;
  return {
    attemptId: String(raw?.attempt_id ?? ""),
    interactionId: normalizeSentinel(raw?.interaction_id),
    status: mapConnectivityStatus(raw?.connectivity_status),
    durationSeconds: typeof duration === "number" ? duration : (duration != null && !Number.isNaN(Number(duration)) ? Number(duration) : null),
    endedBy: normalizeSentinel(raw?.ended_by),
    failureReason: normalizeSentinel(raw?.failure_reason),
    userContact: (raw?.user_contact as string | undefined) ?? null,
    agentVariables: (raw?.agent_variables && typeof raw.agent_variables === "object") ? raw.agent_variables as Record<string, unknown> : {},
    attemptedAt: raw?.attempted_at ? String(raw.attempted_at) : null,
  };
}

// GET /analytics/v1/{org}/{ws}/{app}/attempts?start_datetime&end_datetime&limit
// Never throws: a misconfigured client or an upstream failure returns [] and
// lets the caller (the sync route) report zero progress rather than 500ing.
export async function listAttempts(sinceISO: string, untilISO: string, limit: number): Promise<NormalizedAttempt[]> {
  const cfg = getConfig();
  if (!cfg) return [];
  const url =
    `${BASE}/analytics/v1/${cfg.orgId}/${cfg.workspaceId}/${cfg.appId}/attempts` +
    `?start_datetime=${encodeURIComponent(sinceISO)}&end_datetime=${encodeURIComponent(untilISO)}&limit=${limit}`;
  try {
    const r = await fetch(url, { headers: { "X-API-Key": cfg.apiKey } });
    if (!r.ok) return [];
    const json = (await r.json().catch(() => null)) as { items?: unknown[] } | null;
    const items = Array.isArray(json?.items) ? json.items : [];
    return items.map((it) => normalizeAttempt(it as Record<string, unknown>));
  } catch {
    return [];
  }
}

export type TranscriptTurn = { role: "agent" | "user"; en_text: string };

// GET /analytics/v1/{org}/{ws}/{app}/transcripts/{interaction_id}
// interaction_id contains "/" and ":" and MUST be URL-encoded.
// Normalises Sarvam's {role, content} (role: assistant|user) into our stored
// shape {role: agent|user, en_text} so the existing Inbox transcript renderer
// (InboxView.tsx, role === "agent" -> "PROMUNCH") keeps working unmodified.
export async function fetchTranscript(interactionId: string): Promise<TranscriptTurn[]> {
  const cfg = getConfig();
  if (!cfg) return [];
  const url = `${BASE}/analytics/v1/${cfg.orgId}/${cfg.workspaceId}/${cfg.appId}/transcripts/${encodeURIComponent(interactionId)}`;
  try {
    const r = await fetch(url, { headers: { "X-API-Key": cfg.apiKey } });
    if (!r.ok) return [];
    const json = (await r.json().catch(() => null)) as { messages?: Array<{ role?: string; content?: string }> } | null;
    const messages = Array.isArray(json?.messages) ? json.messages : [];
    return messages.map((m) => ({
      role: m.role === "assistant" ? "agent" : "user",
      en_text: String(m.content ?? ""),
    }));
  } catch {
    return [];
  }
}

// GET /analytics/v1/{org}/{ws}/{app}/recordings/{interaction_id} -> raw audio/wav
// Returns null on any failure so the recording route can 404/502 as it sees
// fit; never throws, never leaks the API key (it stays server-side only).
export async function fetchRecording(interactionId: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null> {
  const cfg = getConfig();
  if (!cfg) return null;
  const url = `${BASE}/analytics/v1/${cfg.orgId}/${cfg.workspaceId}/${cfg.appId}/recordings/${encodeURIComponent(interactionId)}`;
  try {
    const r = await fetch(url, { headers: { "X-API-Key": cfg.apiKey } });
    if (!r.ok || !r.body) return null;
    return { body: r.body, contentType: r.headers.get("content-type") || "audio/wav" };
  } catch {
    return null;
  }
}
