import { NextRequest, NextResponse } from 'next/server';
import { sendCampaign } from '@/lib/email/campaign-send';
import { requireAdmin } from '@/lib/rbac-server';

// The whole send pipeline (atomic claim, audience resolution, pagination,
// suppression filter, paced per-recipient send, resend_id capture, circuit
// breaker) lives in src/lib/email/campaign-send.ts so the scheduler cron shares
// it. This route is the legacy manual "Send now" trigger. Admin-only: Email
// Studio's /api/email-studio/campaigns/[id]/send is the employee path (it adds
// the Review checks, the test-send gate and approvals).
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const result = await sendCampaign(id);
  const { ok, status, ...rest } = result;
  return NextResponse.json(ok ? { success: true, ...rest } : { error: result.error, ...rest }, { status });
}
