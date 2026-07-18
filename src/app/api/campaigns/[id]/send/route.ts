import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sendBatchEmails, DEFAULT_FROM } from '@/lib/resend';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get campaign
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (campaign.status === 'sent') {
    return NextResponse.json({ error: 'Campaign already sent' }, { status: 400 });
  }

  if (!campaign.subject || !campaign.body_html) {
    return NextResponse.json({ error: 'Campaign must have subject and body_html before sending' }, { status: 400 });
  }

  // Atomic claim: exactly one caller may move the campaign into 'sending'
  // (AGENTS.md §4.1 — a double-click or concurrent POST must never double-
  // blast the audience). 'paused' is claimable because this route parks
  // failed runs as paused and re-POSTing is the resume path; the per-
  // recipient dedupe below keeps a resume from emailing anyone twice.
  const { data: claimed, error: claimError } = await supabase
    .from('campaigns')
    .update({ status: 'sending' })
    .eq('id', id)
    .in('status', ['draft', 'scheduled', 'paused'])
    .select('id');

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'campaign already sending or sent' }, { status: 409 });
  }

  // Build contact query based on segment_filter. Phone-only contacts (HYPD /
  // guest buyers, migration 007) have no email — they are WhatsApp-reachable
  // only and must never enter an email send.
  let contactQuery = supabase
    .from('contacts')
    .select('id, email, first_name, last_name')
    .eq('status', 'active')
    .not('email', 'is', null);

  if (campaign.segment_filter) {
    const filter = campaign.segment_filter as Record<string, unknown>;

    if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
      contactQuery = contactQuery.overlaps('tags', filter.tags as string[]);
    }

    if (filter.status) {
      contactQuery = contactQuery.eq('status', filter.status as string);
    }

    if (filter.min_orders) {
      contactQuery = contactQuery.gte('total_orders', filter.min_orders as number);
    }

    if (filter.min_spent) {
      contactQuery = contactQuery.gte('total_spent', filter.min_spent as number);
    }
  }

  const { data: contacts, error: contactsError } = await contactQuery;

  if (contactsError) {
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', id);
    return NextResponse.json({ error: contactsError.message }, { status: 500 });
  }

  if (!contacts || contacts.length === 0) {
    await supabase.from('campaigns').update({ status: 'draft' }).eq('id', id);
    return NextResponse.json({ error: 'No contacts match the segment filter' }, { status: 400 });
  }

  // Resume dedupe: a prior (paused/failed) attempt may already have created
  // campaign_emails rows — and possibly delivered them. One row per recipient
  // is the claim; never insert (or send) a second one (AGENTS.md §4.1: a
  // missed email is recoverable, a duplicate reads as spam).
  const { data: priorEmails, error: priorError } = await supabase
    .from('campaign_emails')
    .select('contact_id')
    .eq('campaign_id', id);

  if (priorError) {
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', id);
    return NextResponse.json({ error: priorError.message }, { status: 500 });
  }

  const alreadyClaimed = new Set((priorEmails ?? []).map((r) => r.contact_id));
  const recipients = contacts.filter((c) => !alreadyClaimed.has(c.id));

  if (recipients.length === 0) {
    // Every matching contact was already claimed by a previous attempt.
    // Re-sending would risk duplicates; park for manual review instead.
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', id);
    return NextResponse.json(
      { error: 'all recipients were already claimed by a previous send attempt' },
      { status: 409 },
    );
  }

  // Create campaign_email records (new recipients only)
  const campaignEmailRecords = recipients.map((contact) => ({
    campaign_id: id,
    contact_id: contact.id,
    status: 'queued',
  }));

  const { data: campaignEmails, error: insertError } = await supabase
    .from('campaign_emails')
    .insert(campaignEmailRecords)
    .select('id, contact_id');

  if (insertError) {
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', id);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Build email list
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const emailsToSend = (campaignEmails || []).map((ce) => {
    const contact = contactMap.get(ce.contact_id);
    return {
      to: contact?.email || '',
      subject: campaign.subject,
      html: campaign.body_html,
      from: DEFAULT_FROM,
    };
  }).filter((e) => e.to);

  let totalSent = 0;
  let totalFailed = 0;

  try {
    const batchResults = await sendBatchEmails(emailsToSend);

    // Count successes (Resend batch returns array of results)
    for (const result of batchResults) {
      if (result.data) {
        totalSent += Array.isArray(result.data) ? result.data.length : 1;
      }
    }
    totalFailed = emailsToSend.length - totalSent;
  } catch (sendError) {
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', id);
    return NextResponse.json({
      error: 'Failed to send emails',
      details: sendError instanceof Error ? sendError.message : 'Unknown error',
    }, { status: 500 });
  }

  // Update campaign_email statuses to 'sent'
  if (campaignEmails && campaignEmails.length > 0) {
    await supabase
      .from('campaign_emails')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .in('id', campaignEmails.map((ce) => ce.id));
  }

  // Update campaign stats
  await supabase
    .from('campaigns')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      total_recipients: contacts.length,
      total_sent: totalSent,
    })
    .eq('id', id);

  return NextResponse.json({
    success: true,
    total_recipients: contacts.length,
    total_sent: totalSent,
    total_failed: totalFailed,
  });
}
