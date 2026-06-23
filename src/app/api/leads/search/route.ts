import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Enqueue a discovery fan-out: one lead_searches row per category × city.
// The tick engine drains them one Places page (20 results) at a time.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { categories?: string[]; cities?: string[]; maxResults?: number; findEmails?: boolean }
    | null;
  const categories = (body?.categories ?? []).map((s) => s.trim()).filter(Boolean);
  const cities = (body?.cities ?? []).map((s) => s.trim()).filter(Boolean);
  if (!categories.length || !cities.length) {
    return NextResponse.json({ error: 'categories and cities are required' }, { status: 400 });
  }
  const combos = categories.length * cities.length;
  if (combos > 60) {
    return NextResponse.json({ error: 'too many combinations (max 60 per request)' }, { status: 400 });
  }

  const findEmails = body?.findEmails !== false; // default on
  // Overall target across every search; split evenly per category x city.
  // Places caps each search at 60, so per-search target is clamped to that.
  const rawTarget = Number(body?.maxResults);
  const totalTarget = Number.isFinite(rawTarget) && rawTarget > 0 ? Math.floor(rawTarget) : null;
  const perSearchMax = totalTarget ? Math.min(60, Math.max(1, Math.ceil(totalTarget / combos))) : null;

  const rows = categories.flatMap((category) =>
    cities.map((city) => ({
      category,
      city,
      query: `${category} in ${city}`,
      status: 'pending',
      max_results: perSearchMax,
      find_emails: findEmails,
      // Re-open a previously-finished search so a new target re-scrapes it.
      next_page_token: null,
      pages_fetched: 0,
      results_count: 0,
      error: null,
    })),
  );

  // Merge (not ignore) so re-running "Find" updates the target / email toggle
  // and re-queues the search; already-discovered leads dedupe by place_id.
  const { error } = await supabaseAdmin
    .from('lead_searches')
    .upsert(rows, { onConflict: 'category,city' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    enqueued: rows.length,
    perSearchMax,
    totalTarget: perSearchMax ? perSearchMax * combos : null,
    findEmails,
  });
}
