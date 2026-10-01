// Sarvam Voice Agents (indus.sarvam.ai) REST client. Docs:
//   https://docs.sarvam.ai/api-reference/instant-outbound/create
//   https://docs.sarvam.ai/conversations/deploy/campaigns/dnd
// API key is owner-rotatable via app_secrets (Settings -> API keys); the ids
// are function secrets because they change only when the agent is rebuilt.

import { getAppSecret } from "./app-secrets.ts";

const BASE = "https://apps.sarvam.ai/api";

export type VoicePurpose = "cart" | "cod_confirm";

export interface SarvamConfig {
  apiKey: string; orgId: string; workspaceId: string; appId: string;
  appVersion: number; connectionId: string; agentPhone: string;
}

export async function sarvamConfig(purpose: VoicePurpose = "cart"): Promise<SarvamConfig | null> {
  const apiKey = await getAppSecret("SARVAM_API_KEY");
  const orgId = Deno.env.get("SARVAM_ORG_ID");
  const workspaceId = Deno.env.get("SARVAM_WORKSPACE_ID");
  // Each purpose is its own Sarvam agent (different prompt, variables and tool).
  const appId = Deno.env.get(purpose === "cod_confirm" ? "SARVAM_COD_APP_ID" : "SARVAM_APP_ID");
  const appVersion = Number(Deno.env.get(purpose === "cod_confirm" ? "SARVAM_COD_APP_VERSION" : "SARVAM_APP_VERSION") ?? "1");
  const connectionId = Deno.env.get("SARVAM_CONNECTION_ID");
  const agentPhone = Deno.env.get("SARVAM_AGENT_PHONE");
  if (!apiKey || !orgId || !workspaceId || !appId || !connectionId || !agentPhone) return null;
  return { apiKey, orgId, workspaceId, appId, appVersion, connectionId, agentPhone };
}

// Only a 4xx proves Sarvam rejected the request without queueing a call. A 5xx
// or gateway error can come back AFTER the call was queued, and a thrown fetch
// or a 2xx without attempt_id means we cannot know. Those are NOT definite, so
// the caller must never hand the attempt back (a redial would call twice).
export function isDefiniteRefusal(status: number | null): boolean {
  return status != null && status >= 400 && status <= 499;
}

export async function startOutboundCall(args: {
  purpose: VoicePurpose;
  phoneE164: string;
  agentVariables: Record<string, string>;
  language: string;
  webhookUrl: string;
  metadata: Record<string, string>;
}): Promise<{ ok: true; attemptId: string } | { ok: false; definite: boolean; error: string }> {
  const cfg = await sarvamConfig(args.purpose);
  if (!cfg) return { ok: false, definite: true, error: `sarvam not configured for ${args.purpose} (missing SARVAM_* secrets)` };
  const url = `${BASE}/outbounds/v1/orgs/${cfg.orgId}/workspaces/${cfg.workspaceId}/outbounds`;
  const body = {
    app_config: {
      app_id: cfg.appId,
      app_version: cfg.appVersion,
      connection_config: { connection_id: cfg.connectionId, agent_phone_number: cfg.agentPhone },
      agent_variables: args.agentVariables,
      app_type: "agent",
      app_overrides: { initial_language_name: args.language },
    },
    user_config: { user_phone_number: args.phoneE164 },
    webhook_config: { url: args.webhookUrl, metadata: args.metadata },
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "X-API-Key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, definite: isDefiniteRefusal(r.status), error: `sarvam HTTP ${r.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as { attempt_id?: string };
    if (!json.attempt_id) return { ok: false, definite: false, error: `sarvam: no attempt_id in ${text.slice(0, 200)}` };
    return { ok: true, attemptId: json.attempt_id };
  } catch (e) {
    return { ok: false, definite: false, error: `sarvam fetch failed: ${String(e)}` };
  }
}

// Best effort. Sarvam documents the DND list as a dashboard feature; the
// endpoint below is the scheduling service's list. If it 404s we still keep our
// own voice_dnd flag, which is what actually gates dialling.
export async function addToDndList(phoneE164: string): Promise<boolean> {
  const cfg = await sarvamConfig();
  if (!cfg) return false;
  try {
    const r = await fetch(`${BASE}/scheduling/v1/orgs/${cfg.orgId}/workspaces/${cfg.workspaceId}/dnd`, {
      method: "POST",
      headers: { "X-API-Key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_numbers: [phoneE164] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ---- Analytics (reconcile path) ------------------------------------------------
// Sarvam's post-call webhook has not been reliably delivered to us (see
// VoiceView.tsx), so voice-tick polls the per-agent analytics API for calls
// stuck on 'dialing'. Same shapes as src/lib/sarvam-voice.ts.

const SENTINEL_RE = /^NO_[A-Z_]+$/;
const sentinel = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v);
  return s.length === 0 || SENTINEL_RE.test(s) ? null : s;
};
const TERMINAL = new Set(["connected", "no_answer", "busy", "failed"]);

export interface NormalizedAttempt {
  attemptId: string;
  interactionId: string | null;
  status: "connected" | "no_answer" | "busy" | "failed" | "unknown";
  durationSeconds: number | null;
  failureReason: string | null;
  agentVariables: Record<string, unknown>;
}

export function normalizeAttempt(raw: Record<string, unknown>): NormalizedAttempt {
  const s = String(raw?.connectivity_status ?? "").toLowerCase().trim();
  const d = raw?.duration_in_seconds;
  const dn = d == null || Number.isNaN(Number(d)) ? null : Number(d);
  return {
    attemptId: String(raw?.attempt_id ?? ""),
    interactionId: sentinel(raw?.interaction_id),
    status: (TERMINAL.has(s) ? s : "unknown") as NormalizedAttempt["status"],
    durationSeconds: dn,
    failureReason: sentinel(raw?.failure_reason),
    agentVariables: raw?.agent_variables && typeof raw.agent_variables === "object"
      ? raw.agent_variables as Record<string, unknown> : {},
  };
}

export async function listAttempts(
  purpose: VoicePurpose, sinceISO: string, untilISO: string, limit = 200,
): Promise<NormalizedAttempt[]> {
  const cfg = await sarvamConfig(purpose);
  if (!cfg) return [];
  const url = `${BASE}/analytics/v1/${cfg.orgId}/${cfg.workspaceId}/${cfg.appId}/attempts` +
    `?start_datetime=${encodeURIComponent(sinceISO)}&end_datetime=${encodeURIComponent(untilISO)}&limit=${limit}`;
  try {
    const r = await fetch(url, { headers: { "X-API-Key": cfg.apiKey } });
    if (!r.ok) return [];
    const json = await r.json().catch(() => null) as { items?: unknown[] } | null;
    return (Array.isArray(json?.items) ? json!.items! : []).map((x) => normalizeAttempt(x as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function fetchTranscript(
  purpose: VoicePurpose, interactionId: string,
): Promise<Array<{ role: "agent" | "user"; en_text: string }>> {
  const cfg = await sarvamConfig(purpose);
  if (!cfg) return [];
  try {
    const r = await fetch(
      `${BASE}/analytics/v1/${cfg.orgId}/${cfg.workspaceId}/${cfg.appId}/transcripts/${encodeURIComponent(interactionId)}`,
      { headers: { "X-API-Key": cfg.apiKey } },
    );
    if (!r.ok) return [];
    const json = await r.json().catch(() => null) as { messages?: Array<{ role?: string; content?: string }> } | null;
    return (json?.messages ?? []).map((m) => ({ role: m.role === "assistant" ? "agent" : "user", en_text: String(m.content ?? "") }));
  } catch {
    return [];
  }
}
