// Owner-managed API keys (Settings → API keys). Server-only.
//
// Resolution order: app_secrets table (dashboard-saved) → process.env. The
// table is service-role-only, so a saved key is exactly as private as a Vercel
// env var; the dashboard just makes rotation possible without a redeploy.
// Every management route MUST gate on requireSecretsOwner() — this feature is
// restricted to the single workspace owner, not admins in general.

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCaller } from "@/lib/rbac-server";

export const SECRETS_OWNER = (process.env.SECRETS_OWNER_EMAIL || "kmutha@vippysoya.com").toLowerCase();

export type SecretDef = {
  name: string;
  label: string;
  group: string;
  hint: string;
  testable: boolean;
};

// Keys the Next.js app actually reads through getSecret() — replacing one here
// takes effect within a minute, no redeploy. Edge-function secrets (WhatsApp
// token, Slack, Amazon SP-API) live in Supabase function secrets and are not
// listed: showing a Replace button that silently wouldn't reach them would lie.
export const EDITABLE_KEYS: SecretDef[] = [
  { name: "OPENAI_API_KEY", label: "OpenAI", group: "AI", hint: "Maya assistant, B2B drafts, lead scoring", testable: true },
  { name: "RESEND_API_KEY", label: "Resend", group: "Email", hint: "Campaign, outreach and invite email sending", testable: true },
  { name: "GOOGLE_PLACES_API_KEY", label: "Google Places", group: "B2B leads", hint: "Lead discovery search", testable: true },
  // Admin API token for the WhatsApp Growth one-click install (creates the
  // storefront script tag). Needs the write_script_tags scope. Read via
  // getSecret() by src/app/api/whatsapp/growth/route.ts.
  { name: "SHOPIFY_ACCESS_TOKEN", label: "Shopify Admin", group: "Store", hint: "Publish the WhatsApp popup + chat button to your store (needs write_script_tags scope)", testable: true },
  { name: "KLAVIYO_API_KEY", label: "Klaviyo", group: "Email", hint: "Legacy profile enrichment imports", testable: true },
  { name: "APIFY_TOKEN", label: "Apify", group: "Instagram", hint: "Influencer discovery scrapers", testable: true },
];

export const KEY_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

const cache = new Map<string, { value: string | null; at: number }>();
const TTL_MS = 60_000;

/** Effective secret value: dashboard-saved first, env fallback. Never throws. */
export async function getSecret(name: string): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value ?? process.env[name] ?? null;
  let dbValue: string | null = null;
  try {
    const { data } = await supabaseAdmin.from("app_secrets").select("value").eq("name", name).maybeSingle();
    dbValue = (data?.value as string | undefined) ?? null;
  } catch {
    // Table not created yet (migration pending) — env fallback covers it.
  }
  cache.set(name, { value: dbValue, at: Date.now() });
  return dbValue ?? process.env[name] ?? null;
}

export function bustSecretCache(name?: string) {
  if (name) cache.delete(name);
  else cache.clear();
}

export type OwnerGate = { ok: true; user: User } | { ok: false; response: NextResponse };

export async function requireSecretsOwner(): Promise<OwnerGate> {
  const user = await getCaller();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if ((user.email ?? "").toLowerCase() !== SECRETS_OWNER) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `restricted: only ${SECRETS_OWNER} can manage API keys` },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user };
}

// ---- live key tests ---------------------------------------------------------

export type TestResult = { ok: boolean; detail: string };

export async function testSecret(name: string, value: string): Promise<TestResult> {
  const t = (p: Promise<Response>) => p.then((r) => r).catch(() => null);
  try {
    switch (name) {
      case "OPENAI_API_KEY": {
        const r = await t(fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${value}` } }));
        return r?.ok ? { ok: true, detail: "OpenAI accepted the key" } : { ok: false, detail: `OpenAI rejected the key (${r?.status ?? "network error"})` };
      }
      case "RESEND_API_KEY": {
        const r = await t(fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${value}` } }));
        return r?.ok ? { ok: true, detail: "Resend accepted the key" } : { ok: false, detail: `Resend rejected the key (${r?.status ?? "network error"})` };
      }
      case "GOOGLE_PLACES_API_KEY": {
        const r = await t(
          fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: { "content-type": "application/json", "X-Goog-Api-Key": value, "X-Goog-FieldMask": "places.id" },
            body: JSON.stringify({ textQuery: "cafe in Mumbai", maxResultCount: 1 }),
          })
        );
        return r?.ok ? { ok: true, detail: "Google Places accepted the key" } : { ok: false, detail: `Google Places rejected the key (${r?.status ?? "network error"})` };
      }
      case "SHOPIFY_ACCESS_TOKEN": {
        const raw = process.env.SHOPIFY_STORE_URL || "a1e4f4-2.myshopify.com";
        const base = raw.startsWith("http") ? raw.replace(/\/$/, "") : `https://${raw.replace(/\/$/, "")}`;
        const r = await t(fetch(`${base}/admin/api/2024-10/shop.json`, { headers: { "X-Shopify-Access-Token": value } }));
        return r?.ok ? { ok: true, detail: "Shopify accepted the token" } : { ok: false, detail: `Shopify rejected the token (${r?.status ?? "network error"})` };
      }
      case "APIFY_TOKEN": {
        const r = await t(fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(value)}`));
        return r?.ok ? { ok: true, detail: "Apify accepted the token" } : { ok: false, detail: `Apify rejected the token (${r?.status ?? "network error"})` };
      }
      case "KLAVIYO_API_KEY": {
        const r = await t(fetch("https://a.klaviyo.com/api/accounts/", { headers: { Authorization: `Klaviyo-API-Key ${value}`, revision: "2024-10-15" } }));
        return r?.ok ? { ok: true, detail: "Klaviyo accepted the key" } : { ok: false, detail: `Klaviyo rejected the key (${r?.status ?? "network error"})` };
      }
      default:
        return { ok: true, detail: "No live test for this key; it will be saved as provided" };
    }
  } catch (e) {
    return { ok: false, detail: `test failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
