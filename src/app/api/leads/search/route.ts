import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Enqueue a discovery fan-out: one lead_searches row per category × city.
// The tick engine drains them one Places page (20 results) at a time.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { categories?: string[]; cities?: string[] }
    | null;
  const categories = (body?.categories ?? []).map((s) => s.trim()).filter(Boolean);
  const cities = (body?.cities ?? []).map((s) => s.trim()).filter(Boolean);
  if (!categories.length || !cities.length) {
    return NextResponse.json({ error: 'categories and cities are required' }, { status: 400 });
  }
  if (categories.length * cities.length > 60) {
    return NextResponse.json({ error: 'too many combinations (max 60 per request)' }, { status: 400 });
  }

  const rows = categories.flatMap((category) =>
    cities.map((city) => ({
      category,
      city,
      query: `${category} in ${city}`,
      status: 'pending',
    })),
  );

  const { error } = await supabaseAdmin
    .from('lead_searches')
    .upsert(rows, { onConflict: 'category,city', ignoreDuplicates: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enqueued: rows.length });
}
