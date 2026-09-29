import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/resend";
import { parseDesign, productIds, contentHash } from "@/lib/email-studio/design";
import { renderDesign, mergeText, SAMPLE_MERGE } from "@/lib/email-studio/render";
import { getStudioSettings, productMap, utmSlug } from "@/lib/email-studio/server";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";

// Send a test of the current version to yourself (or up to 5 teammates).
// Recording the content hash is what unlocks "Send" for this exact version.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const body = (await parseBody<{ to?: string[] | string }>(req)) ?? {};

  const raw = Array.isArray(body.to) ? body.to : body.to ? String(body.to).split(/[,\s]+/) : [me.email];
  const to = [...new Set(raw.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0 || to.length > 5) return bad("Send a test to between 1 and 5 addresses.");
  const invalid = to.find((e) => !EMAIL_RE.test(e));
  if (invalid) return bad(`"${invalid}" is not an email address.`);

  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) return bad("not found", 404);
  const design = parseDesign(c.design);
  if (!design) return bad("This campaign has no builder design.");
  if (!c.subject) return bad("Add a subject line first.");

  const settings = await getStudioSettings();
  const products = await productMap(productIds(design));
  const merge = { ...SAMPLE_MERGE, first_name: (me.user.user_metadata?.full_name as string | undefined)?.split(" ")[0] || SAMPLE_MERGE.first_name };
  const html = renderDesign(design, {
    brand: settings.brand,
    products,
    // Test sends never carry a real subscriber's unsubscribe link.
    unsubscribeUrl: "https://promunch.in",
    previewText: c.preview_text ? mergeText(c.preview_text, merge) : undefined,
    utm: { campaign: (c.utm_campaign as string | null) || utmSlug(c.name ?? "email", id), content: "test" },
    merge,
  });

  const res = await sendEmail({ to, subject: `[TEST] ${mergeText(c.subject, merge)}`, html });
  if (res?.error) return bad(`Resend refused the test: ${res.error.message}`, 502);

  await supabase
    .from("campaigns")
    .update({ test_sent_at: new Date().toISOString(), test_sent_hash: contentHash(c.subject ?? "", c.preview_text ?? "", c.design) })
    .eq("id", id);
  return NextResponse.json({ ok: true, to });
}
