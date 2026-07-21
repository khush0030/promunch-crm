import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Start an influencer discovery run (Apify search/hashtag scrape) or a manual
// handle enrich. Proxies to the ig-discovery edge function, which holds the
// Apify token and enforces the daily budget. Results import asynchronously via
// ig-discovery-tick — poll GET for run status.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const payload: Record<string, unknown> = { started_by: user?.email ?? null };
  if (body.action === 'enrich') {
    payload.action = 'enrich';
    payload.handles = Array.isArray(body.handles) ? body.handles.slice(0, 200) : [];
  } else if (body.action === 'reels') {
    payload.action = 'reels';
    payload.prospect_id = body.prospect_id;
  } else {
    payload.action = 'start';
    payload.kind = body.kind === 'hashtag' ? 'hashtag' : 'search';
    payload.query = (body.query ?? '').toString();
    payload.max_items = Number(body.max_items) || 30;
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ig-discovery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

// Recent discovery runs (for the status strip in the Discovery tab).
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const { data: runs, error } = await supabaseAdmin
    .from('ig_discovery_runs')
    .select('id, kind, query, status, items_count, usage_usd, error, created_at, finished_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: runs ?? [] });
}
