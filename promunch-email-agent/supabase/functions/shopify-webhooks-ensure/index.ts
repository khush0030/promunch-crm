// Audit + repair the Shopify webhook subscriptions that feed the WhatsApp
// journeys.
//
// WHY THIS EXISTS: abandoned-cart enrolment silently collapsed in July 2026 —
// orders kept flowing (so orders/create was clearly still subscribed) while
// cart enrolments dropped to ~0.5/day against ~6/day of real abandoned
// checkouts in the Shopify admin. A missing or mis-addressed checkouts/*
// subscription is invisible from inside the database: no error, no event, just
// silence. This function makes the subscription list observable and
// self-healing.
//
// GET  -> audit only. Lists every subscription and reports which required
//         topics are missing or pointed at the wrong address.
// POST -> audit, then CREATE the missing ones (and re-point any required topic
//         whose address is not ours). Never deletes a subscription it does not
//         own the address of, so a third-party app's hooks are left alone.
//
// Internal-only (service-role bearer) — it can mutate store configuration.

import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector } from "../_shared/connector-log.ts";

const API_VERSION = "2025-01";

// Every topic the WhatsApp/journey machine depends on, and the function that
// must receive it. checkouts/create AND checkouts/update are both required:
// a checkout often has no phone at creation and only gains one on a later
// update, and shopify-wa's per-token claim makes the double delivery a no-op.
//
// IMPORTANT — `create` is deliberately false for the orders/* topics. Shopify's
// Admin API only returns webhooks owned by the CALLING app, and this app owns
// none: the live orders/* subscriptions were registered elsewhere (a different
// app or by hand) and are demonstrably working. Registering our own duplicates
// would add a second delivery path for events that already arrive. The atomic
// claims would swallow the duplicate, but the correct move is not to touch a
// working path at all. checkouts/* is the opposite case: cart enrolment is
// starved, and a duplicate checkout event is a proven no-op (shopify-wa takes
// `claimSend(abandoned_enrol:<token>)` before enrolling, so a cart enrols
// exactly once no matter how many times the topic fires).
const REQUIRED: Array<{ topic: string; fn: string; create: boolean }> = [
  { topic: "orders/create", fn: "shopify-wa", create: false },
  { topic: "orders/fulfilled", fn: "shopify-wa", create: false },
  { topic: "orders/cancelled", fn: "shopify-wa", create: false },
  { topic: "checkouts/create", fn: "shopify-wa", create: true },
  { topic: "checkouts/update", fn: "shopify-wa", create: true },
];

let cached: { token: string; exp: number } | null = null;

async function getAdminToken(domain: string): Promise<string | null> {
  const id = Deno.env.get("SHOPIFY_CLIENT_ID");
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!id || !secret) return null;
  const now = Date.now();
  if (cached && cached.exp > now + 60_000) return cached.token;
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) return null;
  const j = await res.json() as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 86399) * 1000 };
  return cached.token;
}

function fnBaseUrl(): string {
  // SUPABASE_URL is auto-injected: https://<ref>.supabase.co
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${base}/functions/v1`;
}

type Sub = { id: string; topic: string; address: string };

async function listSubs(domain: string, token: string): Promise<Sub[]> {
  const out: Sub[] = [];
  let url: string | null =
    `https://${domain}/admin/api/${API_VERSION}/webhooks.json?limit=250`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token, "Accept": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`webhooks.json ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const j = await res.json() as { webhooks?: Array<Record<string, unknown>> };
    for (const w of j.webhooks ?? []) {
      out.push({
        id: String(w.id ?? ""),
        topic: String(w.topic ?? ""),
        address: String(w.address ?? ""),
      });
    }
    // cursor pagination via the Link header
    const link = res.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
  }
  return out;
}

async function createSub(
  domain: string,
  token: string,
  topic: string,
  address: string,
): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(
    `https://${domain}/admin/api/${API_VERSION}/webhooks.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    },
  );
  const body = (await res.text()).slice(0, 300);
  return { ok: res.ok, detail: res.ok ? "created" : `${res.status}: ${body}` };
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;

  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!domain) return j({ ok: false, error: "SHOPIFY_STORE_DOMAIN unset" }, 500);

  const token = await getAdminToken(domain);
  if (!token) {
    return j({ ok: false, error: "admin-not-configured (SHOPIFY_CLIENT_ID/SECRET)" }, 500);
  }

  const base = fnBaseUrl();
  const apply = req.method === "POST";

  let subs: Sub[];
  try {
    subs = await listSubs(domain, token);
  } catch (e) {
    // Most likely a missing read_webhooks scope on the app. Say so plainly —
    // this is exactly the ops/config class of failure that looks like a bug.
    const msg = e instanceof Error ? e.message : String(e);
    await logConnector({
      connector: "shopify_wa", level: "error", event: "webhook_audit_failed",
      message: `Could not list Shopify webhooks: ${msg}`,
    }).catch(() => {});
    return j({ ok: false, error: msg, hint: "app likely missing read_webhooks scope" }, 502);
  }

  const report: Array<Record<string, unknown>> = [];
  const repaired: string[] = [];

  for (const need of REQUIRED) {
    const want = `${base}/${need.fn}`;
    const onTopic = subs.filter((s) => s.topic === need.topic);
    const correct = onTopic.find((s) => s.address === want);
    if (correct) {
      report.push({ topic: need.topic, status: "ok", address: want });
      continue;
    }
    const wrong = onTopic.map((s) => s.address);
    if (!need.create) {
      // Audit-only topic. "not_owned_by_this_app" is the expected state, NOT a
      // gap: the subscription exists, it just belongs to another app so this
      // API cannot see it. Verified live by orders/create traffic.
      report.push({
        topic: need.topic,
        status: "not_owned_by_this_app",
        note: "audit-only; verify via connector_events traffic, do not auto-create",
      });
      continue;
    }
    if (apply) {
      const r = await createSub(domain, token, need.topic, want);
      if (r.ok) repaired.push(need.topic);
      report.push({
        topic: need.topic,
        status: r.ok ? "created" : "create_failed",
        detail: r.detail,
        other_addresses: wrong,
      });
    } else {
      report.push({
        topic: need.topic,
        status: onTopic.length ? "wrong_address" : "missing",
        other_addresses: wrong,
      });
    }
  }

  const broken = report.filter(
    (r) => r.status !== "ok" && r.status !== "created" && r.status !== "not_owned_by_this_app",
  );
  if (broken.length) {
    await logConnector({
      connector: "shopify_wa",
      level: "error",
      event: "webhook_subscription_gap",
      message: `Shopify webhook gap: ${broken.map((b) => `${b.topic}=${b.status}`).join(", ")}`,
    }).catch(() => {});
  }
  if (repaired.length) {
    await logConnector({
      connector: "shopify_wa",
      level: "info",
      event: "webhook_subscription_repaired",
      message: `Registered missing Shopify webhooks: ${repaired.join(", ")}`,
    }).catch(() => {});
  }

  return j({
    ok: broken.length === 0,
    applied: apply,
    expected_base: base,
    required: report,
    repaired,
    all_subscriptions: subs.map((s) => ({ topic: s.topic, address: s.address })),
  });
});

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
