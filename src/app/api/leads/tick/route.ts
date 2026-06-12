import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { tick } from '@/lib/leads/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  const denied = await requireSession();
  if (denied) return denied;

  try {
    const summary = await tick();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
