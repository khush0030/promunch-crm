// Small DB helpers for the B2B one-path flow, so code written for migration
// 20261010110000_b2b_one_path.sql degrades gracefully before it is applied.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { LEAD_STATUSES } from './lead-status';

export { isMissingSchema } from './schema-errors';

/** Lead counts by status in ONE query (RPC), falling back to per-status counts. */
export async function leadStatusCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin.rpc('b2b_lead_status_counts');
  if (!error && data && typeof data === 'object') {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = Number(v) || 0;
    return out;
  }
  const counts: Record<string, number> = {};
  await Promise.all(
    LEAD_STATUSES.map(async (s) => {
      const { count } = await supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('status', s);
      if (count) counts[s] = count;
    }),
  );
  return counts;
}

export type ListCountRow = { list_id: string; status: string; unreachable: number; n: number };

/** Per-list counts by lead status (RPC), falling back to a member scan. */
export async function listStatusCounts(listIds: string[] | null): Promise<ListCountRow[]> {
  if (listIds && !listIds.length) return [];
  const { data, error } = await supabaseAdmin.rpc('b2b_list_status_counts', { p_list_ids: listIds });
  if (!error && Array.isArray(data)) {
    return (data as ListCountRow[]).map((r) => ({ ...r, n: Number(r.n) || 0, unreachable: Number(r.unreachable) || 0 }));
  }
  let q = supabaseAdmin.from('lead_list_members').select('list_id, leads(status, error)').limit(20000);
  if (listIds) q = q.in('list_id', listIds);
  const { data: members } = await q;
  const agg = new Map<string, ListCountRow>();
  for (const m of members ?? []) {
    const lead = m.leads as unknown as { status: string; error: string | null } | null;
    if (!lead) continue;
    const key = `${m.list_id}:${lead.status}`;
    const row = agg.get(key) ?? { list_id: m.list_id as string, status: lead.status, unreachable: 0, n: 0 };
    row.n++;
    if (lead.error === 'site unreachable') row.unreachable++;
    agg.set(key, row);
  }
  return [...agg.values()];
}

/** UTC instant of the current IST midnight (send cap day boundary). */
export function istDayStart(now = new Date()): Date {
  const istMs = now.getTime() + 5.5 * 3600_000;
  return new Date(Math.floor(istMs / 86_400_000) * 86_400_000 - 5.5 * 3600_000);
}

export async function countSentToday(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id', { count: 'exact', head: true })
    .gte('sent_at', istDayStart().toISOString());
  return count ?? 0;
}

/** Run async work over items with a fixed concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
