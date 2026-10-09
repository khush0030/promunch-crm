import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { getCaller } from '@/lib/rbac-server';
import { isAdminUser } from '@/lib/rbac';
import { parseBody } from '@/lib/api-helpers';
import { recordAudit } from '@/lib/audit';
import { enrichLead, queueRecheck } from '@/lib/leads/engine';
import { BuyerFinderConfigError, findDecisionMakersForLead, type DecisionCategory } from '@/lib/leads/finders';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { mapLimit } from '@/lib/leads/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PAID_ROLES: DecisionCategory[] = ['hr', 'buyer'];
const MAX_PAID = 20;

// "Find more emails" for one business or a selection.
//   step "website": one business -> re-check its website now; several -> queue
//                   them for the server tick (the tab can be closed).
//   step "paid":    admin only, after a credit-cost confirm in the UI: the
//                   pay-as-you-go finder, for businesses still without email.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await parseBody<{ lead_ids?: unknown; step?: unknown }>(req);
  const ids = Array.isArray(body?.lead_ids) ? [...new Set(body.lead_ids.map(String).filter(Boolean))] : [];
  if (!ids.length) return NextResponse.json({ error: 'Pick at least one business.' }, { status: 400 });
  const step = body?.step === 'paid' ? 'paid' : 'website';

  if (step === 'website') {
    if (ids.length === 1) {
      try {
        const r = await enrichLead(ids[0]);
        return NextResponse.json({ ok: true, mode: 'now', found: r.newUsable, contacts: r.contactsFound });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('no website')) return NextResponse.json({ ok: true, mode: 'now', found: 0, noWebsite: true });
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }
    const r = await queueRecheck(ids.slice(0, 500));
    return NextResponse.json({ ok: true, mode: 'queued', ...r });
  }

  // Paid finder: admin only, bounded.
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminUser(caller)) return NextResponse.json({ error: 'Only an admin can use the paid email finder.' }, { status: 403 });
  if (ids.length > MAX_PAID) return NextResponse.json({ error: `At most ${MAX_PAID} businesses per paid lookup.` }, { status: 400 });

  // Only businesses still without a usable email.
  const { data: leads } = await supabaseAdmin.from('leads').select('id, status').in('id', ids);
  const targets = (leads ?? [])
    .filter((l) => ['listed', 'no_contacts', 'no_website', 'new'].includes(l.status as string))
    .map((l) => l.id as string);

  let found = 0;
  let credits = 0;
  let stopped: string | null = null;
  try {
    await mapLimit(targets, 2, async (id) => {
      if (stopped) return;
      const r = await findDecisionMakersForLead(id, PAID_ROLES);
      credits += r.creditsCharged;
      if (r.outcomes.some((o) => o.outcome === 'saved')) found++;
      if (r.stopped && /cap|credits|key|auth/i.test(r.stopped)) stopped = r.stopped;
    });
  } catch (e) {
    if (e instanceof BuyerFinderConfigError) return NextResponse.json({ error: e.message }, { status: 409 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  recordAudit({
    action: 'leads.find_emails_paid',
    entityType: 'lead',
    entityId: targets[0] ?? null,
    summary: `Paid email finder for ${targets.length} businesses: ${found} found, ${credits} credits`,
    metadata: { lead_ids: targets, stopped },
    actor: caller,
    request: req,
  });
  return NextResponse.json({ ok: true, mode: 'paid', looked: targets.length, found, credits, stopped });
}
