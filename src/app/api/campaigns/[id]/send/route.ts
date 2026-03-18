import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
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

  // Update status to sending
  await supabase
    .from('campaigns')
    .update({ status: 'sending' })
    .eq('id', id);

  // Build contact query based on segment_filter
  let contactQuery = supabase
    .from('contacts')
    .select('id, email, first_name, last_name')
    .eq('status', 'active');

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

  // Create campaign_email records
  const campaignEmailRecords = contacts.map((contact) => ({
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
