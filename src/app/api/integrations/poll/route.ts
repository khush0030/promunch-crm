import { NextResponse } from "next/server";

// Triggers the Supabase gmail-poll edge function on demand. The poll fetches
// unread mail AND retries any emails whose AI draft previously failed — so
// this is the "Run intake & retry now" button on the Integrations page.

export const dynamic = "force-dynamic";

export async function POST() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anon) {
    return NextResponse.json({ error: "Supabase env vars not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${base}/functions/v1/gmail-poll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${anon}`, apikey: anon },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: `gmail-poll returned ${res.status}`, detail: body },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, ...body });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "poll failed" },
      { status: 502 },
    );
  }
}
