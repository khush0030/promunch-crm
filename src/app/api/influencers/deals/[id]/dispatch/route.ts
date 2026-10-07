import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, logEvent, requireUser } from "@/lib/influencers/db";
import { UUID_RE } from "@/lib/influencers/normalize";
import {
  buildOpsDispatchMessage,
  createInfluencerOrder,
  ShopifyDispatchError,
  validateDispatchAddress,
} from "@/lib/influencers/shopify-dispatch";
import { upsertInfluencerContact } from "@/lib/influencers/crm-contact-server";
import type { DealStage, Influencer, InfluencerAddress, Kit } from "@/lib/influencers/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/influencers/deals/[id]/dispatch — ship the barter kit as a Shopify
// ₹0 order tagged "Influencer".
//
// NEVER SHIP TWICE. influencer_deals.shopify_order_id doubles as the dispatch
// lock, taken with a conditional UPDATE before Shopify is touched:
//   null                    free
//   "pending:<iso>"         lock held, no draft yet (stale after 5 min -> takeover)
//   "pending-draft:<gid>"   draft exists; a retry resumes THAT draft (one draft
//                           completes into at most one order)
//   anything else           the real order id -> 409
// A definite Shopify failure clears the lock; an ambiguous one (timeout) keeps
// it so a retry resumes rather than creating a second order.

