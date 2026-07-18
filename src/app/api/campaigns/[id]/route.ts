import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { parseBody } from '@/lib/api-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // Get recipient count for this campaign
  const { count: emailCount } = await supabase
    .from('campaign_emails')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', id);

  return NextResponse.json({
    campaign: {
      ...campaign,
      email_count: emailCount || 0,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const allowedFields = [
    'name', 'subject', 'preview_text', 'body_html',
    'status', 'segment_filter', 'scheduled_at',
    'total_recipients', 'total_sent', 'total_delivered',
    'total_opened', 'total_clicked', 'total_bounced',
    'total_unsubscribed', 'revenue_attributed', 'sent_at',
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaign: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAudit({
    action: "campaign.delete",
    entityType: "campaign",
    entityId: id,
    summary: `Deleted campaign ${id}`,
    actor: gate.user,
    request,
  });

  return NextResponse.json({ success: true });
}
