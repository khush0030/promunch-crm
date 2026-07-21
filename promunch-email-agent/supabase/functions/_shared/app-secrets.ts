// Owner-managed secrets for edge functions.
//
// Resolution order: app_secrets table (saved from Settings → API keys in the
// dashboard) → Deno.env. Mirrors src/lib/secrets.ts getSecret() so the owner
// can rotate a provider key (e.g. APIFY_TOKEN) without a function redeploy.
// app_secrets is service-role-only; edge functions run with the service key.

import { db } from "./supabase.ts";

const cache = new Map<string, { value: string | null; at: number }>();
const TTL_MS = 60_000;

/** Effective secret value: dashboard-saved first, env fallback. Never throws. */
export async function getAppSecret(name: string): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value ?? Deno.env.get(name) ?? null;
  let dbValue: string | null = null;
  try {
    const { data } = await db().from("app_secrets").select("value").eq("name", name).maybeSingle();
    dbValue = (data?.value as string | undefined) ?? null;
  } catch {
    // table missing (migration pending) — env fallback covers it
  }
  cache.set(name, { value: dbValue, at: Date.now() });
  return dbValue ?? Deno.env.get(name) ?? null;
}
