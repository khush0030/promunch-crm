import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Score a collab thread + draft barter terms. Proxies to the ig-analyze edge
// function (which holds the Instagram + OpenAI credentials and runs Business
// Discovery + the AI draft server-side).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ig-analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: id }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
