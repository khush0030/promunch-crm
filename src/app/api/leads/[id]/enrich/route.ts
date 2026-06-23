import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { enrichLead } from '@/lib/leads/engine';

export const maxDuration = 60;

// Re-crawl a lead's site to find/verify more contacts and re-score fit
// (dashboard "Enrich" action). Independent of the queue/claim flow.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  try {
    const result = await enrichLead(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
