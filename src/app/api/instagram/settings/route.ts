import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const { data, error } = await supabaseAdmin.from('ig_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };

  if (typeof body.paused === 'boolean') patch.paused = body.paused;
  if (typeof body.auto_reply_enabled === 'boolean') patch.auto_reply_enabled = body.auto_reply_enabled;
  if (body.auto_reply_scope === 'routine_only' || body.auto_reply_scope === 'all') patch.auto_reply_scope = body.auto_reply_scope;
  if (typeof body.auto_reply_comments === 'boolean') patch.auto_reply_comments = body.auto_reply_comments;
  if (typeof body.escalate_to_slack === 'boolean') patch.escalate_to_slack = body.escalate_to_slack;
  if (Number.isFinite(body.min_followers)) patch.min_followers = Math.max(0, Math.floor(body.min_followers));
  if (Number.isFinite(body.max_followers)) patch.max_followers = Math.max(0, Math.floor(body.max_followers));
  if (typeof body.barter_terms === 'string') patch.barter_terms = body.barter_terms.slice(0, 2000);

  const { data, error } = await supabaseAdmin
    .from('ig_settings')
    .upsert(patch, { onConflict: 'id' })
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
