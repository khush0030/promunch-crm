// CRM -> Brevo contact sync. Server-only.
//
// Test mode (brevo_settings.sync_target = 'test', the default) only ever
// touches the addresses in brevo_settings.test_emails, into the "PROMUNCH TEST"
// list. Live mode syncs every marketing-consented contact (rules in
// brevo-audience.ts) into "PROMUNCH customers (CRM)". Only the owner can flip
// the target.
//
// Opt-outs flow the other way too: anything on the CRM suppression list, or a
// contact whose consent says UNSUBSCRIBED, is blocklisted in Brevo so a Brevo
// campaign can't reach them.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { brevo, brevoGet, listAll } from "@/lib/brevo";
import { getBrevoSettings } from "@/lib/brevo-settings";
import {
  SYNC_ATTRIBUTES,
  aggregateOrders,
  buildImportRow,
  marketingEligibility,
  rfmSegment,
  waIdOf,
  type ImportRow,
  type SkipReason,
  type SyncContact,
  type SyncOrder,
} from "@/lib/brevo-audience";

const FOLDER_NAME = "PROMUNCH CRM";
const LIST_NAME = { test: "PROMUNCH TEST", live: "PROMUNCH customers (CRM)" } as const;
const PAGE = 1000;
const IMPORT_CHUNK = 5000;
const MAX_BLOCKLIST_PER_RUN = 500;

export type SyncResult = {
  target: "test" | "live";
  dryRun: boolean;
  listId: number | null;
  listName: string;
  eligible: number;
  skipped: Partial<Record<SkipReason, number>>;
  blocklisted: number;
  attributesCreated: string[];
  processIds: number[];
  sample: ImportRow[];
};

