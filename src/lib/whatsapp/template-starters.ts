// Pre-written PROMUNCH WhatsApp template starters for the guided creator.
//
// Rules for every starter (enforced by template-starters.test.ts):
//  - passes validateTemplate() with zero errors once a header file is attached
//  - PROMUNCH in capitals, no em dashes, no emojis in header, buttons or footer
//  - no product claims: no protein numbers, prices or discounts in the fixed
//    copy. Offer details and product names are blanks the marketer fills in,
//    so the facts always come from them (and the Master KB), never from here.
//  - no footer: the STOP line is added automatically for marketing.

import {
  FIRST_NAME_LABEL, FIRST_NAME_SAMPLE, emptyDraft, uniqueName,
  type DraftButton, type EditorDraft, type HeaderKind,
} from "./template-draft";
import { slugifyTemplateName } from "./template-rules";

export type TemplateStarter = {
  key: string;
  title: string;
  /** One line for the card: when to use it. */
  when: string;
  /** One line for the card: what the customer gets. */
  sends: string;
  /** Optional highlight shown on the card. */
  benefit?: string;
  recommended?: boolean;
  category: "marketing";
  header_type: HeaderKind;
  body: string;
  /** Blank number -> label shown as a chip ("1" -> "First name"). */
  blankLabels: Record<string, string>;
  /** Blank number -> example for Meta's reviewer. */
  bodySamples: Record<string, string>;
  buttons: DraftButton[];
};

const SHOP = "https://promunch.in";

export const TEMPLATE_STARTERS: TemplateStarter[] = [
  {
    key: "general_update",
    title: "General update with picture",
    when: "Any announcement: a new flavour, an event, a collab, a festive greeting.",
    sends: "Your picture, a greeting with their name and your own message.",
    benefit: "Approve once, reuse with any picture and message.",
    recommended: true,
    category: "marketing",
    header_type: "IMAGE",
    body: "Hi {{1}}, a quick update from PROMUNCH.\n\n{{2}}\n\nTap below to find out more.",
    blankLabels: { "1": FIRST_NAME_LABEL, "2": "Your message" },
    bodySamples: { "1": FIRST_NAME_SAMPLE, "2": "Our new flavour is now live on the website." },
    buttons: [{ type: "URL", text: "Find out more", url: SHOP }],
  },
  {
    key: "product_launch",
    title: "New product launch",
    when: "A new flavour or pack goes live on the store.",
    sends: "A product picture, the product name and a button to the store.",
    category: "marketing",
    header_type: "IMAGE",
    body: "Hi {{1}}, something new just landed at PROMUNCH: {{2}}.\n\nBe one of the first to try it. Tap below to take a look.",
    blankLabels: { "1": FIRST_NAME_LABEL, "2": "Product name" },
    bodySamples: { "1": FIRST_NAME_SAMPLE, "2": "Roasted Edamame" },
    buttons: [{ type: "URL", text: "Take a look", url: SHOP }],
  },
  {
    key: "festive_offer",
    title: "Festive offer",
    when: "Diwali, Rakhi, Holi or any festival sale.",
    sends: "A festive picture, the festival name and your offer in your words.",
    category: "marketing",
    header_type: "IMAGE",
    body: "Hi {{1}}, {{2}} is almost here and PROMUNCH is celebrating with you.\n\nHere is your festive offer: {{3}}.\n\nTap below to shop before the offer ends.",
    blankLabels: { "1": FIRST_NAME_LABEL, "2": "Festival", "3": "Offer details" },
    bodySamples: { "1": FIRST_NAME_SAMPLE, "2": "Diwali", "3": "free shipping on orders above ₹599" },
    buttons: [{ type: "URL", text: "Shop the offer", url: SHOP }],
  },
  {
    key: "back_in_stock",
    title: "Back in stock",
    when: "A product that sold out is available again.",
    sends: "A product picture and a nudge to order while it is available.",
    category: "marketing",
    header_type: "IMAGE",
    body: "Hi {{1}}, good news: {{2}} is back in stock at PROMUNCH.\n\nGrab yours while it is available. Tap below to order.",
    blankLabels: { "1": FIRST_NAME_LABEL, "2": "Product name" },
    bodySamples: { "1": FIRST_NAME_SAMPLE, "2": "Roasted Edamame" },
    buttons: [{ type: "URL", text: "Order now", url: SHOP }],
  },
  {
    key: "review_request",
    title: "Thank you and review request",
    when: "A few days after customers receive their order.",
    sends: "A warm thank you and a button to leave a review.",
    category: "marketing",
    header_type: "",
    body: "Hi {{1}}, thank you for choosing PROMUNCH. We hope you are enjoying your snacks.\n\nWe would love to hear what you think. It takes a minute and helps other snack lovers choose. Tap below to share your review.",
    blankLabels: { "1": FIRST_NAME_LABEL },
    bodySamples: { "1": FIRST_NAME_SAMPLE },
    buttons: [{ type: "URL", text: "Write a review", url: `${SHOP}/pages/review-submission` }],
  },
  {
    key: "win_back",
    title: "Win back (we miss you)",
    when: "Customers who have not ordered in a while.",
    sends: "A friendly we-miss-you note with your own message.",
    category: "marketing",
    header_type: "IMAGE",
    body: "Hi {{1}}, it has been a while and we miss you at PROMUNCH.\n\n{{2}}\n\nTap below to see what is new and pick your favourites.",
    blankLabels: { "1": FIRST_NAME_LABEL, "2": "Your message" },
    bodySamples: { "1": FIRST_NAME_SAMPLE, "2": "Your favourite snacks are ready when you are." },
    buttons: [{ type: "URL", text: "See what is new", url: SHOP }],
  },
];

/**
 * A new editor draft pre-filled from a starter. The Meta name is built from
 * the title and bumped to _v2, _v3... when that name is already taken.
 */
export function draftFromStarter(s: TemplateStarter, taken: Iterable<string>): EditorDraft {
  return {
    ...emptyDraft(),
    title: s.title,
    name: uniqueName(slugifyTemplateName(s.title), taken),
    nameTouched: false,
    category: s.category,
    header_type: s.header_type,
    body: s.body,
    buttons: s.buttons.map((b) => ({ ...b })),
    bodySamples: { ...s.bodySamples },
    blankLabels: { ...s.blankLabels },
  };
}
