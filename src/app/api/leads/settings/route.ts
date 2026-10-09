import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isMissingSchema } from '@/lib/leads/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from('outreach_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof body.daily_cap === 'number' && body.daily_cap >= 0 && body.daily_cap <= 500) {
    updates.daily_cap = Math.floor(body.daily_cap);
  }
  if (typeof body.paused === 'boolean') updates.paused = body.paused;
  if (typeof body.from_name === 'string' && body.from_name.trim()) updates.from_name = body.from_name.trim();
  if (typeof body.from_email === 'string' && body.from_email.includes('@')) {
    updates.from_email = body.from_email.trim().toLowerCase();
  }
  if (typeof body.reply_to === 'string') updates.reply_to = body.reply_to.trim() || null;
  if (typeof body.footer_address === 'string' && body.footer_address.trim()) {
    updates.footer_address = body.footer_address.trim();
  }
  if (typeof body.follow_up_days === 'number' && body.follow_up_days >= 1 && body.follow_up_days <= 30) {
    updates.follow_up_days = Math.floor(body.follow_up_days);
  }
  if (typeof body.follow_up_count === 'number' && body.follow_up_count >= 0 && body.follow_up_count <= 2) {
    updates.follow_up_count = Math.floor(body.follow_up_count);
  }
  if (typeof body.follow_up_default_on === 'boolean') updates.follow_up_default_on = body.follow_up_default_on;
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'no valid fields' }, { status: 400 });
  }

  let { data, error } = await supabaseAdmin
    .from('outreach_settings')
    .update(updates)
    .eq('id', 1)
    .select('*')
    .single();
  if (error && isMissingSchema(error)) {
    // Follow-up defaults need migration 20261010110000; save the rest.
    delete updates.follow_up_days;
    delete updates.follow_up_count;
    delete updates.follow_up_default_on;
    if (!Object.keys(updates).length) return NextResponse.json({ error: 'Follow-up settings need the latest database update.' }, { status: 409 });
    ({ data, error } = await supabaseAdmin.from('outreach_settings').update(updates).eq('id', 1).select('*').single());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
