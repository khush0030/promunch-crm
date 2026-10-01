// Visual (click-to-edit) email editing for the automation editor.
//
// The stored email body is inline-styled HTML built from brand-blocks.ts, with
// {{merge}} tags that personalize.ts fills at send time. Staff edit it on a
// canvas instead of raw HTML:
//   - text inside the email is directly editable (only "leaf" text elements,
//     so the table layout around it cannot be broken by typing);
//   - merge tags in the text become locked chips ("First name", "Their code"),
//     so a tag can be removed whole but never half-typed;
//   - block tags ({{reorder_card}}, {{cart_items}}...) become a locked
//     placeholder section;
//   - serialize() turns the canvas back into exactly the stored format.
// Tags inside attributes (href="{{review_url}}") are left alone.
//
// Everything here takes a Document/Element so it runs in the browser canvas
// and in jsdom tests. Keep imports relative: vitest has no "@/" alias.

import { button, couponBox, divider, founderSignoff, h1, p, photo, productGrid, reviewQuote, socialRow, starRating, trustRow } from "../email/brand-blocks";
import { PRODUCTS, SITE, cdnImg } from "../email/flow-templates";

/** What a merge tag looks like on the canvas. */
export const TAG_LABELS: Record<string, string> = {
  first_name: "First name",
  coupon_code: "Their code",
  cart_total: "Cart total",
  review_product: "Product they bought",
  "product.title": "Product name",
  "product.price": "Product price",
};

/** Tags that render as a whole section (a table), not inline text. */
export const BLOCK_TAGS: Record<string, string> = {
  cart_items: "Their cart (items and prices)",
  cart_summary: "Their cart, with the code applied",
  reorder_card: "The product they bought (photo and name)",
  product_card: "The product they looked at (photo, name and price)",
  product_image: "Photo of the product they looked at",
};

const TAG_RE = /\{\{\s*([a-z_.]+)\s*\}\}/g;
const LEAF_TAGS = new Set(["P", "H1", "H2", "H3", "LI", "TD", "DIV", "A", "SPAN"]);
const INLINE_TAGS = new Set(["STRONG", "B", "EM", "I", "U", "BR", "SPAN", "A", "SMALL", "SUP", "SUB"]);

export function tagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? BLOCK_TAGS[tag] ?? tag.replace(/[_.]/g, " ");
}

function chip(doc: Document, tag: string): HTMLElement {
  const block = tag in BLOCK_TAGS;
  const el = doc.createElement(block ? "div" : "span");
  el.setAttribute("data-pm-tag", tag);
  el.setAttribute("contenteditable", "false");
  el.textContent = block ? `${BLOCK_TAGS[tag]}, filled in for each customer` : tagLabel(tag);
  return el;
}

/** Replace {{tags}} in TEXT nodes under root with locked chips. */
export function decorate(root: Element): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (TAG_RE.test((n as Text).data)) texts.push(n as Text);
    TAG_RE.lastIndex = 0;
  }
  for (const t of texts) {
    const frag = doc.createDocumentFragment();
    let last = 0;
    const data = t.data;
    for (const m of data.matchAll(TAG_RE)) {
      if (m.index! > last) frag.appendChild(doc.createTextNode(data.slice(last, m.index)));
      frag.appendChild(chip(doc, m[1]));
      last = m.index! + m[0].length;
    }
    if (last < data.length) frag.appendChild(doc.createTextNode(data.slice(last)));
    t.parentNode!.replaceChild(frag, t);
  }
}

/** A text element whose children are only text, inline formatting and chips. */
function isLeaf(el: Element): boolean {
  if (!LEAF_TAGS.has(el.tagName) || el.hasAttribute("data-pm-tag")) return false;
  let hasText = false;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      if ((c as Text).data.trim()) hasText = true;
      continue;
    }
    if (c.nodeType !== 1) continue;
    const ce = c as Element;
    if (ce.hasAttribute("data-pm-tag")) {
      if (ce.tagName === "DIV") return false;
      hasText = true;
      continue;
    }
    if (!INLINE_TAGS.has(ce.tagName) || ce.querySelector("img,table,div,p")) return false;
    if (ce.textContent?.trim()) hasText = true;
  }
  return hasText;
}

