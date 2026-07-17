import { NextResponse } from "next/server";
import { requireSession } from "@/lib/leads/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Scan inbox now" button → invokes the deal-scan edge function with the
// service-role bearer (it is gated by requireInternal). pg_cron runs the
// same function every 30 min; this is just the impatient path.
export async function POST() {
  const denied = await requireSession();
  if (denied) return denied;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase env not configured" }, { status: 500 });
  }

  try {
    const resp = await fetch(`${url}/functions/v1/deal-scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "dashboard" }),
      signal: AbortSignal.timeout(280_000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return NextResponse.json(
        { error: (data as { error?: string }).error || `deal-scan returned ${resp.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `deal-scan unreachable: ${msg}` }, { status: 502 });
  }
}
