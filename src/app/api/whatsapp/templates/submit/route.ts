import { NextRequest, NextResponse } from "next/server";

// Submit a template to Meta for approval (via the wa-template-create edge
// function). Meta — not this dashboard — owns the template's real status;
// the function mirrors that status back into wa_templates.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  const template = await req.json();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-template-create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ template }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
