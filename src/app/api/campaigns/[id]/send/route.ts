import { NextRequest, NextResponse } from 'next/server';
import { sendCampaign } from '@/lib/email/campaign-send';

// The whole send pipeline (atomic claim, audience resolution, pagination,
// suppression filter, paced per-recipient send, resend_id capture, circuit
// breaker) lives in src/lib/email/campaign-send.ts so the scheduler cron shares
// it. This route is the manual "Send now" trigger.
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await sendCampaign(id);
  const { ok, status, ...rest } = result;
  return NextResponse.json(ok ? { success: true, ...rest } : { error: result.error, ...rest }, { status });
}
