import { NextResponse } from "next/server";

// Pull every template from Meta and mirror its real status/body/category into
// wa_templates. Run this after Meta reviews a submission, or to import
// templates created directly in WhatsApp Manager.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-template-create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sync: true }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
