import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { requireSecretsOwner } from "@/lib/secrets";
import { recordAudit } from "@/lib/audit";
import { brevo, brevoGet, BrevoError, section, type Section } from "@/lib/brevo";
import { parseCouponCodes } from "@/lib/brevo-coupons";

// Brevo coupon collections: unique codes Brevo inserts one per recipient
// ({{ coupon.<collection> }} in campaign content).
//   GET  -> collections (plan-gated notice if Brevo refuses)
//   POST {action: "create", name, defaultCoupon, expirationDate?, remainingDaysAlert?, remainingCouponsAlert?}
//        {action: "update", id, defaultCoupon?, expirationDate?, remainingDaysAlert?, remainingCouponsAlert?}
//        {action: "add_codes", id, codes: "PM-1, PM-2 ..."}
//        {action: "activate_ecommerce"} (owner) turns on Brevo's eCommerce app,
//        which coupons and revenue attribution need
// Codes must already exist as discount codes in Shopify.
export const dynamic = "force-dynamic";

export type CouponCollection = {
  id: string;
  name: string;
  defaultCoupon: string;
  createdAt: string;
  totalCoupons: number;
  remainingCoupons: number;
  expirationDate?: string;
  remainingDaysAlert?: number;
  remainingCouponsAlert?: number;
};

export async function GET() {
  // Brevo's docs don't name the list key; accept either spelling.
  const collections: Section<CouponCollection[]> = await section(
    brevoGet<Record<string, unknown>>("/couponCollections?sort=desc&limit=100").then(
      (r) => ((r.collections ?? r.couponCollections ?? []) as CouponCollection[]),
    ),
  );
  return NextResponse.json({ collections });
}

const intOrUndef = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined);

export async function POST(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const gate = b.action === "activate_ecommerce" ? await requireSecretsOwner() : await requireAdmin();
  if (!gate.ok) return gate.response;
  const audit = (action: string, id: string, summary: string) =>
    recordAudit({ action: `brevo.coupon_${action}`, entityType: "brevo_coupon_collection", entityId: id, summary, actor: gate.user, request: req });
  const expiration = typeof b.expirationDate === "string" && b.expirationDate ? new Date(b.expirationDate) : null;
  if (expiration && Number.isNaN(expiration.getTime())) return NextResponse.json({ ok: false, error: "expirationDate is not a date" }, { status: 400 });
  const extras = {
    ...(expiration ? { expirationDate: expiration.toISOString() } : {}),
    ...(intOrUndef(b.remainingDaysAlert) ? { remainingDaysAlert: b.remainingDaysAlert } : {}),
    ...(intOrUndef(b.remainingCouponsAlert) ? { remainingCouponsAlert: b.remainingCouponsAlert } : {}),
  };

  try {
    switch (b.action) {
      case "activate_ecommerce": {
        await brevo("POST", "/ecommerce/activate");
        await audit("activate_ecommerce", "ecommerce", "Brevo eCommerce app activated");
        return NextResponse.json({ ok: true });
      }
      case "create": {
        const name = typeof b.name === "string" ? b.name.trim() : "";
        const defaultCoupon = typeof b.defaultCoupon === "string" ? b.defaultCoupon.trim() : "";
        if (!/^[A-Za-z0-9_-]{2,60}$/.test(name)) return NextResponse.json({ ok: false, error: "name: letters, numbers, - and _ only (used as the merge tag)" }, { status: 400 });
        if (!defaultCoupon) return NextResponse.json({ ok: false, error: "defaultCoupon is required (shown when unique codes run out)" }, { status: 400 });
        const r = await brevo<{ id: string }>("POST", "/couponCollections", { name, defaultCoupon, ...extras });
        await audit("create", r.id, name);
        return NextResponse.json({ ok: true, id: r.id });
      }
      case "update": {
        const id = typeof b.id === "string" ? b.id : "";
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const payload = { ...(typeof b.defaultCoupon === "string" && b.defaultCoupon.trim() ? { defaultCoupon: b.defaultCoupon.trim() } : {}), ...extras };
        if (Object.keys(payload).length === 0) return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
        await brevo("PATCH", `/couponCollections/${id}`, payload);
        await audit("update", id, Object.keys(payload).join(", "));
        return NextResponse.json({ ok: true });
      }
      case "add_codes": {
        const id = typeof b.id === "string" ? b.id : "";
        if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
        const parsed = parseCouponCodes(typeof b.codes === "string" ? b.codes : "");
        if (parsed.invalid.length) return NextResponse.json({ ok: false, error: `Invalid codes: ${parsed.invalid.slice(0, 10).join(", ")}` }, { status: 400 });
        if (parsed.codes.length === 0) return NextResponse.json({ ok: false, error: "Paste at least one code" }, { status: 400 });
        if (parsed.codes.length > 50_000) return NextResponse.json({ ok: false, error: "At most 50,000 codes per upload" }, { status: 400 });
        await brevo("POST", "/coupons", { collectionId: id, coupons: parsed.codes });
        await audit("add_codes", id, `${parsed.codes.length} codes`);
        return NextResponse.json({ ok: true, added: parsed.codes.length, duplicatesIgnored: parsed.duplicates });
      }
      default:
        return NextResponse.json({ ok: false, error: "action must be create, update or add_codes" }, { status: 400 });
    }
  } catch (e) {
    console.error("[brevo/coupons]", b.action, e);
    const msg = e instanceof BrevoError ? (e.planGated ? `Brevo won't allow coupons on this account yet: ${e.message}` : `Brevo: ${e.message}`) : e instanceof Error ? e.message : "failed";
    return NextResponse.json({ ok: false, error: msg }, { status: e instanceof BrevoError && e.planGated ? 403 : 502 });
  }
}
