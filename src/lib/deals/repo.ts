// Server-side reads and writes for deals, shared by the /api/deals routes and
// the bulk form intake. Deals never message anyone: nothing here sends.
//
// Works before AND after migration 20261010100000_deals_simplify.sql: when a
// write fails because a new column or the new stage names are not in the DB
// yet, it retries with only the old columns and the old stage name (extra
// facts are folded into notes so nothing typed is lost).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { istToday, normalizeDeal, type ActivityKind, type Deal, type DealActivity } from "./model";
import { isSchemaLag, toLegacyRow, type PgError } from "./legacy";

export { isSchemaLag, toLegacyRow };

export async function schemaReady(): Promise<boolean> {
  const { error } = await supabaseAdmin.from("deals").select("id, follow_up_at, value_inr").limit(1);
  return !error;
}

export async function getDeal(id: string): Promise<Deal | null> {
  const { data, error } = await supabaseAdmin.from("deals").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeDeal(data as Record<string, unknown>, istToday()) : null;
}

export async function insertDeal(row: Record<string, unknown>): Promise<Deal> {
  let res = await supabaseAdmin.from("deals").insert(row).select().single();
  if (res.error && isSchemaLag(res.error)) {
    res = await supabaseAdmin.from("deals").insert(toLegacyRow(row)).select().single();
  }
  if (res.error) throw new Error(res.error.message);
  return normalizeDeal(res.data as Record<string, unknown>, istToday());
}

export async function updateDeal(id: string, patch: Record<string, unknown>, existingNotes: string | null = null): Promise<Deal | null> {
  let res = await supabaseAdmin.from("deals").update(patch).eq("id", id).select().maybeSingle();
  if (res.error && isSchemaLag(res.error)) {
    const legacy = toLegacyRow(patch, existingNotes);
    if (Object.keys(legacy).length === 0) return getDeal(id);
    res = await supabaseAdmin.from("deals").update(legacy).eq("id", id).select().maybeSingle();
  }
  if (res.error) throw new Error(res.error.message);
  return res.data ? normalizeDeal(res.data as Record<string, unknown>, istToday()) : null;
}

/** Append to the activity log. Before the migration: append to deals.notes. */
export async function addActivity(
  dealId: string,
  entries: { kind: ActivityKind; body: string }[],
  author: string | null,
): Promise<DealActivity[]> {
  const rows = entries
    .map((e) => ({ deal_id: dealId, kind: e.kind, body: e.body.trim().slice(0, 4000), author }))
    .filter((r) => r.body);
  if (!rows.length) return [];
  const { data, error } = await supabaseAdmin.from("deal_activity").insert(rows).select();
  if (!error) return (data ?? []) as DealActivity[];
  if (!isSchemaLag(error)) throw new Error(error.message);

  const { data: d } = await supabaseAdmin.from("deals").select("notes").eq("id", dealId).maybeSingle();
  const stamp = istToday();
  const add = rows.map((r) => `${stamp} ${r.kind}${author ? ` (${author})` : ""}: ${r.body}`).join("\n");
  await supabaseAdmin
    .from("deals")
    .update({ notes: [d?.notes, add].filter(Boolean).join("\n\n").slice(0, 8000) })
    .eq("id", dealId);
  return [];
}

export async function listActivity(dealId: string): Promise<{ rows: DealActivity[]; ready: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("deal_activity")
    .select("id, deal_id, kind, body, author, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    if (isSchemaLag(error)) return { rows: [], ready: false };
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as DealActivity[], ready: true };
}

/**
 * The open deal this new one would duplicate: same source_ref, then same
 * email, then same phone. Won and Lost deals don't count (a returning buyer
 * is a new deal). Each lookup tolerates a pre-migration DB.
 */
export async function findOpenDuplicate(keys: {
  source_ref: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}): Promise<Deal | null> {
  const closed = "(won,lost)";
  const tries: (() => PromiseLike<{ data: unknown[] | null; error: PgError }>)[] = [];
  if (keys.source_ref) {
    tries.push(() =>
      supabaseAdmin.from("deals").select("*").eq("source_ref", keys.source_ref!).not("stage", "in", closed)
        .order("created_at", { ascending: false }).limit(1),
    );
  }
  if (keys.contact_email) {
    tries.push(() =>
      supabaseAdmin.from("deals").select("*").ilike("contact_email", keys.contact_email!.replace(/[%_\\]/g, "\\$&"))
        .not("stage", "in", closed).order("created_at", { ascending: false }).limit(1),
    );
  }
  if (keys.contact_phone) {
    tries.push(() =>
      supabaseAdmin.from("deals").select("*").eq("contact_phone", keys.contact_phone!).not("stage", "in", closed)
        .order("created_at", { ascending: false }).limit(1),
    );
  }
  for (const t of tries) {
    const { data, error } = await t();
    if (error) {
      if (isSchemaLag(error)) continue;
      throw new Error(error.message ?? "duplicate lookup failed");
    }
    if (data?.length) return normalizeDeal(data[0] as Record<string, unknown>, istToday());
  }
  return null;
}
