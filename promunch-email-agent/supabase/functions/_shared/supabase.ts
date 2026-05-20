// Supabase server-side client (service-role).
// Edge functions get SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY injected automatically.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

let _client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
