import { NextRequest, NextResponse } from 'next/server';
import { tick } from '@/lib/leads/engine';

// Daily Vercel cron (Hobby plan allows daily only). The dashboard "Run pipeline"
// button (/api/leads/tick) is the primary driver; this keeps the queue draining
// even on days nobody opens the dashboard.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const summary = await tick();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
