// Plain-language helpers for WhatsApp templates in marketer-facing screens.
// Pure functions, no React, safe on server and client.
//
//   templateKind({ name, category })  -> "marketing" | "customer_service" | "internal"
//   friendlyTemplateName("abandoned_cart_reminder_v2") -> "Abandoned cart reminder (version 2)"
//   renderBlanks("Hi {{1}}", { "1": "First name" }) -> [{kind:"text",text:"Hi "},{kind:"chip",key:"1",label:"First name",raw:"{{1}}"}]

export type TemplateKind = "marketing" | "customer_service" | "internal";

const VERSION_RE = /_v(\d+)$/i;

// Templates our own system sends (ops pings, order confirmations, test). Never
// shown to marketers as campaign options. Matched on the name without _vN.
const INTERNAL_EXACT = new Set(["order_cancel_ops", "hello_world", "shipping_update", "cart_link_requested"]);
const INTERNAL_PREFIX = ["ops_", "order_confirmation", "order_verify"];

/**
 * Classify a template for the marketing UI.
 *  - internal: system templates (ops_*, order_cancel_ops, hello_world,
 *    order_confirmation*, order_verify*, shipping_update, cart_link_requested)
 *  - customer_service: any other UTILITY (or AUTHENTICATION) template
 *  - marketing: MARKETING / OFFER category. A missing or unknown category is
 *    treated as marketing, the stricter bucket (daily limit, quiet hours, STOP).
 */
export function templateKind(t: { name: string; category?: string | null }): TemplateKind {
  const base = t.name.trim().toLowerCase().replace(VERSION_RE, "");
  if (INTERNAL_EXACT.has(base) || INTERNAL_PREFIX.some((p) => base.startsWith(p))) return "internal";
  const cat = (t.category ?? "").trim().toUpperCase();
  if (cat === "UTILITY" || cat === "AUTHENTICATION") return "customer_service";
  return "marketing";
}

// Marketing templates written for one automation (cart, review, restock). Their
// copy only makes sense to that trigger ("you left goodies in your cart"), so
// they must not be offered as broadcast campaign messages.
const AUTOMATION_EXACT = new Set(["abandoned_checkout", "review_request", "replenishment_reminder"]);
const AUTOMATION_PREFIX = ["abandoned_cart"];

export function isAutomationTemplate(name: string): boolean {
  const base = name.trim().toLowerCase().replace(VERSION_RE, "");
  return AUTOMATION_EXACT.has(base) || AUTOMATION_PREFIX.some((p) => base.startsWith(p));
}

/**
 * "abandoned_cart_reminder" -> "Abandoned cart reminder";
 * "edamame_launch_v2" -> "Edamame launch (version 2)". The word promunch is
 * always written PROMUNCH.
 */
export function friendlyTemplateName(name: string): string {
  let n = name.trim();
  let version = "";
  const m = n.match(VERSION_RE);
  if (m) {
    version = ` (version ${Number(m[1])})`;
    n = n.slice(0, m.index);
  }
  const words = n.split(/[_\-\s]+/).filter(Boolean);
  if (words.length === 0) return version.trim();
  const text = words
    .map((w, i) => {
      if (w.toLowerCase() === "promunch") return "PROMUNCH";
      const lw = w.toLowerCase();
      return i === 0 ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw;
    })
    .join(" ");
  return text + version;
}

export type BlankSegment =
  | { kind: "text"; text: string }
  /** key is what sits inside the braces ("1" or "first_name"); raw is the original "{{1}}". */
  | { kind: "chip"; key: string; label: string; raw: string };

const BLANK_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Split a template body into text and blank chips so {{1}} can be shown as a
 * friendly chip. `labels` maps blank key -> label (e.g. { "1": "First name" }).
 * Unlabelled numeric blanks read "Blank 1"; named ones are humanised
 * ("first_name" -> "First name"). Adjacent text is merged; empty text is dropped.
 */
export function renderBlanks(body: string, labels?: Record<string, string>): BlankSegment[] {
  const out: BlankSegment[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += text;
    else out.push({ kind: "text", text });
  };
  let at = 0;
  for (const m of body.matchAll(BLANK_RE)) {
    const idx = m.index ?? 0;
    pushText(body.slice(at, idx));
    const key = m[1];
    const given = labels?.[key]?.trim();
    const label = given || (/^\d+$/.test(key) ? `Blank ${Number(key)}` : friendlyTemplateName(key));
    out.push({ kind: "chip", key, label, raw: m[0] });
    at = idx + m[0].length;
  }
  pushText(body.slice(at));
  return out;
}
