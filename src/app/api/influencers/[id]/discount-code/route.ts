import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, logEvent, requireUser } from "@/lib/influencers/db";
import { UUID_RE } from "@/lib/influencers/normalize";
import { createInfluencerDiscountCode, ShopifyDispatchError } from "@/lib/influencers/shopify-dispatch";

export const dynamic = "force-dynamic";

// POST /api/influencers/[id]/discount-code — the creator's personal code
// (MUNCH-<HANDLE6>10: 10% off, once per customer, no end date). Idempotent:
// returns influencers.discount_code when it is already set. A concurrent
// second call gets TAKEN from Shopify and adopts the same code (matched by
// this creator's discount title), so both calls end on one code.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("creator not found", 404);

  const { data: inf, error } = await supabaseAdmin.from("influencers").select("id, handle, discount_code").eq("id", id).maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!inf) return jsonError("creator not found", 404);
  if (inf.discount_code) return NextResponse.json({ ok: true, code: inf.discount_code, existing: true });

  let created;
  try {
    created = await createInfluencerDiscountCode(inf.handle);
  } catch (e) {
    const msg = e instanceof ShopifyDispatchError || e instanceof Error ? e.message : String(e);
    return jsonError(`Shopify discount failed: ${msg}`, 502);
  }

  const { data: saved, error: saveErr } = await supabaseAdmin
    .from("influencers")
    .update({ discount_code: created.code, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("discount_code", null)
    .select("discount_code")
    .maybeSingle();
  if (saveErr) return jsonError(`code ${created.code} created in Shopify but not saved: ${saveErr.message}`, 500);
  if (!saved) {
    const { data: again } = await supabaseAdmin.from("influencers").select("discount_code").eq("id", id).maybeSingle();
    return NextResponse.json({ ok: true, code: again?.discount_code ?? created.code, existing: true });
  }

  await logEvent(id, null, "note", "shopify", gate.actor, `Discount code ${created.code} created (10% off, once per customer)`, {
    discount_id: created.discount_id,
    adopted: created.adopted,
  });
  return NextResponse.json({ ok: true, code: created.code, existing: false });
}
