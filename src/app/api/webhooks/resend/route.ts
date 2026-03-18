import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
  const body = await request.json() as ResendWebhookEvent;

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

    if (type === 'email.opened' && !campaignEmail) {
      updateFields.opened_at = new Date().toISOString();
    } else if (type === 'email.opened') {
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
  }

  return NextResponse.json({ received: true });
}
