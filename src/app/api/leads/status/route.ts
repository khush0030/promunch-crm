import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { countSentToday, leadStatusCounts, listStatusCounts } from '@/lib/leads/db';

export const dynamic = 'force-dynamic';

// Cheap status for the B2B strip + live "finding" cards. The page polls this
// (every few seconds while a search runs); the server tick does the work, so
// nobody has to keep the tab open.
//   counts:   leads by status (one RPC)
//   searches: active or recently finished searches with live progress
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const recent = new Date(Date.now() - 6 * 3600_000).toISOString();
  const [counts, sentToday, { data: settings }, { data: searches }, { count: inFollowUps }] = await Promise.all([
    leadStatusCounts(),
    countSentToday(),
    supabaseAdmin.from('outreach_settings').select('*').eq('id', 1).maybeSingle(),
    supabaseAdmin
      .from('lead_searches')
      .select('id, category, city, status, results_count, max_results, error, list_id, created_at, updated_at')
      .or(`status.in.(pending,running),updated_at.gte.${recent}`)
      .order('created_at', { ascending: false })
      .limit(12),
    supabaseAdmin
      .from('sequence_enrollments')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active', 'sending']),
  ]);

  const listIds = (searches ?? []).map((s) => s.list_id as string | null).filter((x): x is string => !!x);
  const rows = await listStatusCounts(listIds);
  const byList = new Map<string, { total: number; checking: number; withEmail: number; noEmail: number; unreachable: number; noWebsite: number }>();
  for (const r of rows) {
    const p = byList.get(r.list_id) ?? { total: 0, checking: 0, withEmail: 0, noEmail: 0, unreachable: 0, noWebsite: 0 };
    p.total += r.n;
    if (r.status === 'new' || r.status === 'crawling') p.checking += r.n;
    else if (['no_contacts', 'no_website', 'listed'].includes(r.status)) p.noEmail += r.n;
    else if (!['suppressed', 'skipped'].includes(r.status)) p.withEmail += r.n;
    if (r.status === 'no_website') p.noWebsite += r.n;
    p.unreachable += r.unreachable;
    byList.set(r.list_id, p);
  }

  const out = (searches ?? []).map((s) => {
    const p = (s.list_id && byList.get(s.list_id as string)) || { total: 0, checking: 0, withEmail: 0, noEmail: 0, unreachable: 0, noWebsite: 0 };
    const active = s.status === 'pending' || s.status === 'running' || p.checking > 0;
    return {
      id: s.id,
      category: s.category,
      city: s.city,
      status: s.status,
      error: s.error,
      list_id: s.list_id,
      created_at: s.created_at,
      active,
      found: p.total,
      checked: p.total - p.checking,
      withEmail: p.withEmail,
      noEmail: p.noEmail,
      unreachable: p.unreachable,
      noWebsite: p.noWebsite,
    };
  });

  return NextResponse.json({
    counts,
    sentToday,
    inFollowUps: inFollowUps ?? 0,
    settings: settings ?? null,
    searches: out,
  });
}
