import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/resend';
import { parseBody } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  const body = await parseBody<{
    to?: string | string[];
    subject?: string;
    html?: string;
    from?: string;
  }>(request);
  if (!body) {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { to, subject, html, from } = body;

  if (!to || !subject || !html) {
    return NextResponse.json(
      { error: 'Missing required fields: to, subject, html' },
      { status: 400 }
    );
  }

  // Spoofing guard: only the verified sending domain may appear as the from
  // address. Accepts bare addresses and "Name <addr>" forms; omitting `from`
  // falls back to DEFAULT_FROM inside sendEmail.
  if (from !== undefined) {
    const addr = (String(from).match(/<([^>]+)>/)?.[1] ?? String(from)).trim().toLowerCase();
    if (!addr.endsWith('@trypromunch.in')) {
      return NextResponse.json(
        { error: 'from must be a @trypromunch.in address' },
        { status: 400 }
      );
    }
  }

  const result = await sendEmail({ to, subject, html, from });

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: result.data?.id });
}
