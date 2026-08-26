// Sarvam Voice Agents (indus.sarvam.ai) REST client. Docs:
//   https://docs.sarvam.ai/api-reference/instant-outbound/create
//   https://docs.sarvam.ai/conversations/deploy/campaigns/dnd
// API key is owner-rotatable via app_secrets (Settings -> API keys); the ids
// are function secrets because they change only when the agent is rebuilt.

import { getAppSecret } from "./app-secrets.ts";

const BASE = "https://apps.sarvam.ai/api";

export interface SarvamConfig {
  apiKey: string; orgId: string; workspaceId: string; appId: string;
  appVersion: number; connectionId: string; agentPhone: string;
}

export async function sarvamConfig(): Promise<SarvamConfig | null> {
  const apiKey = await getAppSecret("SARVAM_API_KEY");
  const orgId = Deno.env.get("SARVAM_ORG_ID");
  const workspaceId = Deno.env.get("SARVAM_WORKSPACE_ID");
  const appId = Deno.env.get("SARVAM_APP_ID");
  const appVersion = Number(Deno.env.get("SARVAM_APP_VERSION") ?? "1");
  const connectionId = Deno.env.get("SARVAM_CONNECTION_ID");
  const agentPhone = Deno.env.get("SARVAM_AGENT_PHONE");
  if (!apiKey || !orgId || !workspaceId || !appId || !connectionId || !agentPhone) return null;
  return { apiKey, orgId, workspaceId, appId, appVersion, connectionId, agentPhone };
}

export async function startOutboundCall(args: {
  phoneE164: string;
  agentVariables: Record<string, string>;
  language: string;
  webhookUrl: string;
  metadata: Record<string, string>;
}): Promise<{ ok: true; attemptId: string } | { ok: false; error: string }> {
  const cfg = await sarvamConfig();
  if (!cfg) return { ok: false, error: "sarvam not configured (missing SARVAM_* secrets)" };
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
    if (!r.ok) return { ok: false, error: `sarvam HTTP ${r.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as { attempt_id?: string };
    if (!json.attempt_id) return { ok: false, error: `sarvam: no attempt_id in ${text.slice(0, 200)}` };
    return { ok: true, attemptId: json.attempt_id };
  } catch (e) {
    return { ok: false, error: `sarvam fetch failed: ${String(e)}` };
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
