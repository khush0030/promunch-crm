import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAllowedEmail } from "@/lib/auth-domains";

// Manual trigger: sync the Shopify product catalog into wa_catalog_items (the
// WhatsApp in-chat ordering mirror). Invokes the shopify-catalog-sync edge
// function with the service key. Mirrors /api/amazon's sync-now shape.

export const dynamic = "force-dynamic";

// Self-guard: middleware does NOT gate /api/*, so verify an allowed, logged-in
// user before triggering anything.
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

export async function POST() {
  if (!(await authed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return NextResponse.json({ ok: false, error: "Supabase env not configured" }, { status: 500 });
  }
  const target = `${base}/functions/v1/shopify-catalog-sync`;
  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(
      { ok: r.ok && data?.ok !== false, ...data },
      { status: r.ok ? 200 : 502 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "trigger failed" },
      { status: 502 },
    );
  }
}
