import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyEmail, scoreConfidence } from '@/lib/leads/mx';
import { classifyEmail } from '@/lib/leads/scraper';
import { markPrimaryContact } from '@/lib/leads/engine';

// Manually add a contact email to a lead (e.g. found on LinkedIn or a
// JS-rendered site the crawler couldn't read).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, domain, status')
    .eq('id', id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  const verifyStatus = await verifyEmail(email);
  if (verifyStatus === 'syntax_fail') {
    return NextResponse.json({ error: 'invalid email syntax' }, { status: 400 });
  }

  const { kind, roleHint } = classifyEmail(email);
  const { error } = await supabaseAdmin.from('lead_contacts').upsert(
    {
      lead_id: id,
      email,
      source: 'manual',
      source_url: null,
      kind,
      role_hint: roleHint,
      verify_status: verifyStatus,
      confidence: scoreConfidence(email, verifyStatus, lead.domain),
      is_primary: false,
    },
    { onConflict: 'lead_id,email' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await markPrimaryContact(id);

  if (verifyStatus === 'mx_ok' && ['no_contacts', 'new'].includes(lead.status)) {
    await supabaseAdmin
      .from('leads')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', id);
  }

  return NextResponse.json({ ok: true, verifyStatus });
}
