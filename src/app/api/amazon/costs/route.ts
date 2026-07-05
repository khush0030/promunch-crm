import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAllowedEmail } from "@/lib/auth-domains";

// Upserts our cost-of-goods per Amazon SKU (amazon_sku_costs) — the one number
// Amazon can't give us. Edited inline from the SKU economics table on
// /dashboard/amazon; joined into profit-per-unit there.

export const dynamic = "force-dynamic";

// Same self-guard as /api/amazon: middleware doesn't gate /api/*.
async function authed(): Promise<boolean> {
  const store = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return !!user && isAllowedEmail(user.email);
}

export async function POST(req: Request) {
  if (!(await authed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { seller_sku?: string; cost_per_unit?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const sku = (body.seller_sku ?? "").trim();
  const cost = Number(body.cost_per_unit);
  if (!sku || !Number.isFinite(cost) || cost < 0) {
    return NextResponse.json({ ok: false, error: "seller_sku and a non-negative cost_per_unit are required" }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from("amazon_sku_costs").upsert({
    seller_sku: sku,
    cost_per_unit: cost,
    note: body.note?.trim() || null,
  }, { onConflict: "seller_sku" });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
