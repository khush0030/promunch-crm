// Built-in starter templates (the "PROMUNCH library"). Employees start from
// one of these, or from their own saved templates (email_studio_templates table).
//
// Copy rules (AGENTS.md §5): PROMUNCH in caps, no em dashes, "Your Munchy
// Pal". Product facts: only Crunchies and Edamame are roasted; chips and
// sticks are FRIED, so never call the whole range "roasted".
//
// Product ids are wa_catalog_items.retailer_id (Shopify variant ids). If one
// is removed or sells out, the renderer skips it and Review warns.
//
// Keep imports relative: vitest has no "@/" alias.

import { makeBlock, type Block, type EmailDesign, type Theme, DEFAULT_THEME } from "./design";
import { EMAIL_COLORS } from "../email/brand-tokens";

export type SystemTemplate = {
  key: string;
  name: string;
  category: "diwali" | "launch" | "sale" | "newsletter" | "winback" | "basic";
  description: string;
  subject: string;
  previewText: string;
  build: () => EmailDesign;
};

const P = {
  diwaliBox: "52260043850029",
  corporateHamper: "52395340103981",
  bigBite: "52137092284717",
  assorted270: "46127988572461",
  assorted150: "45724312928557",
  edamameCombo: "52137064595757",
  edamameRockSalt: "52135406371117",
  edamameIndori: "52137145139501",
  edamameMasala: "52165047386413",
  travelCombo: "49556437827885",
};

// Every template uses the PROMUNCH storefront look (DEFAULT_THEME, from
// email/brand-tokens.ts: promunch.in colours, fonts and logo), so Studio
// campaigns match flow emails. Diwali templates keep a festive deep-red page
// (the site's --accent-deep) around the same white card, a sibling of the
// Sep 29 Diwali email. Layout rules (Porcellia checklist): plain, one red CTA
// near the top (first scroll), products below it as quiet text links, no
// social row.
const BRAND_THEME: Theme = { ...DEFAULT_THEME };
const FESTIVE_THEME: Theme = { ...DEFAULT_THEME, background: EMAIL_COLORS.brandDeep };

