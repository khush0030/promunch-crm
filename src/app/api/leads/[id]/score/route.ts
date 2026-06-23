import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { rescoreLead } from '@/lib/leads/engine';

export const maxDuration = 30;

// Re-run the AI fit score for one lead on demand (dashboard "Re-score" action).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  try {
    const fit = await rescoreLead(id);
    return NextResponse.json({ ok: true, fit });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
