import { NextRequest, NextResponse } from 'next/server';
import { verifySvix } from '@/lib/webhook-verify';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

type ResendWebhookEvent = {
  type: string;
  data: {
    email_id?: string;
    to?: string[];
    from?: string;
    subject?: string;
    created_at?: string;
    [key: string]: unknown;
  };
};

const EVENT_TO_STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'bounced',
};

const EVENT_TO_TYPE: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'bounced',
};


export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifySvix({ secret: process.env.RESEND_WEBHOOK_SECRET, svixId: request.headers.get('svix-id'), svixTs: request.headers.get('svix-timestamp'), svixSig: request.headers.get('svix-signature'), rawBody })) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: ResendWebhookEvent;
  try {
    body = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
  }

  const { type, data } = body;

  if (!type || !data) {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
  }

  const status = EVENT_TO_STATUS[type];
  const eventType = EVENT_TO_TYPE[type];

  if (!status || !eventType) {
    // Unhandled event type — just acknowledge
    return NextResponse.json({ received: true });
  }

  const resendEmailId = data.email_id;

  if (!resendEmailId) {
    return NextResponse.json({ received: true });
  }

  // Find the campaign email by resend_id
  const { data: campaignEmail } = await supabase
    .from('campaign_emails')
    .select('id, contact_id, campaign_id')
    .eq('resend_id', resendEmailId)
    .single();

  if (campaignEmail) {
    const updateFields: Record<string, unknown> = { status };

    if (type === 'email.opened') {
      updateFields.opened_at = new Date().toISOString();
    } else if (type === 'email.clicked') {
      updateFields.clicked_at = new Date().toISOString();
    }

    // Update campaign_email status
    await supabase
      .from('campaign_emails')
      .update(updateFields)
      .eq('id', campaignEmail.id);

    // Create email_event record
    await supabase.from('email_events').insert({
      campaign_email_id: campaignEmail.id,
      contact_id: campaignEmail.contact_id,
      event_type: eventType,
      metadata: data,
    });

    // Update campaign aggregate stats
    if (campaignEmail.campaign_id) {
      const statField: Record<string, string> = {
        'email.delivered': 'total_delivered',
        'email.opened': 'total_opened',
        'email.clicked': 'total_clicked',
        'email.bounced': 'total_bounced',
        'email.complained': 'total_unsubscribed',
      };

      const field = statField[type];
      if (field) {
        const { data: campaign } = await supabase
          .from('campaigns')
          .select(field)
          .eq('id', campaignEmail.campaign_id)
          .single();

        if (campaign) {
          const rawCampaign = campaign as unknown as Record<string, unknown>;
          const currentVal = rawCampaign[field];
          const newVal = (typeof currentVal === 'number' ? currentVal : 0) + 1;
          await supabase
            .from('campaigns')
            .update({ [field]: newVal })
            .eq('id', campaignEmail.campaign_id);
        }
      }
    }

    // Handle unsubscribe — update contact status
    if (type === 'email.complained') {
      await supabase
        .from('contacts')
        .update({ status: 'unsubscribed' })
        .eq('id', campaignEmail.contact_id);
    } else if (type === 'email.bounced') {
      await supabase
        .from('contacts')
        .update({ status: 'bounced' })
        .eq('id', campaignEmail.contact_id);
    }

    return NextResponse.json({ received: true });
  }

  // Not a campaign email — check the B2B outreach pipeline.
  await handleOutreachEvent(type, resendEmailId, data);

  return NextResponse.json({ received: true });
}

// B2B lead-gen outreach: record the event; bounces/complaints auto-suppress the
// recipient so the pipeline never writes to them again.
async function handleOutreachEvent(
  type: string,
  resendEmailId: string,
  data: ResendWebhookEvent['data'],
) {
  const { data: draft } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id, lead_id, contact_id, subject, status')
    .eq('resend_email_id', resendEmailId)
    .maybeSingle();
  if (!draft) return;

  const eventTypeMap: Record<string, string> = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
  };
  const eventType = eventTypeMap[type];
  if (!eventType) return;

  await supabaseAdmin.from('outreach_events').insert({
    draft_id: draft.id,
    lead_id: draft.lead_id,
    resend_email_id: resendEmailId,
    type: eventType,
    payload: data,
  });

  if (type !== 'email.bounced' && type !== 'email.complained') return;

  const reason = type === 'email.bounced' ? 'bounce' : 'complaint';

  const { data: contact } = await supabaseAdmin
    .from('lead_contacts')
    .select('email')
    .eq('id', draft.contact_id)
    .maybeSingle();

  if (contact) {
    await supabaseAdmin
      .from('suppressions')
      .upsert(
        { email: contact.email, reason, draft_id: draft.id },
        { onConflict: 'email', ignoreDuplicates: true },
      );
    await supabaseAdmin
      .from('lead_contacts')
      .update({ verify_status: 'mx_fail', confidence: 'low', is_primary: false })
      .eq('id', draft.contact_id);
  }

  await supabaseAdmin
    .from('outreach_drafts')
    .update({ status: 'bounced', updated_at: new Date().toISOString() })
    .eq('id', draft.id);
  await supabaseAdmin
    .from('leads')
    .update({ status: 'bounced', updated_at: new Date().toISOString() })
    .eq('id', draft.lead_id);

  await postSlack(
    [
      `:warning: *B2B Outreach ${reason === 'bounce' ? 'bounce' : 'COMPLAINT'}*`,
      `*Issue:* "${draft.subject}" to ${contact?.email ?? 'unknown'} ${reason === 'bounce' ? 'bounced' : 'was marked as spam'}.`,
      `*What happened:* Recipient auto-suppressed; the pipeline will never email them again.`,
      reason === 'complaint'
        ? '*What to do:* Complaints hurt the outreach domain. If these recur, pause sends and review the copy/targeting.'
        : '*Expected?:* Occasional bounces are normal for scraped role inboxes; watch the rate.',
    ].join('\n'),
  );
}

async function postSlack(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return;
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    });
  } catch {
    /* swallow — alerting must not fail the webhook */
  }
}
