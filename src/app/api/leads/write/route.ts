import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { getCaller } from '@/lib/rbac-server';
import { parseBody } from '@/lib/api-helpers';
import { MAX_WRITE_BATCH, writeEmails } from '@/lib/leads/write';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// "Write emails for N": AI (grounded in the Master KB) or a saved email, ONLY
// for the businesses the person ticked. Creates a batch whose drafts wait in
// Approve. Optional follow-ups ride the batch. Nothing is sent from here.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await parseBody<{
    lead_ids?: unknown;
    list_id?: unknown;
    template_id?: unknown;
    follow_up_count?: unknown;
    follow_up_days?: unknown;
  }>(req);
  const leadIds = Array.isArray(body?.lead_ids) ? body.lead_ids.map(String).filter(Boolean) : [];
  if (!leadIds.length) return NextResponse.json({ error: 'Tick at least one business.' }, { status: 400 });
  if (leadIds.length > MAX_WRITE_BATCH) {
    return NextResponse.json({ error: `At most ${MAX_WRITE_BATCH} at a time.` }, { status: 400 });
  }

  try {
    const caller = await getCaller();
    const result = await writeEmails(leadIds, {
      listId: typeof body?.list_id === 'string' ? body.list_id : null,
      templateId: typeof body?.template_id === 'string' && body.template_id ? body.template_id : null,
      followUpCount: Number(body?.follow_up_count) || 0,
      followUpDays: Number(body?.follow_up_days) || 4,
      createdBy: caller?.email ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg.includes('paused') ? 409 : 500 });
  }
}
