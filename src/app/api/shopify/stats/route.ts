import { NextResponse } from "next/server";

// Proxies the shopify-stats edge function (revenue windows + live customer count)
// for the Shopify Attribution dashboard. Server→edge with the anon key, matching
// the other dashboard edge calls — keeps the call off the browser and avoids CORS.

export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anon) {
    return NextResponse.json({ ok: false, error: "Supabase env vars not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${base}/functions/v1/shopify-stats`, {
      method: "POST",
      headers: { Authorization: `Bearer ${anon}`, apikey: anon },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `shopify-stats returned ${res.status}`, detail: body },
        { status: 502 },
      );
    }
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "stats failed" },
      { status: 502 },
    );
  }
}