/** Mark the editable text elements (outermost leaves only). Returns how many. */
export function markEditable(root: Element): number {
  let n = 0;
  const visit = (el: Element) => {
    if (isLeaf(el)) {
      el.setAttribute("contenteditable", "true");
      el.setAttribute("data-pm-edit", "");
      n++;
      return;
    }
    for (const c of Array.from(el.children)) visit(c);
  };
  for (const c of Array.from(root.children)) visit(c);
  return n;
}

/** Canvas -> stored HTML: chips back to {{tags}}, editor attributes removed. */
export function serialize(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  for (const c of Array.from(clone.querySelectorAll("[data-pm-tag]"))) {
    c.replaceWith(clone.ownerDocument.createTextNode(`{{${c.getAttribute("data-pm-tag")}}}`));
  }
  for (const e of Array.from(clone.querySelectorAll("[contenteditable],[data-pm-edit],[data-pm-section]"))) {
    e.removeAttribute("contenteditable");
    e.removeAttribute("data-pm-edit");
    e.removeAttribute("data-pm-section");
    e.removeAttribute("spellcheck");
  }
  return clone.innerHTML;
}

/** Load stored HTML into a canvas root, ready for editing. */
export function loadCanvas(root: Element, html: string): number {
  root.innerHTML = html;
  // Bare block tags between sections ("{{reorder_card}}") sit in text nodes at
  // the top level; wrap them so they become their own section.
  decorate(root);
  return markEditable(root);
}

/** The top-level sections of the email (what move/duplicate/delete act on). */
export function sections(root: Element): Element[] {
  return Array.from(root.children);
}

// ---------------------------------------------------------------------------
// "Add a section": ready-made pieces in the house style (same builders the
// approved flow emails use).
// ---------------------------------------------------------------------------

export type SectionKind = {
  key: string;
  label: string;
  hint: string;
  html: () => string;
  /** Only offered for these triggers (personalised sections). */
  triggers?: string[];
};

const BEST = `${SITE}/collections/best-sellers`;

export const SECTION_KINDS: SectionKind[] = [
  { key: "heading", label: "Heading", hint: "Big bold title", html: () => h1("Your heading") },
  { key: "text", label: "Text", hint: "A paragraph", html: () => p("Write your message here.") },
  { key: "button", label: "Button", hint: "Full-width red button", html: () => button("Shop now", BEST, "solid", { full: true }) },
  { key: "button2", label: "Second button", hint: "White button with red border", html: () => button("See all snacks", `${SITE}/collections/all`, "outline", { full: true }) },
  { key: "image", label: "Photo", hint: "A store photo", html: () => photo(cdnImg("Can_you_update_this_image_202606060937.jpg?v=1781094699"), "PROMUNCH snacks", undefined, 520) },
  { key: "code", label: "Discount code box", hint: "Shows their code (turn on the offer)", html: () => couponBox("{{coupon_code}}", "15% off your order", "One use. Valid for 7 days.") },
  {
    key: "products",
    label: "Product picks",
    hint: "3 best sellers with photos",
    html: () => productGrid((["edamameRockSalt", "crunchies4", "bigBite"] as const).map((k) => ({ title: PRODUCTS[k].title, url: `${SITE}${PRODUCTS[k].path}`, image: PRODUCTS[k].image }))),
  },
  { key: "review", label: "Customer review", hint: "A 5-star quote", html: () => reviewQuote("Write the review exactly as the customer posted it.", "Customer name, on Product", 5) },
  { key: "trust", label: "Trust row", hint: "Free shipping, COD, reply", html: () => trustRow(["Free shipping over ₹599", "Cash on delivery available", "Questions? Just reply"]) },
  { key: "founder", label: "Parth's sign-off", hint: "Photo, name and Forbes line", html: () => founderSignoff() },
  { key: "social", label: "Follow us", hint: "Instagram, Facebook, YouTube", html: () => socialRow() },
  { key: "divider", label: "Divider", hint: "A thin line", html: () => divider() },
  { key: "stars", label: "Review stars", hint: "Tap-to-rate stars", html: () => starRating("{{review_url}}"), triggers: ["order_placed"] },
  { key: "reorder", label: "Product they bought", hint: "Photo and name, links to reorder", html: () => "{{reorder_card}}", triggers: ["order_placed"] },
  { key: "cart", label: "Their cart", hint: "Items with the code applied", html: () => "{{cart_summary}}", triggers: ["checkout_abandoned"] },
  { key: "viewed", label: "Product they looked at", hint: "Photo, name and price", html: () => "{{product_card}}", triggers: ["segment_entry"] },
];

