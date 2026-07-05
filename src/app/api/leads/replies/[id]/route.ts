import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { recordAudit } from '@/lib/audit';

// Delete a reply (e.g. a simulated test reply). If it was the lead's last reply
// and the lead is flagged 'replied', revert the lead to a sensible prior status.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const { data: reply } = await supabaseAdmin
    .from('outreach_replies')
    .select('id, lead_id')
    .eq('id', id)
    .maybeSingle();
  if (!reply) return NextResponse.json({ error: 'reply not found' }, { status: 404 });

  await supabaseAdmin.from('outreach_replies').delete().eq('id', id);
  await recordAudit({
    action: "lead_reply.delete",
    entityType: "outreach_reply",
    entityId: id,
    summary: `Deleted outreach reply ${id}`,
    metadata: { lead_id: reply.lead_id },
  });

  const leadId = reply.lead_id as string | null;
  if (leadId) {
    const { count } = await supabaseAdmin
      .from('outreach_replies')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', leadId);
    if ((count ?? 0) === 0) {
      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('status')
        .eq('id', leadId)
        .maybeSingle();
      if (lead?.status === 'replied') {
        // Prefer the draft's own state to pick the revert target.
        const { data: draft } = await supabaseAdmin
          .from('outreach_drafts')
          .select('status, sent_at')
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const revert = draft?.sent_at ? 'contacted' : draft ? 'drafted' : 'ready';
        await supabaseAdmin
          .from('leads')
          .update({ status: revert, updated_at: new Date().toISOString() })
          .eq('id', leadId);
        if (draft && draft.status === 'replied') {
          await supabaseAdmin
            .from('outreach_drafts')
            .update({ status: draft.sent_at ? 'sent' : 'draft' })
            .eq('lead_id', leadId)
            .eq('status', 'replied');
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}
