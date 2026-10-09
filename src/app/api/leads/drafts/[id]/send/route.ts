import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { sendFirstEmail } from '@/lib/leads/send';

export const maxDuration = 60;

// "Send now" for one first email a person has read (skips the paced queue).
// Same single send path as the tick: the atomic b2b_claim_send claim checks
// pause, the daily cap (in-flight sends count), suppression, closed leads and
// "already emailed this address / website" in one locked transaction, so a
// double click or a racing tick produces exactly one email.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const r = await sendFirstEmail(id, ['draft', 'approved', 'failed']);
  if (r.ok) return NextResponse.json({ ok: true, sentToday: r.used ?? null, cap: r.cap ?? null });
  const status =
    r.outcome === 'cap' ? 429 : r.outcome === 'send_failed' || r.outcome === 'error' ? 500 : 409;
  return NextResponse.json({ error: r.message, outcome: r.outcome }, { status });
}
