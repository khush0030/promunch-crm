// Server-only guard for the "Warm" audience preset (audience_filter
// {engagement:"warm"}). Until migration 20260929130000_wa_warm_audience.sql is
// applied, the SQL audience function ignores `engagement`, so a Warm campaign
// would silently go to EVERYONE opted in. Every route that saves, previews or
// starts a Warm campaign calls this first and refuses when support is missing
// (fail closed: a probe error also refuses).
import { supabaseAdmin } from "@/lib/supabase-admin";

let supportedAt = 0; // cache only the positive answer
const TTL_MS = 10 * 60_000;

export const WARM_MIGRATION_ERROR =
  "The Warm audience needs a database update (migration 20260929130000_wa_warm_audience.sql). Pick another audience for now and tell the owner.";

export async function warmAudienceError(filter: unknown): Promise<string | null> {
  const eng = (filter as { engagement?: unknown } | null | undefined)?.engagement;
  if (eng == null || eng === "") return null;
  if (Date.now() - supportedAt < TTL_MS) return null;
  // A preset the SQL doesn't know must match nobody once the migration is in;
  // before it, the key is ignored and the probe matches everyone.
  const { data, error } = await supabaseAdmin
    .rpc("wa_campaign_filter_match", { p_filter: { engagement: "__probe__" } })
    .limit(1);
  if (error || (data?.length ?? 0) > 0) return WARM_MIGRATION_ERROR;
  supportedAt = Date.now();
  return null;
}
