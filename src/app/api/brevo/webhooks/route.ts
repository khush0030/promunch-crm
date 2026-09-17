import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSecret, bustSecretCache, requireSecretsOwner } from "@/lib/secrets";
import { recordAudit } from "@/lib/audit";
import { brevo, brevoGet, orNull, BrevoError } from "@/lib/brevo";
import type { BrevoWebhook } from "@/lib/brevo-shape";
import { BREVO_HOOK_URL, EXPECTED_HOOK_EVENTS, type HookKind } from "@/lib/brevo-hooks";

// Brevo webhook registration for the Health tab.
//   GET  -> expected vs registered webhooks + recent ledger counts
//   POST -> (owner only) create or update the marketing + transactional
//           webhooks pointing at /api/webhooks/brevo with a bearer token.
export const dynamic = "force-dynamic";

const EXPECTED = EXPECTED_HOOK_EVENTS;
type Kind = HookKind;

export type WebhookStatus = {
  url: string;
  secretSet: boolean;
  kinds: { type: Kind; registered: BrevoWebhook | null; missingEvents: string[] }[];
  ledger: { last24h: number; lastReceivedAt: string | null; byEvent: Record<string, number> };
};

async function listByType(type: Kind): Promise<BrevoWebhook[]> {
  const r = await orNull(brevoGet<{ webhooks?: BrevoWebhook[] }>(`/webhooks?type=${type}`));
  return r?.webhooks ?? [];
}

async function status(): Promise<WebhookStatus> {
  const [secret, marketing, transactional, recent, last] = await Promise.all([
    getSecret("BREVO_WEBHOOK_SECRET"),
    listByType("marketing"),
    listByType("transactional"),
    supabaseAdmin.from("brevo_events").select("event").gte("received_at", new Date(Date.now() - 86_400_000).toISOString()).limit(5000),
    supabaseAdmin.from("brevo_events").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const byEvent: Record<string, number> = {};
  for (const r of recent.data ?? []) byEvent[r.event as string] = (byEvent[r.event as string] ?? 0) + 1;
  const kind = (type: Kind, hooks: BrevoWebhook[]) => {
    const mine = hooks.find((h) => h.url === BREVO_HOOK_URL) ?? null;
    return { type, registered: mine, missingEvents: EXPECTED[type].filter((e) => !mine?.events.includes(e)) };
  };
  return {
    url: BREVO_HOOK_URL,
    secretSet: Boolean(secret),
    kinds: [kind("marketing", marketing), kind("transactional", transactional)],
    ledger: { last24h: recent.data?.length ?? 0, lastReceivedAt: (last.data?.received_at as string | undefined) ?? null, byEvent },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await status());
  } catch (e) {
    console.error("[brevo/webhooks] status", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "status failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  try {
    // One shared bearer token; generated once and kept in app_secrets so the
    // receiver (getSecret) and Brevo agree without a redeploy.
    let secret = await getSecret("BREVO_WEBHOOK_SECRET");
    if (!secret) {
      secret = randomBytes(32).toString("hex");
      const { error } = await supabaseAdmin
        .from("app_secrets")
        .upsert({ name: "BREVO_WEBHOOK_SECRET", value: secret, updated_by: gate.user.email, updated_at: new Date().toISOString() });
      if (error) throw new Error(`could not save webhook secret: ${error.message}`);
      bustSecretCache("BREVO_WEBHOOK_SECRET");
    }

    const done: string[] = [];
    for (const type of Object.keys(EXPECTED) as Kind[]) {
      const hooks = await listByType(type);
      const mine = hooks.find((h) => h.url === BREVO_HOOK_URL);
      const body = {
        description: `PROMUNCH CRM ${type} events`,
        url: BREVO_HOOK_URL,
        events: EXPECTED[type],
        auth: { type: "bearer", token: secret },
      };
      if (mine) {
        await brevo("PUT", `/webhooks/${mine.id}`, body);
        done.push(`${type}: updated #${mine.id}`);
      } else {
        const created = await brevo<{ id: number }>("POST", "/webhooks", { ...body, type });
        done.push(`${type}: created #${created.id}`);
      }
    }

    await recordAudit({ action: "brevo.webhooks_register", entityType: "brevo", summary: done.join("; "), actor: gate.user, request: req });
    return NextResponse.json({ ok: true, done, status: await status() });
  } catch (e) {
    console.error("[brevo/webhooks] register", e);
    const msg = e instanceof BrevoError ? `Brevo ${e.status}: ${e.message}` : e instanceof Error ? e.message : "register failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
