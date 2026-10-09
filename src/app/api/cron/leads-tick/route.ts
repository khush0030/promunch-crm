import { NextRequest, NextResponse } from 'next/server';
import { tick } from '@/lib/leads/engine';

// The B2B pipeline driver. Supabase pg_cron job 'b2b-leads-tick' calls this
// every 2 minutes with the Vault cron_secret bearer (migration
// 20261010110000_b2b_one_path.sql; Vercel Hobby only allows daily crons, so it
// is not in vercel.json). Each run finds businesses for every active search,
// checks websites, sends approved emails paced inside the daily cap, and sends
// due follow-ups. Nobody has to keep the dashboard open.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 401 });
  {
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