// Block helpers that take overrides (ids stay fresh on every build).
function b<T extends Block["type"]>(type: T, over: Partial<Extract<Block, { type: T }>> = {}): Block {
  return { ...makeBlock(type), ...over } as Block;
}

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    key: "diwali-sale",
    name: "Diwali sale",
    category: "diwali",
    description: "Festive offer with a coupon and your best gift packs.",
    subject: "Your Diwali snack box is here, {{first_name|friend}}",
    previewText: "Festive protein snacks for the whole family, with 15% off.",
    build: () => ({
      version: 1,
      theme: { ...FESTIVE_THEME },
      blocks: [
        b("logo", { showTagline: true }),
        b("heading", { text: "Happy Diwali from PROMUNCH", size: "xl" }),
        b("text", {
          align: "center",
          text: "Hi {{first_name|there}},\n\nThis Diwali, swap the mithai overload for snacks everyone can keep reaching for. High in protein, big on flavour, made for sharing.",
        }),
        b("coupon", { code: "DIWALI15", headline: "15% off your Diwali order", note: "Apply at checkout. Valid till Nov 8." }),
        b("button", { label: "Shop the Diwali range", href: "https://promunch.in/collections/all" }),
        b("products", { items: [P.diwaliBox, P.bigBite, P.assorted270, P.corporateHamper], columns: 2, buttonLabel: "Add to cart" }),
        b("text", { align: "center", text: "Wishing you and your family a bright, happy and munchy Diwali." }),
      ],
    }),
  },
  {
    key: "diwali-gifting",
    name: "Diwali gift guide",
    category: "diwali",
    description: "Gift ideas by budget: under ₹600, under ₹1,100, corporate.",
    subject: "Diwali gifts they will actually eat",
    previewText: "Protein snack boxes from ₹555. Easy gifting for family, friends and teams.",
    build: () => ({
      version: 1,
      theme: { ...FESTIVE_THEME },
      blocks: [
        b("logo"),
        b("heading", { text: "The Diwali gift guide", size: "xl" }),
        b("text", {
          align: "center",
          text: "Hi {{first_name|there}},\n\nSweets get passed around. PROMUNCH gets finished. Here are our favourite gifts this festive season.",
        }),
        b("button", { label: "Shop Diwali gifts", href: "https://promunch.in/collections/all" }),
        b("divider"),
        b("heading", { text: "Under ₹600", size: "md" }),
        b("products", { items: [P.diwaliBox, P.assorted150], columns: 2, buttonLabel: "Gift this" }),
        b("heading", { text: "Under ₹1,100", size: "md" }),
        b("products", { items: [P.bigBite, P.assorted270], columns: 2, buttonLabel: "Gift this" }),
        b("heading", { text: "For your team or clients", size: "md" }),
        b("products", { items: [P.corporateHamper], columns: 1, buttonLabel: "See corporate hampers" }),
        b("text", {
          align: "center",
          text: "Ordering 10 or more hampers? Just reply to this email and we will help you with bulk pricing.",
        }),
      ],
    }),
  },
  {
    key: "diwali-early-access",
    name: "Diwali early access",
    category: "diwali",
    description: "Reward loyal customers first. Pair with the Customers or VIPs audience.",
    subject: "{{first_name|You}} get Diwali early access",
    previewText: "Our festive offer opens for you 48 hours before everyone else.",
    build: () => ({
      version: 1,
      theme: { ...FESTIVE_THEME },
      blocks: [
        b("logo"),
        b("heading", { text: "You're on the early list", size: "xl" }),
        b("text", {
          align: "center",
          text: "Hi {{first_name|there}},\n\nThank you for munching with us this year. As a thank you, our Diwali offer opens for you **48 hours before everyone else**.",
        }),
        b("coupon", { code: "EARLYDIWALI", headline: "20% off, only for you", note: "Valid for 48 hours. One use per customer." }),
        b("button", { label: "Use my early access", href: "https://promunch.in/collections/all" }),
        b("products", { items: [P.diwaliBox, P.bigBite], columns: 2, buttonLabel: "Shop early" }),
      ],
    }),
  },
  {
    key: "diwali-last-chance",
    name: "Diwali last chance",
    category: "diwali",
    description: "Short reminder before the offer ends. Send to people who have not ordered.",
    subject: "Last day for Diwali delivery",
    previewText: "Order today so your snack box arrives before the festivities.",
    build: () => ({
      version: 1,
      theme: { ...FESTIVE_THEME },
      blocks: [
        b("logo", { showTagline: false }),
        b("heading", { text: "Last chance for Diwali", size: "xl" }),
        b("text", {
          align: "center",
          text: "Hi {{first_name|there}},\n\nOur Diwali offer ends tonight. Order now and your box ships in time for the celebrations.",
        }),
        b("coupon", { code: "DIWALI15", headline: "15% off ends at midnight", note: "Apply at checkout." }),
        b("button", { label: "Order before midnight", href: "https://promunch.in/collections/all" }),
        b("products", { items: [P.diwaliBox, P.assorted270], columns: 2, buttonLabel: "Add to cart" }),
      ],
    }),
  },
  {
    key: "product-launch",
    name: "New product launch",
    category: "launch",
    description: "Introduce a new product with an image, story and shop buttons.",
    subject: "Meet our newest munch",
    previewText: "Roasted Edamame in three bold flavours. Now live.",
    build: () => ({
      version: 1,
      theme: { ...BRAND_THEME },
      blocks: [
        b("logo"),
        b("image", { alt: "New from PROMUNCH", padded: true }),
        b("heading", { text: "Roasted Edamame is here", size: "xl" }),
        b("text", {
          align: "center",
          text: "Hi {{first_name|there}},\n\nCrunchy, roasted and packed with plant protein. Pick your flavour.",
        }),
        b("button", { label: "Shop the launch", href: "https://promunch.in/collections/all" }),
        b("products", { items: [P.edamameRockSalt, P.edamameIndori, P.edamameMasala], columns: 3, buttonLabel: "Try it" }),
      ],
    }),
  },
  {
    key: "sale",
    name: "Sale announcement",
    category: "sale",
    description: "A straightforward offer: headline, coupon, products, button.",
    subject: "{{first_name|Hey}}, your PROMUNCH offer is inside",
    previewText: "A little something off your next order.",
    build: () => ({
      version: 1,
      theme: { ...BRAND_THEME },
      blocks: [
        b("logo"),
        b("heading", { text: "A treat for you", size: "xl" }),
        b("text", { align: "center", text: "Hi {{first_name|there}},\n\nStock up on your favourites for less this week." }),
        b("coupon", { code: "MUNCH10", headline: "10% off everything", note: "Apply at checkout." }),
        b("button", { label: "Shop now", href: "https://promunch.in/collections/all" }),
        b("products", { items: [P.assorted270, P.bigBite, P.travelCombo, P.edamameCombo], columns: 2, buttonLabel: "Add to cart" }),
      ],
    }),
  },
  {
    key: "newsletter",
    name: "Newsletter",
    category: "newsletter",
    description: "Story-led update with an image, two sections and a product pick.",
    subject: "What's new at PROMUNCH this month",
    previewText: "New flavours, snack ideas and what our community is munching.",
    build: () => ({
      version: 1,
      theme: { ...BRAND_THEME },
      blocks: [
        b("logo"),
        b("image", { alt: "PROMUNCH this month", padded: false }),
        b("heading", { text: "This month at PROMUNCH", size: "lg", align: "left" }),
        b("text", { text: "Hi {{first_name|there}},\n\nWrite a short intro here. What happened this month, and why it matters to your customers." }),
        b("button", { label: "Shop PROMUNCH", href: "https://promunch.in/collections/all", align: "left" }),
        b("divider"),
        b("heading", { text: "Snack idea of the month", size: "md", align: "left" }),
        b("text", { text: "Share a recipe or a snacking tip. Keep it short and useful." }),
        b("products", { items: [P.assorted150], columns: 1, buttonLabel: "Shop the pick" }),
      ],
    }),
  },
  {
    key: "winback",
    name: "We miss you",
    category: "winback",
    description: "Bring back lapsed customers. Pair with the Lapsed audience.",
    subject: "We saved your favourites, {{first_name|friend}}",
    previewText: "It's been a while. Here is something to welcome you back.",
    build: () => ({
      version: 1,
      theme: { ...BRAND_THEME },
      blocks: [
        b("logo"),
        b("heading", { text: "It's been a while", size: "xl" }),
        b("text", {
          align: "center",
          text: "Hi {{first_name|there}},\n\nWe noticed you haven't stocked up in a bit. Your snack drawer misses you, and so do we.",
        }),
        b("coupon", { code: "COMEBACK15", headline: "15% off your next order", note: "Valid for 7 days." }),
        b("button", { label: "Come back and munch", href: "https://promunch.in/collections/all" }),
        b("products", { items: [P.assorted270, P.edamameCombo], columns: 2, buttonLabel: "Reorder" }),
      ],
    }),
  },
  {
    key: "blank",
    name: "Start from scratch",
    category: "basic",
    description: "Logo, heading, text and a button. Build the rest yourself.",
    subject: "",
    previewText: "",
    build: () => ({
      version: 1,
      theme: { ...BRAND_THEME },
      blocks: [b("logo"), b("heading"), b("text"), b("button")],
    }),
  },
];

export function systemTemplate(key: string): SystemTemplate | undefined {
  return SYSTEM_TEMPLATES.find((t) => t.key === key);
}