// PostgREST caps a select at 1000 rows: walk the table by id.
async function pageAll<T>(table: string, columns: string, notNull: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .not(notNull, "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

async function ensureList(target: "test" | "live", existingId: number | null, dryRun: boolean): Promise<number | null> {
  const lists = await listAll<{ id: number; name: string }>("/contacts/lists", "lists", 50);
  if (existingId && lists.some((l) => l.id === existingId)) return existingId;
  const byName = lists.find((l) => l.name === LIST_NAME[target]);
  if (byName) return byName.id;
  if (dryRun) return null;
  const folders = await listAll<{ id: number; name: string }>("/contacts/folders", "folders", 50);
  const folderId = folders.find((f) => f.name === FOLDER_NAME)?.id ?? (await brevo<{ id: number }>("POST", "/contacts/folders", { name: FOLDER_NAME })).id;
  return (await brevo<{ id: number }>("POST", "/contacts/lists", { name: LIST_NAME[target], folderId })).id;
}

async function ensureAttributes(dryRun: boolean): Promise<string[]> {
  const { attributes } = await brevoGet<{ attributes?: { name: string; category: string }[] }>("/contacts/attributes");
  const have = new Set((attributes ?? []).map((a) => a.name.toUpperCase()));
  const missing = SYNC_ATTRIBUTES.filter((a) => !have.has(a.name));
  if (!dryRun) {
    for (const a of missing) await brevo("POST", `/contacts/attributes/normal/${a.name}`, { type: a.type });
  }
  return missing.map((a) => a.name);
}

// `previewTarget` only applies to dry runs: it lets the UI show what a live
// sync WOULD send without flipping the setting.
export async function runBrevoSync(opts: { dryRun?: boolean; previewTarget?: "test" | "live" } = {}): Promise<SyncResult> {
  const dryRun = opts.dryRun === true;
  const settings = await getBrevoSettings();
  if (!settings.migrated && !dryRun) throw new Error("brevo_settings table missing: apply migration 20260917100000_brevo_integration.sql");
  const target = dryRun && opts.previewTarget ? opts.previewTarget : settings.sync_target;
  const testEmails = new Set(settings.test_emails.map((e) => e.toLowerCase()));

  try {
    const [contacts, orders, waContacts, suppressionRows] = await Promise.all([
      pageAll<SyncContact>("contacts", "id, email, first_name, last_name, city, state, phone, status, accepts_marketing, email_consent, anonymized_at, total_orders, total_spent, first_purchase_date, last_purchase_date", "email"),
      pageAll<SyncOrder>("shopify_orders", "id, customer_email, total_price, shopify_created_at, source_name, is_creator, cancelled_at, financial_status", "customer_email"),
      pageAll<{ wa_id: string; tags: string[] | null }>("wa_contacts", "id, wa_id, tags", "tags"),
      supabaseAdmin.from("suppressions").select("email").limit(50_000),
    ]);
    if (suppressionRows.error) throw new Error(`suppressions: ${suppressionRows.error.message}`);

    const suppressed = new Set((suppressionRows.data ?? []).map((r) => String(r.email).toLowerCase()));
    const aggs = aggregateOrders(orders);
    const rfmByWa = new Map(waContacts.map((w) => [w.wa_id, rfmSegment(w.tags)]));

    const skipped: Partial<Record<SkipReason, number>> = {};
    const rows = new Map<string, ImportRow>();
    const optedOut = new Set<string>(suppressed);

    for (const c of contacts) {
      const email = c.email!.trim().toLowerCase();
      if (target === "test" && !testEmails.has(email)) continue;
      const verdict = marketingEligibility(c, suppressed);
      // Test addresses are the team's own inboxes: consent rules don't apply,
      // but suppression and anonymisation still do.
      const testOverride = target === "test" && !verdict.ok && verdict.reason === "no_consent";
      if (!verdict.ok && !testOverride) {
        skipped[verdict.reason] = (skipped[verdict.reason] ?? 0) + 1;
        if (verdict.reason === "unsubscribed") optedOut.add(email);
        continue;
      }
      const waId = waIdOf(c.phone);
      rows.set(email, buildImportRow(c, aggs.get(email), waId ? rfmByWa.get(waId) ?? null : null));
    }
    if (target === "test") {
      for (const email of testEmails) {
        if (!rows.has(email) && !suppressed.has(email)) rows.set(email, { email, attributes: { ORDER_COUNT: aggs.get(email)?.count ?? 0 } });
      }
    }

    const blockTargets = [...optedOut].filter((e) => target === "live" || testEmails.has(e)).slice(0, MAX_BLOCKLIST_PER_RUN);
    const importRows = [...rows.values()];
    const attributesCreated = await ensureAttributes(dryRun);
    const listId = await ensureList(target, target === "test" ? settings.test_list_id : settings.live_list_id, dryRun);

    const processIds: number[] = [];
    if (!dryRun && listId) {
      await supabaseAdmin.from("brevo_settings").update(target === "test" ? { test_list_id: listId } : { live_list_id: listId }).eq("id", 1);
      for (let i = 0; i < importRows.length; i += IMPORT_CHUNK) {
        const r = await brevo<{ processId: number }>("POST", "/contacts/import", {
          jsonBody: importRows.slice(i, i + IMPORT_CHUNK),
          listIds: [listId],
          updateExistingContacts: true,
          emptyContactsAttributes: false,
          disableNotification: true,
        });
        processIds.push(r.processId);
      }
      for (const email of blockTargets) {
        await brevo("POST", "/contacts", { email, emailBlacklisted: true, updateEnabled: true });
      }
      await supabaseAdmin
        .from("brevo_settings")
        .update({ last_sync_at: new Date().toISOString(), last_sync_count: importRows.length, last_sync_error: null })
        .eq("id", 1);
    }

    return {
      target,
      dryRun,
      listId,
      listName: LIST_NAME[target],
      eligible: importRows.length,
      skipped,
      blocklisted: dryRun ? 0 : blockTargets.length,
      attributesCreated,
      processIds,
      sample: importRows.slice(0, 5),
    };
  } catch (e) {
    if (!dryRun) {
      await supabaseAdmin
        .from("brevo_settings")
        .update({ last_sync_at: new Date().toISOString(), last_sync_error: e instanceof Error ? e.message : String(e) })
        .eq("id", 1);
    }
    throw e;
  }
}
