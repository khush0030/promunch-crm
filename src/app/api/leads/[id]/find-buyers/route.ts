import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/rbac-server';
import { parseBody } from '@/lib/api-helpers';
import { recordAudit } from '@/lib/audit';
import {
  BuyerFinderConfigError,
  MAX_CATEGORIES_PER_RUN,
  findDecisionMakersForLead,
  isDecisionCategory,
  type DecisionCategory,
} from '@/lib/leads/finders';

export const maxDuration = 120;

const DEFAULT_CATEGORIES: DecisionCategory[] = ['hr', 'buyer'];

// Find verified decision-maker emails for one lead through the enabled
// pay-as-you-go provider. Spends the owner's credits, so it is admin-only,
// audited, and bounded by the monthly cap + a per-call credit limit.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const body = await parseBody<{ categories?: unknown }>(req);
  const raw = Array.isArray(body?.categories) ? body.categories : DEFAULT_CATEGORIES;
  const categories = raw.filter(isDecisionCategory);
  if (!categories.length) return NextResponse.json({ error: 'no valid categories' }, { status: 400 });
  if (new Set(categories).size > MAX_CATEGORIES_PER_RUN) {
    return NextResponse.json({ error: `at most ${MAX_CATEGORIES_PER_RUN} roles per lookup` }, { status: 400 });
  }

  try {
    const result = await findDecisionMakersForLead(id, categories);
    recordAudit({
      action: 'leads.find_buyers',
      entityType: 'lead',
      entityId: id,
      summary: `Decision-maker lookup via ${result.providers.join(' > ')}: ${JSON.stringify(result.creditsByProvider)} credits`,
      metadata: { categories, outcomes: result.outcomes.map((o) => `${o.category}:${o.outcome}${o.provider ? '@' + o.provider : ''}`), stopped: result.stopped },
      actor: gate.user,
      request: req,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof BuyerFinderConfigError) return NextResponse.json({ error: e.message }, { status: 409 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg === 'lead not found' ? 404 : 500 });
  }
}
