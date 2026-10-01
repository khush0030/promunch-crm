// One-off: render ONE flow step exactly like flow-engine tick() and send it to
// the owner's test inbox. Never mints a real coupon (uses a TEST code), never
// writes flow/enrolment rows. Usage:
//   UNSUBSCRIBE_SECRET=local-test-only-not-prod npx tsx --env-file=.env.local scripts/email-flow-test-send.ts <flow_key> <step_index> [n] [total]
//   DRY=1 = render to scratch/sent/ only. Fake TEST-<prefix> coupon, no DB writes.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { FLOW_TEMPLATES } from "@/lib/email/flow-templates";
import { personalize, personalizeSubject } from "@/lib/email/personalize";
import { renderMarketingEmail } from "@/lib/email/layout";
import { renderPlainMarketingEmail } from "@/lib/email/plain-layout";
import { marketingHeaders, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { tokenizeStorefrontLinks } from "@/lib/email/link-tokens";
import { withContactToken } from "@/lib/email/browse-abandon";
import { sendEmail, DEFAULT_FROM } from "@/lib/resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadStoreCatalog, pickReviewProduct, usesReviewTokens } from "@/lib/email/order-product";

const TO = "kmutha@vippysoya.com";
const [flowKey, stepArg, nArg, totalArg] = process.argv.slice(2);

const SAMPLE_CONTEXT: Record<string, unknown> = {
  checkout_url: "https://promunch.in/collections/best-sellers",
  total: 710,
  items: [
    {
      title: "Noodle Masala Soya Crunchies - 270gm",
      product_id: 8507154989357,
      quantity: 1,
      price: 260,
      image_url: "https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Noodle_Masala_270g.png?v=1771656794",
    },
    {
      title: "PROMUNCH Edamame Beans Travel Combo - Pack of 9 (25g each )",
      quantity: 1,
      price: 450,
      image_url: "https://cdn.shopify.com/s/files/1/0794/6731/5501/files/ChatGPTImageJun16_2026_04_48_28PM_1.png?v=1788435089",
    },
  ],
  product: {
    title: "Noodle Masala Soya Crunchies - 270gm",
    url: "https://promunch.in/products/promunch-roasted-soya-snack-vegan-high-protein-healthy-gluten-free-flavor-noodle-masala-300-g-pack-of-1",
    image: "https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Noodle_Masala_270g.png?v=1771656794",
    price: 260,
  },
};

async function main() {
  const tpl = FLOW_TEMPLATES.find((t) => t.key === flowKey);
  if (!tpl) throw new Error(`no flow ${flowKey}; have: ${FLOW_TEMPLATES.map((t) => t.key).join(", ")}`);
  const idx = Number(stepArg ?? 0);
  const step = tpl.steps[idx];
  if (!step) throw new Error(`${flowKey} has ${tpl.steps.length} steps`);

  const { data: c } = await supabaseAdmin.from("contacts").select("id, first_name").ilike("email", TO).maybeSingle();
  const contactId = (c?.id as string) ?? "00000000-0000-0000-0000-000000000000";
  const first = (c?.first_name as string | null) ?? "Khush";

  const coupon = step.coupon ? `TEST-${step.coupon.prefix ?? "PM"}` : step.coupon_code ?? "";
  let ctx: Record<string, unknown> = SAMPLE_CONTEXT;
  if (usesReviewTokens(step.body_html, step.subject, step.preview_text)) {
    ctx = { ...SAMPLE_CONTEXT, review_product: pickReviewProduct(SAMPLE_CONTEXT, await loadStoreCatalog()) };
    console.log("review_product:", JSON.stringify(ctx.review_product));
  }
  const bodyHtml = personalize(step.body_html, ctx, first, idx, coupon, undefined, Number(step.coupon?.percent_off ?? 0));
  const previewText = step.preview_text ? personalizeSubject(step.preview_text, ctx, first, coupon) : undefined;
  const rendered = step.format === "plain"
    ? renderPlainMarketingEmail({ unsubscribeUrl: unsubscribeUrl(contactId), bodyHtml, previewText, signature: step.signature })
    : renderMarketingEmail({ contactId, bodyHtml, previewText });
  const html = tokenizeStorefrontLinks(rendered, (u) => withContactToken(u, contactId));
  const label = nArg && totalArg ? `[TEST ${nArg}/${totalArg}]` : "[TEST]";
  const subject = `${label} ${personalizeSubject(step.subject, ctx, first, coupon)}`;
  const from = step.from_name ? DEFAULT_FROM.replace(/^[^<]*</, `${step.from_name} <`) : DEFAULT_FROM;

  mkdirSync("scratch/sent", { recursive: true });
  writeFileSync(`scratch/sent/${flowKey}-${idx + 1}.html`, html);

  if (process.env.DRY) { console.log("dry run, saved only"); return; }

  // Images under https://admin.promunch.in/email/ are not live until deploy,
  // so the TEST embeds them inline (cid) straight from public/email/.
  const LIVE_PREFIX = "https://admin.promunch.in/email/";
  const attachments: Array<{ filename: string; content: string; content_id: string }> = [];
  const testHtml = html.replace(new RegExp(LIVE_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "([\\w.-]+)", "g"), (_m, file: string) => {
    const cid = file.replace(/\W/g, "_");
    if (!attachments.some((a) => a.content_id === cid)) {
      attachments.push({ filename: file, content: readFileSync(`public/email/${file}`).toString("base64"), content_id: cid });
    }
    return `cid:${cid}`;
  });
  if (attachments.length === 0) {
    const r = await sendEmail({ to: TO, subject, html, from, headers: marketingHeaders(contactId) });
    if (r?.error) throw new Error(r.error.message);
    console.log(JSON.stringify({ to: TO, from, subject, resend_id: r?.data?.id, coupon, contactFound: !!c?.id }, null, 2));
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [TO], subject, html: testHtml, reply_to: "hello@promunch.in", headers: marketingHeaders(contactId), attachments }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j));
  console.log(JSON.stringify({ to: TO, from, subject, resend_id: j.id, coupon, inlined: attachments.map((a) => a.filename) }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