export function sectionKindsFor(trigger: string): SectionKind[] {
  return SECTION_KINDS.filter((k) => !k.triggers || k.triggers.includes(trigger));
}

/** Store photos staff can pick when swapping an image. */
export const STORE_IMAGES: { label: string; src: string }[] = [
  ...Object.values(PRODUCTS).map((x) => ({ label: x.title, src: x.image })),
  { label: "Edamame picnic", src: cdnImg("Can_you_update_this_image_202606060937.jpg?v=1781094699") },
  { label: "Jar on the table", src: cdnImg("Image_25.jpg?v=1771656794") },
  { label: "Recipes (bhel, upma, soup)", src: cdnImg("All-4-Chunks_Recipes_03_1d491195-6a1d-407d-acba-207266660c9c.jpg?v=1771656794") },
  { label: "Protein comparison", src: cdnImg("rock_salt_comparison_1.jpg?v=1781941697") },
  { label: "Sticks and chips", src: cdnImg("DSL_0559_copy_b77e4ec8-35ee-470f-9449-93711c2fe2ee.jpg?v=1773731324") },
];

/** Link targets offered in the link box (staff can still paste any https link). */
export const QUICK_LINKS: { label: string; href: string }[] = [
  { label: "Best sellers", href: BEST },
  { label: "All snacks", href: `${SITE}/collections/all` },
  { label: "Combos", href: `${SITE}/collections/combos-and-gift-packs` },
  { label: "Roasted Edamame", href: `${SITE}/collections/roasted-edamame-beans-high-protein-healthy-snacks-for-weight-loss` },
  { label: "FAQs", href: `${SITE}/pages/faqs` },
];

/** Tags usable as href values for each trigger (shown as "special links"). */
export function specialLinks(trigger: string): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  if (trigger === "checkout_abandoned") out.push({ label: "Back to their cart", href: "{{checkout_url}}" });
  if (trigger === "order_placed") {
    out.push({ label: "Reorder what they bought", href: "{{reorder_url}}" });
    out.push({ label: "Review the product they bought", href: "{{review_url}}" });
  }
  if (trigger === "segment_entry") out.push({ label: "The product they looked at", href: "{{product.url}}" });
  return out;
}

/** "{{first_name}}, your cart" -> "[First name], your cart" for lists and labels. */
export function friendlyText(text: string): string {
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_, t: string) => `[${tagLabel(t)}]`);
}

/** Plain name of a special link tag ("{{checkout_url}}" -> "Back to their cart"). */
export function specialLinkLabel(href: string): string | null {
  const all = ["checkout_abandoned", "order_placed", "segment_entry"].flatMap(specialLinks);
  return all.find((l) => l.href === href.trim())?.label ?? null;
}

/** Only https links or a known {{tag}} may be set from the link box. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\{\{\s*[a-z_.]+\s*\}\}$/.test(h)) return h;
  try {
    const u = new URL(h);
    return u.protocol === "https:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Plain-language label for a step's wait, given the trigger. */
export function whenLabel(trigger: string, index: number, hours: number): string {
  const start: Record<string, string> = {
    checkout_abandoned: "they leave checkout",
    order_placed: "they order",
    customer_created: "they sign up",
    segment_entry: "they qualify",
    date_based: "the date arrives",
  };
  const t = hours <= 0 ? "Right away" : hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${Math.round(hours * 10) / 10} hours` : `${Math.round((hours / 24) * 10) / 10} days`;
  if (index === 0) return hours <= 0 ? `Right after ${start[trigger] ?? "it starts"}` : `${t} after ${start[trigger] ?? "it starts"}`;
  return hours <= 0 ? "Right after the email above" : `${t} after the email above`;
}
