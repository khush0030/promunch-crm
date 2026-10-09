import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  ORDER_AFTER_CALL_MS, VOICE_PERIOD_HOURS, parseVoicePeriod, summarizeVoice, type SummaryCall, type SummaryOrder,
} from "@/lib/voice-summary";

// Read-only KPI totals for Orders → Voice calls (?period=24h|7d|30d).
// Session-gated by the middleware; mapped to the Inbox area through the
// /api/whatsapp/voice-calls prefix in src/lib/access.ts (same as the list).

export const dynamic = "force-dynamic";

const PAGE = 1000;
const MAX_ROWS = 10_000;

export async function GET(req: NextRequest) {
  const period = parseVoicePeriod(req.nextUrl.searchParams.get("period"));
  const since = new Date(Date.now() - VOICE_PERIOD_HOURS[period] * 3_600_000).toISOString();

  const calls: SummaryCall[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("voice_calls")
      .select("purpose, status, outcome, wa_id, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    calls.push(...((data ?? []) as SummaryCall[]));
    if ((data ?? []).length < PAGE) break;
  }

  // Orders on the numbers we called about carts, from the window start on.
  const cartPhones = [...new Set(calls.filter((c) => c.purpose === "cart").map((c) => c.wa_id).filter(Boolean))];
  const orders: SummaryOrder[] = [];
  for (let i = 0; i < cartPhones.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("shopify_orders")
      .select("customer_phone, shopify_created_at, total_price")
      .in("customer_phone", cartPhones.slice(i, i + 200))
      .gte("shopify_created_at", since)
      .lte("shopify_created_at", new Date(Date.now() + ORDER_AFTER_CALL_MS).toISOString())
      .limit(PAGE);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    orders.push(...((data ?? []) as SummaryOrder[]));
  }

  return NextResponse.json({ period, since, truncated: calls.length >= MAX_ROWS, summary: summarizeVoice(calls, orders) });
}
