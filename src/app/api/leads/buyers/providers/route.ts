import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { requireSecretsOwner } from '@/lib/secrets';
import { parseBody } from '@/lib/api-helpers';
import { recordAudit } from '@/lib/audit';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Provider on/off + monthly credit cap for the Buyer Finder. Reading is any
// signed-in staff; changing the cap or switching a provider on spends money,
// so writes are owner-only (same gate as Settings -> API keys).

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const { data: providers, error } = await supabaseAdmin
    .from('finder_providers')
    .select('provider, kind, enabled, priority, monthly_credit_cap')
    .order('priority');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data: events } = await supabaseAdmin
    .from('provider_usage_events')
    .select('provider, status, credits_reserved, credits_charged')
    .gte('created_at', monthStart.toISOString())
    .in('status', ['reserved', 'ok', 'uncertain', 'risky', 'not_found']);
  const used: Record<string, number> = {};
  for (const e of events ?? []) {
    used[e.provider as string] = (used[e.provider as string] ?? 0) + ((e.credits_charged as number | null) ?? (e.credits_reserved as number));
  }

  return NextResponse.json({ providers: (providers ?? []).map((p) => ({ ...p, used_this_month: used[p.provider as string] ?? 0 })) });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  const body = await parseBody<{ provider?: string; enabled?: boolean; monthly_credit_cap?: number }>(req);
  if (!body?.provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (body.monthly_credit_cap !== undefined) {
    const cap = body.monthly_credit_cap;
    if (!Number.isInteger(cap) || cap < 0 || cap > 100000) {
      return NextResponse.json({ error: 'monthly_credit_cap must be a whole number between 0 and 100000' }, { status: 400 });
    }
    patch.monthly_credit_cap = cap;
  }

  const { data, error } = await supabaseAdmin
    .from('finder_providers')
    .update(patch)
    .eq('provider', body.provider)
    .select('provider, enabled, monthly_credit_cap')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });

  recordAudit({
    action: 'leads.finder_provider_update',
    entityType: 'finder_provider',
    entityId: body.provider,
    summary: `enabled=${data.enabled} cap=${data.monthly_credit_cap}`,
    actor: gate.user,
    request: req,
  });
  return NextResponse.json({ ok: true, provider: data });
}