const LOCK_STALE_MS = 5 * 60_000;
const PENDING = "pending:";
const PENDING_DRAFT = "pending-draft:";
const BEFORE_DISPATCH: DealStage[] = ["agreed", "brief_draft", "brief_sent", "brief_acknowledged"];
const CLOSED: DealStage[] = ["completed", "cancelled", "ghosted"];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("deal not found", 404);

  const { data: deal, error: dErr } = await supabaseAdmin.from("influencer_deals").select("*").eq("id", id).maybeSingle();
  if (dErr) return jsonError(dErr.message, 500);
  if (!deal) return jsonError("deal not found", 404);
  if (CLOSED.includes(deal.stage)) return jsonError(`deal is ${deal.stage}; cannot dispatch`, 409);

  const current: string | null = deal.shopify_order_id ?? null;
  if (current && !current.startsWith(PENDING) && !current.startsWith(PENDING_DRAFT)) {
    return NextResponse.json(
      { error: "kit already dispatched", order_id: current, order_name: deal.shopify_order_name, order_status_url: deal.order_status_url },
      { status: 409 },
    );
  }

  const [{ data: influencer }, { data: address }, { data: kit }] = await Promise.all([
    supabaseAdmin.from("influencers").select("*").eq("id", deal.influencer_id).maybeSingle(),
    supabaseAdmin.from("influencer_addresses").select("*").eq("influencer_id", deal.influencer_id).maybeSingle(),
    deal.kit_id
      ? supabaseAdmin.from("influencer_kits").select("*").eq("id", deal.kit_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!influencer) return jsonError("creator not found", 404);
  const inf = influencer as Influencer;
  if (!kit) return NextResponse.json({ error: "choose a kit before dispatching", missing: ["kit"] }, { status: 422 });
  const k = kit as Kit;
  if (!Array.isArray(k.items) || k.items.length === 0) {
    return NextResponse.json({ error: `kit "${k.name}" has no items`, missing: ["kit.items"] }, { status: 422 });
  }

  const check = validateDispatchAddress(address as InfluencerAddress | null, {
    name: inf.full_name ?? inf.handle,
    phone: inf.phone,
  });
  if (!check.ok) {
    return NextResponse.json({ error: `address incomplete: ${check.missing.join(", ")}`, missing: check.missing }, { status: 422 });
  }

  // ---- take the dispatch lock ----
  let lock: string;
  let resumeDraftId: string | null = null;
  if (current?.startsWith(PENDING_DRAFT)) {
    // Resume the recorded draft. Completing one draft twice cannot make two
    // orders, so concurrent resumes are safe without a fresh lock.
    lock = current;
    resumeDraftId = current.slice(PENDING_DRAFT.length);
  } else {
    if (current?.startsWith(PENDING)) {
      const age = Date.now() - Date.parse(current.slice(PENDING.length));
      if (!(age > LOCK_STALE_MS)) return jsonError("dispatch already in progress for this deal", 409);
    }
    lock = `${PENDING}${new Date().toISOString()}`;
    let q = supabaseAdmin.from("influencer_deals").update({ shopify_order_id: lock }).eq("id", id);
    q = current ? q.eq("shopify_order_id", current) : q.is("shopify_order_id", null);
    const { data: won, error: lockErr } = await q.select("id").maybeSingle();
    if (lockErr) return jsonError(lockErr.message, 500);
    if (!won) return jsonError("dispatch already in progress or done for this deal", 409);
  }

  // ---- create the order ----
  let result;
  try {
    result = await createInfluencerOrder({
      deal: { id: deal.id, code: deal.code },
      influencer: inf,
      address: address as InfluencerAddress,
      kit: k,
      resumeDraftId,
      onDraftCreated: async (draftId) => {
        const next = `${PENDING_DRAFT}${draftId}`;
        const { data: ok, error } = await supabaseAdmin
          .from("influencer_deals")
          .update({ shopify_order_id: next })
          .eq("id", id)
          .eq("shopify_order_id", lock)
          .select("id")
          .maybeSingle();
        if (error || !ok) throw new Error(error?.message ?? "dispatch lock lost");
        lock = next;
      },
    });
  } catch (e) {
    const err = e instanceof ShopifyDispatchError ? e : new ShopifyDispatchError(e instanceof Error ? e.message : String(e), true);
    if (!err.ambiguous) {
      await supabaseAdmin.from("influencer_deals").update({ shopify_order_id: null }).eq("id", id).eq("shopify_order_id", lock);
    }
    await logEvent(inf.id, id, "dispatch_failed", "shopify", gate.actor, `Shopify order failed: ${err.message}`.slice(0, 300), {
      ambiguous: err.ambiguous,
    });
    return NextResponse.json(
      {
        error: err.message,
        retryable: true,
        ...(err.ambiguous
          ? { note: "Shopify may still be creating the order. Retry in a minute: the retry resumes the same order and never creates a second one." }
          : {}),
      },
      { status: 502 },
    );
  }

  // ---- record it (only the writer that flips the lock logs + pings) ----
  const now = new Date().toISOString();
  const { data: recorded, error: recErr } = await supabaseAdmin
    .from("influencer_deals")
    .update({
      shopify_order_id: result.order_id,
      shopify_order_name: result.order_name,
      order_status_url: result.order_status_url,
      dispatched_at: deal.dispatched_at ?? now,
      updated_at: now,
    })
    .eq("id", id)
    .like("shopify_order_id", "pending%")
    .select("id")
    .maybeSingle();
  if (recErr) {
    // The order exists in Shopify; the lock still names its draft, so a retry adopts it.
    return jsonError(`order ${result.order_name} created but not saved (${recErr.message}); retry to record it`, 500);
  }
  const order = { order_id: result.order_id, order_name: result.order_name, order_status_url: result.order_status_url };
  if (!recorded) return NextResponse.json({ ok: true, already: true, ...order });

  let stageMoved = false;
  if (BEFORE_DISPATCH.includes(deal.stage)) {
    const { data: moved } = await supabaseAdmin
      .from("influencer_deals")
      .update({ stage: "dispatched", updated_at: now })
      .eq("id", id)
      .in("stage", BEFORE_DISPATCH)
      .select("id")
      .maybeSingle();
    stageMoved = !!moved;
  }

  // CRM: tag the creator's contact "influencer" + "creator" and store their
  // Instagram link (contacts.properties.instagram_url) now, ahead of the
  // Shopify order webhook (which applies the same merge). Same email/phone the
  // order carries, so both sides land on one row. Never blocks the dispatch.
  let crmContact: string;
  try {
    const c = await upsertInfluencerContact({
      handle: inf.handle,
      email: inf.email,
      phone: check.address.phone,
      fullName: inf.full_name ?? check.address.name,
    });
    crmContact = c.ok ? c.action : `failed: ${c.reason}`.slice(0, 200);
  } catch (e) {
    crmContact = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }

  const opsText = buildOpsDispatchMessage({
    handle: inf.handle,
    kitName: k.name,
    orderName: result.order_name,
    city: check.address.city,
    pincode: check.address.pincode,
  });
  const ops = await pingOps(opsText, inf, check.address.phone);

  await logEvent(inf.id, id, "dispatched", "shopify", gate.actor, `Kit "${k.name}" dispatched as Shopify order ${result.order_name}`, {
    ...order,
    draft_order_id: result.draft_order_id,
    kit_id: k.id,
    from_stage: deal.stage,
    to_stage: stageMoved ? "dispatched" : deal.stage,
    ops_ping: ops,
    crm_contact: crmContact,
  });

  return NextResponse.json({ ok: true, ...order, stage: stageMoved ? "dispatched" : deal.stage, ops_ping: ops });
}

// Internal FYI to ops (OPS_WA_ID) through wa-send with the approved
// ops_ticket_alert utility template, same var layout as the COD gate's ping.
// Slot 2 (ticket #) is "—" on purpose: the template says 'Reply "done {{2}}"'
// and an order number there could close an unrelated support ticket.
// Exactly-once comes from the caller: only the request that records the order
// reaches this. Never throws; never blocks the dispatch.
async function pingOps(text: string, inf: Influencer, phone: string): Promise<string> {
  const to = (process.env.OPS_WA_ID ?? "").replace(/\D/g, "");
  if (!to) return "skipped: OPS_WA_ID not set on the app";
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        kind: "template",
        sent_by: "influencer_dispatch_ops",
        template: {
          name: process.env.OPS_ALERT_TEMPLATE ?? "ops_ticket_alert",
          language: "en",
          vars: {
            "1": "Influencer kit to ship",
            "2": "—",
            "3": inf.full_name ? `${inf.full_name} (@${inf.handle})` : `@${inf.handle}`,
            "4": `+${phone}`,
            "5": text.slice(0, 300),
          },
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: unknown };
    return res.ok && data.ok !== false && !data.error ? "sent" : `failed: ${String(data.error ?? `HTTP ${res.status}`).slice(0, 200)}`;
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
