import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Outreach analytics: headline rates (+ prior-period deltas), weekly
// sent/opened series, funnel, per-sequence and per-template report cards.
// All computed from outreach_drafts (sends) + outreach_events (Resend webhook
// delivered/opened/clicked/replied/bounced) — no extra tracking infra.

type DraftRow = {
  id: string;
  sent_at: string | null;
  status: string;
  enrollment_id: string | null;
  step_position: number | null;
};

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') ?? '30';
  const days = range === 'all' ? null : Math.max(1, parseInt(range) || 30);

  const now = Date.now();
  const since = days ? new Date(now - days * 86_400_000).toISOString() : null;
  const priorSince = days ? new Date(now - 2 * days * 86_400_000).toISOString() : null;

  // Current period drafts + events; prior period only needs counts for deltas.
  let draftQuery = supabaseAdmin
    .from('outreach_drafts')
    .select('id, sent_at, status, enrollment_id, step_position')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: true })
    .limit(10000);
  if (since) draftQuery = draftQuery.gte('sent_at', since);

  let eventQuery = supabaseAdmin
    .from('outreach_events')
    .select('draft_id, type, created_at')
    .limit(50000);
  if (since) eventQuery = eventQuery.gte('created_at', since);

  const [{ data: drafts, error }, { data: events }] = await Promise.all([draftQuery, eventQuery]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const draftRows = (drafts ?? []) as DraftRow[];
  const draftIds = new Set(draftRows.map((d) => d.id));

  // Unique event types per draft (5 opens on one email = 1 opened email).
  const byDraft = new Map<string, Set<string>>();
  for (const e of events ?? []) {
    if (!e.draft_id || !draftIds.has(e.draft_id)) continue;
    if (!byDraft.has(e.draft_id)) byDraft.set(e.draft_id, new Set());
    byDraft.get(e.draft_id)!.add(e.type);
  }

  const tally = (ids: Iterable<string>) => {
    const t = { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    for (const id of ids) {
      t.sent++;
      const types = byDraft.get(id);
      if (types?.has('delivered')) t.delivered++;
      if (types?.has('opened')) t.opened++;
      if (types?.has('clicked')) t.clicked++;
      if (types?.has('replied')) t.replied++;
      if (types?.has('bounced')) t.bounced++;
    }
    return t;
  };

  const headline = tally(draftRows.map((d) => d.id));

  // Prior-period deltas (only when a bounded range is selected).
  let prior: ReturnType<typeof tally> | null = null;
  if (since && priorSince) {
    const [{ data: priorDrafts }, { data: priorEvents }] = await Promise.all([
      supabaseAdmin
        .from('outreach_drafts')
        .select('id')
        .not('sent_at', 'is', null)
        .gte('sent_at', priorSince)
        .lt('sent_at', since)
        .limit(10000),
      supabaseAdmin
        .from('outreach_events')
        .select('draft_id, type')
        .gte('created_at', priorSince)
        .lt('created_at', since)
        .limit(50000),
    ]);
    const priorIds = new Set((priorDrafts ?? []).map((d) => d.id));
    for (const e of priorEvents ?? []) {
      if (!e.draft_id || !priorIds.has(e.draft_id)) continue;
      if (!byDraft.has(e.draft_id)) byDraft.set(e.draft_id, new Set());
      byDraft.get(e.draft_id)!.add(e.type);
    }
    prior = tally(priorIds);
  }

  // Weekly sent/opened series (ISO week buckets by send date).
  const weeks = new Map<string, { sent: number; opened: number }>();
  for (const d of draftRows) {
    if (!d.sent_at) continue;
    const dt = new Date(d.sent_at);
    // Bucket by the Monday of that week (IST-agnostic week label is fine here).
    const day = dt.getUTCDay() || 7;
    const monday = new Date(dt.getTime() - (day - 1) * 86_400_000);
    const key = monday.toISOString().slice(0, 10);
    const w = weeks.get(key) ?? { sent: 0, opened: 0 };
    w.sent++;
    if (byDraft.get(d.id)?.has('opened')) w.opened++;
    weeks.set(key, w);
  }
  const series = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => ({ week, ...w }));

  // Per-sequence + per-template report cards.
  const enrollmentIds = [...new Set(draftRows.map((d) => d.enrollment_id).filter((x): x is string => !!x))];
  const { data: enrollRows } = enrollmentIds.length
    ? await supabaseAdmin
        .from('sequence_enrollments')
        .select('id, sequence_id')
        .in('id', enrollmentIds)
    : { data: [] };
  const seqByEnrollment = new Map((enrollRows ?? []).map((e) => [e.id, e.sequence_id]));

  const [{ data: sequences }, { data: steps }] = await Promise.all([
    supabaseAdmin.from('email_sequences').select('id, name, status'),
    supabaseAdmin.from('email_sequence_steps').select('sequence_id, position, template_id, email_templates(name)'),
  ]);
  const stepTemplate = new Map<string, { id: string; name: string }>();
  for (const s of steps ?? []) {
    const t = s.email_templates as unknown as { name: string } | null;
    stepTemplate.set(`${s.sequence_id}:${s.position}`, { id: s.template_id, name: t?.name ?? '(missing)' });
  }

  const bySequence = new Map<string, string[]>();
  const byTemplate = new Map<string, { name: string; ids: string[] }>();
  for (const d of draftRows) {
    if (!d.enrollment_id || d.step_position == null) continue;
    const seqId = seqByEnrollment.get(d.enrollment_id);
    if (!seqId) continue;
    bySequence.set(seqId, [...(bySequence.get(seqId) ?? []), d.id]);
    const tpl = stepTemplate.get(`${seqId}:${d.step_position}`);
    if (tpl) {
      const cur = byTemplate.get(tpl.id) ?? { name: tpl.name, ids: [] };
      cur.ids.push(d.id);
      byTemplate.set(tpl.id, cur);
    }
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  const grade = (t: ReturnType<typeof tally>) => {
    // Reply rate first, opens second, bounces subtract.
    const score = pct(t.replied, t.sent) * 8 + pct(t.opened, t.sent) * 0.5 - pct(t.bounced, t.sent) * 4;
    return score >= 80 ? 'A' : score >= 55 ? 'B' : score >= 30 ? 'C' : score >= 15 ? 'D' : 'F';
  };

  const sequenceCards = (sequences ?? [])
    .map((s) => ({ ...s, tally: tally(bySequence.get(s.id) ?? []) }))
    .filter((s) => s.tally.sent > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      grade: grade(s.tally),
      ...s.tally,
      open_rate: pct(s.tally.opened, s.tally.sent),
      click_rate: pct(s.tally.clicked, s.tally.sent),
      reply_rate: pct(s.tally.replied, s.tally.sent),
      bounce_rate: pct(s.tally.bounced, s.tally.sent),
    }))
    .sort((a, b) => b.sent - a.sent);

  const templateCards = [...byTemplate.entries()]
    .map(([id, t]) => {
      const tt = tally(t.ids);
      return {
        id,
        name: t.name,
        sent: tt.sent,
        open_rate: pct(tt.opened, tt.sent),
        reply_rate: pct(tt.replied, tt.sent),
      };
    })
    .sort((a, b) => b.reply_rate - a.reply_rate);

  return NextResponse.json({
    range: days ?? 'all',
    headline: {
      ...headline,
      open_rate: pct(headline.opened, headline.sent),
      click_rate: pct(headline.clicked, headline.sent),
      reply_rate: pct(headline.replied, headline.sent),
      bounce_rate: pct(headline.bounced, headline.sent),
    },
    prior: prior
      ? {
          sent: prior.sent,
          open_rate: pct(prior.opened, prior.sent),
          click_rate: pct(prior.clicked, prior.sent),
          reply_rate: pct(prior.replied, prior.sent),
          bounce_rate: pct(prior.bounced, prior.sent),
        }
      : null,
    series,
    sequences: sequenceCards,
    templates: templateCards,
  });
}
