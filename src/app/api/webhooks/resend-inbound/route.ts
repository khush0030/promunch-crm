import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Resend INBOUND webhook — receives replies to our B2B cold emails, matches them
// to the lead by sender address, stores the reply, and flags the lead + its sent
// draft 'replied' so the dashboard "Replies" tab surfaces them. Point Resend's
// inbound route at /api/webhooks/resend-inbound.
//
// Inbound payload shapes vary across Resend's API, so we read the fields
// defensively from either a {type, data} envelope or a flat parsed-email object.

export const dynamic = 'force-dynamic';

// Soft Svix verification — only enforced when the secret AND signature headers
// are both present, so inbound keeps working before the secret is configured.
function verify(req: NextRequest, raw: string): boolean {
  const secret = process.env.RESEND_INBOUND_SECRET || process.env.RESEND_WEBHOOK_SECRET;
  const svixId = req.headers.get('svix-id');
  const svixTs = req.headers.get('svix-timestamp');
  const svixSig = req.headers.get('svix-signature');
  if (!secret || !svixId || !svixTs || !svixSig) return true;
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key).update(`${svixId}.${svixTs}.${raw}`).digest('base64');
    return svixSig.split(' ').some((p) => {
      const sig = p.split(',')[1];
      if (!sig) return false;
      const a = Buffer.from(sig), b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  } catch {
    return false;
  }
}

function extractEmail(v: unknown): { email: string; name: string | null } | null {
  if (!v) return null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.email === 'string') return { email: o.email.toLowerCase(), name: (o.name as string) ?? null };
    if (Array.isArray(v) && v[0]) return extractEmail(v[0]);
  }
  if (typeof v === 'string') {
    const m = v.match(/<([^>]+)>/);
    const email = (m ? m[1] : v).trim().toLowerCase();
    const name = m ? v.slice(0, v.indexOf('<')).trim().replace(/^"|"$/g, '') || null : null;
    return email.includes('@') ? { email, name } : null;
  }
  return null;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verify(req, raw)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  // Unwrap a {type, data} envelope if present; otherwise treat body as the email.
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
  const headers = (data.headers && typeof data.headers === 'object' ? data.headers : {}) as Record<string, unknown>;

  const from = extractEmail(pick(data, 'from', 'sender', 'from_email'));
  if (!from) return NextResponse.json({ received: true, note: 'no sender' });

  const subject = String(pick(data, 'subject') ?? '').slice(0, 500);
  const bodyText = String(pick(data, 'text', 'text_body', 'body_text', 'plain') ?? '').slice(0, 20000);
  const bodyHtml = String(pick(data, 'html', 'html_body', 'body_html') ?? '').slice(0, 50000) || null;
  const inboundId = String(pick(data, 'id', 'email_id', 'message_id', 'inbound_id') ?? '') || null;
  const inReplyTo = String(pick(headers, 'in-reply-to', 'In-Reply-To') ?? pick(data, 'in_reply_to') ?? '') || null;

  // Match the reply to a contact we emailed (sender = our lead's email).
  const { data: contact } = await supabaseAdmin
    .from('lead_contacts')
    .select('id, lead_id, email')
    .ilike('email', from.email)
    .maybeSingle();

  // Most recent sent/non-discarded draft for that lead, if any.
  let draftId: string | null = null;
  if (contact?.lead_id) {
    const { data: draft } = await supabaseAdmin
      .from('outreach_drafts')
      .select('id')
      .eq('lead_id', contact.lead_id)
      .in('status', ['sent', 'replied', 'bounced'])
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    draftId = draft?.id ?? null;
  }

  // Store the reply (idempotent on inbound id).
  const { error: insErr } = await supabaseAdmin
    .from('outreach_replies')
    .upsert(
      {
        lead_id: contact?.lead_id ?? null,
        draft_id: draftId,
        contact_id: contact?.id ?? null,
        from_email: from.email,
        from_name: from.name,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        resend_inbound_id: inboundId,
        in_reply_to: inReplyTo,
        raw: data,
      },
      { onConflict: 'resend_inbound_id', ignoreDuplicates: true },
    );
  if (insErr) {
    // Don't 500 the provider — log via Slack and acknowledge.
    await postSlack(`:warning: outreach reply insert failed for ${from.email}: ${insErr.message}`);
    return NextResponse.json({ received: true, stored: false });
  }

  if (contact?.lead_id) {
    if (draftId) {
      await supabaseAdmin
        .from('outreach_drafts')
        .update({ status: 'replied', updated_at: new Date().toISOString() })
        .eq('id', draftId);
    }
    await supabaseAdmin
      .from('leads')
      .update({ status: 'replied', updated_at: new Date().toISOString() })
      .eq('id', contact.lead_id);
    await supabaseAdmin.from('outreach_events').insert({
      draft_id: draftId,
      lead_id: contact.lead_id,
      type: 'replied',
      payload: { from: from.email, subject },
    });
  }

  const { data: lead } = contact?.lead_id
    ? await supabaseAdmin.from('leads').select('name').eq('id', contact.lead_id).maybeSingle()
    : { data: null };
  await postSlack(
    [
      `:envelope_with_arrow: *Reply to a cold email*`,
      `*From:* ${from.name ? `${from.name} ` : ''}<${from.email}>${lead?.name ? ` — ${lead.name}` : ' (no matching lead)'}`,
      `*Subject:* ${subject || '(none)'}`,
      bodyText ? `> ${bodyText.slice(0, 280).replace(/\n+/g, ' ')}` : '',
      contact?.lead_id ? `See it in /dashboard/leads → Replies.` : '',
    ].filter(Boolean).join('\n'),
  );

  return NextResponse.json({ received: true, stored: true, matched: !!contact?.lead_id });
}

async function postSlack(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return;
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    });
  } catch {
    /* alerting must not fail the webhook */
  }
}
