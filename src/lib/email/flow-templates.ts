// Pre-built flow templates for the "Create flow" gallery (Klaviyo-style).
// "Use template" inserts a flows row pre-filled with these steps; everything is
// editable afterwards in the builder. Every template carries full branded
// copy; docs/plans/2026-09-30-email-flow-content.sql is generated from this
// file (regenerate it when copy changes).
//
// Copy rules (AGENTS.md §5): PROMUNCH all caps, no em dashes, tagline
// "Your Munchy Pal", never mention Oltaflock. Body HTML here is the INNER
// content; renderMarketingEmail() wraps it with the header + unsubscribe footer
// at send time. Shipping: free over ₹599.
//
// Keep imports relative: vitest has no "@/" alias.

import { button, couponBox, divider, eyebrow, founderSignoff, h1, p, photo, productGrid, reviewQuote, socialRow, trustRow } from "./brand-blocks";

// flows.trigger_type CHECK: checkout_abandoned | order_placed | customer_created
// | segment_entry | date_based.
export type FlowTrigger =
  | "checkout_abandoned"
  | "order_placed"
  | "customer_created"
  | "segment_entry"
  | "date_based";

export type FlowStep = {
  type: "email";
  /** Wait before THIS email, relative to the previous step (or enrolment).
   *  Fractional values are allowed: 0.25 = 15 minutes. */
  delay_hours: number;
  subject: string;
  body_html: string;
  /** Optional coupon surfaced in the builder; copy references it by name. */
  coupon_code?: string;
  /**
   * Inbox preview line (the grey text after the subject). Email clients fall
   * back to scraping the first words of the body when this is absent, which
   * reads as noise and measurably costs opens. Worth setting on every step.
   */
  preview_text?: string;
  /**
   * A/B test: extra subject / preview lines (variant B, C...). Variant A is
   * subject/preview_text above. Each enrolment gets one variant, picked
   * deterministically from (enrollment_id, step_index) and recorded on
   * email_sends.variant. A blank entry falls back to variant A's value.
   */
  subject_variants?: string[];
  preview_variants?: string[];
  /**
   * "designed" (default): branded PROMUNCH card layout.
   * "plain": personal founder-style note, no banner, left-aligned, optional
   * signature; still carries the unsubscribe footer + List-Unsubscribe headers.
   */
  format?: "designed" | "plain";
  /** Plain format only: sign-off lines, e.g. "Parth\nFounder, PROMUNCH". */
  signature?: string;
  /** Optional From display name, e.g. "Parth from PROMUNCH" (address unchanged). */
  from_name?: string;
  /**
   * Unique single-use Shopify code per enrolment (src/lib/email/coupons.ts).
   * Falls back to coupon_code if minting fails; an empty coupon_code means no
   * fallback exists (the engine defers the step and retries instead of
   * sending without a code). {{coupon_code}} in copy.
   */
  coupon?: { percent_off: number; expires_in_days?: number; prefix?: string };
  /**
   * Frequency-cap override. Default: only the first abandoned-cart email
   * bypasses the cap; every other step waits until the contact has had no
   * other marketing email for EMAIL_FREQ_CAP_HOURS (default 16h).
   */
  bypass_freq_cap?: boolean;
  /**
   * WhatsApp overlap guard. When set, the engine skips this email step (it
   * advances without sending) if WhatsApp already SENT the matching journey
   * to this customer: "review" = review_request, "replenishment" =
   * replenishment_reminder, "cart" = abandoned_checkout (wa_journey_runs).
   * Matched on the same order / checkout when the enrolment knows it, else any
   * such WhatsApp send in the last 30 days. See waJourneyOverlap in send-guards.ts.
   */
  skip_if_wa_journey?: "review" | "replenishment" | "cart";
};

export type FlowCategory =
  | "recover"
  | "welcome"
  | "retain"
  | "engage"
  | "deliverability";

export type FlowTemplate = {
  key: string;
  name: string;
  category: FlowCategory;
  description: string;
  trigger_type: FlowTrigger;
  trigger_config: Record<string, unknown>;
  steps: FlowStep[];
  /** True when the trigger needs data we do not collect yet (ships as Draft). */
  needsSetup?: boolean;
};

export const CATEGORY_LABELS: Record<FlowCategory, string> = {
  recover: "Recover lost sales",
  welcome: "Welcome & convert",
  retain: "Retain & grow",
  engage: "Engage & seasonal",
  deliverability: "Protect deliverability",
};

// ---- Copy building blocks ------------------------------------------------------
// Every designed body is built from brand-blocks.ts so all flows share one
// black-and-white PROMUNCH style: headline, short copy, ONE main button in the
// first screen, few images, never an image-only email. Founder notes use
// format:"plain" (text + the step's signature, rendered by plain-layout.ts).
//
// Facts used in copy, and where they were verified (2026-09-30):
//   - Master KB rules (AGENTS.md §5, docs/plans/2026-09-05-wa-bot-quality-audit.md):
//     Crunchies are roasted; Soya Sticks and Chips are FRIED; free shipping over
//     ₹599 (₹99 below), COD +₹50, prepaid 5% off.
//   - Roasted Edamame: 3 flavours, "roasted in olive oil" (Shopify product titles),
//     Protein per 100g (owner, 2026-09-30; matches KB pack labels): Himalayan
//     Rock Salt Edamame 45g, Indori Chatka + Masala Mania 42g. Across Edamame say
//     "42 to 45g". Olive oil = Edamame only.
//   - Assorted Flavored Pack 150g x 4 = Tangy Pudina, Peri Peri, Cheese & Onion,
//     Noodle Masala (Shopify product description).
//   - Serving ideas (salads, soups, wraps, sandwiches, ready to eat): promunch.in/pages/faqs.
//   - Reviews: real Judge.me reviews published on promunch.in, quoted verbatim.
//   - Every link and product image below returned HTTP 200 (curl -sI). Never
//     link the bare home page.
//
// Offers (owner, 2026-09-30): 15% is the floor (the public PROMUNCH10 already
// gives 10%). Abandoned cart and browse stay at 15% for the whole sequence,
// never 20% (it trains people to abandon, and on ₹599-749 carts 20% drops them
// below free shipping so they pay MORE). Welcome escalates to 20% at the end;
// win-back is 20% throughout. Every offer is a unique single-use Shopify
// code per enrolment (coupon field; idempotent per (enrolment, percent), so the
// 15% and 20% codes differ). coupon_code is "" on purpose: no static fallback
// code exists at 15/20%, so when minting fails the engine defers the step and
// retries rather than sending a wrong or missing code.
// Truthful expiry: every code lives about a day longer than the copy says.
//
// Tokens rendered by personalize.ts: {{first_name}}, {{checkout_url}} (cart only),
// {{cart_items}}, {{cart_total}}, {{coupon_code}}, {{product.title}},
// {{product.url}}, {{product_image}} (browse only).

const SITE = "https://promunch.in";
/** Link with UTM so flow revenue is attributable per flow + step. */
const link = (path: string, campaign: string, step: number) =>
  `${SITE}${path}?utm_source=email&utm_medium=flow&utm_campaign=${campaign}&utm_content=email_${step}`;

const PATHS = {
  all: "/collections/all",
  bestSellers: "/collections/best-sellers",
  combos: "/collections/combos-and-gift-packs",
  edamame: "/collections/roasted-edamame-beans-high-protein-healthy-snacks-for-weight-loss",
  faqs: "/pages/faqs",
  review: "/pages/review-submission",
} as const;

const CDN = "https://cdn.shopify.com/s/files/1/0794/6731/5501/files";

/** Real products (handles + first image from promunch.in/products.json). */
const PRODUCTS = {
  edamameCombo: {
    title: "Roasted Edamame Combo",
    path: "/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack",
    image: `${CDN}/AssortedCombo1.png?v=1781094598`,
  },
  edamameTravel: {
    title: "Edamame Travel Combo, 9 x 25g",
    path: "/products/promunch-roasted-edamame-beans-mini-combo-pack-of-9-25g-x-9-all-3-flavours",
    image: `${CDN}/ChatGPTImageJun16_2026_04_48_28PM_1.png?v=1788435089`,
  },
  edamameRockSalt: {
    title: "Himalayan Rock Salt Roasted Edamame",
    path: "/products/promunch-roasted-edamame-beans-himalayan-rock-salt-45g-high-protein-snack-no-added-sugar-rich-in-fiber-roasted-in-olive-oil-gluten-free",
    image: `${CDN}/HRS_Pack_of_3.jpg?v=1781850238`,
  },
  crunchies4: {
    title: "Soya Crunchies, 4 flavours",
    path: "/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each",
    image: `${CDN}/Image_4_jpg.jpg?v=1773731385`,
  },
  noodleMasala: {
    title: "Noodle Masala Soya Crunchies",
    path: "/products/promunch-roasted-soya-snack-vegan-high-protein-healthy-gluten-free-flavor-noodle-masala-300-g-pack-of-1",
    image: `${CDN}/Noodle_Masala_270g.png?v=1771656794`,
  },
  sticksChips: {
    title: "Soya Sticks + Chips Combo",
    path: "/products/promunch-combo-pack-soya-sticks-chatpata-masala-cream-onion-soya-chips-peri-peri-pack-of-3-80g-each",
    image: `${CDN}/Image_36_jpg.jpg?v=1773731324`,
  },
  bigBite: {
    title: "Big Bite Munch Combo",
    path: "/products/promunch-combo-pack-soya-sticks-soya-chips-80gm-assorted-flavored-soya-snack-150-gm-pack-of-7",
    image: `${CDN}/Image_46_jpg.jpg?v=1773731284`,
  },
} as const;

type ProductKey = keyof typeof PRODUCTS;
/** productGrid items with UTM links (no prices: they change, the page is the truth). */
const grid = (keys: ProductKey[], campaign: string, step: number) =>
  productGrid(keys.map((k) => ({ title: PRODUCTS[k].title, url: link(PRODUCTS[k].path, campaign, step), image: PRODUCTS[k].image })));

const hi = (rest: string) => p(`Hi {{first_name}}, ${rest}`);
/** Plain founder-style paragraphs (format: "plain"); plain-layout.ts adds the signature + footer. */
const PLAIN = (...paras: string[]) => paras.map((t) => `<p style="margin:0 0 14px;">${t}</p>`).join("");
const PARTH_SIG = "Parth\nFounder, PROMUNCH";
const PARTH_FROM = "Parth from PROMUNCH";
const CODE = "{{coupon_code}}";

// Real 5-star reviews from promunch.in (Judge.me widget on the Noodle Masala Soya
// Crunchies 270gm page), quoted exactly as published, names as displayed.
// Chosen over the Sep 12-16 2026 batch, see flag in the SQL plan doc.
const REVIEWS =
  reviewQuote(
    "Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?",
    "Sujay Thomas, on Noodle Masala Soya Crunchies",
    5,
  ) +
  reviewQuote(
    "Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.",
    "Naresh Saw, on Noodle Masala Soya Crunchies",
    5,
  );
const SHIPPING = p("Free shipping on orders over ₹599.");

export const FLOW_TEMPLATES: FlowTemplate[] = [
  // ==== Recover lost sales =====================================================
  {
    key: "abandoned_cart",
    name: "Abandoned cart",
    category: "recover",
    description: "Checkout started but not paid. 3 emails over 2 days: cart + a 15% unique code, a founder note, then a last call before that code expires. 15% only, never 20%. Uses the Super Money Breeze recovery link.",
    trigger_type: "checkout_abandoned",
    // deadline 54h: the last email lands at ~46h. The one 15% code, minted at
    // email 1, lives 3 days: "2 days" in email 1 and "ends tomorrow" in email 3
    // both stay true through a retry backoff.
    trigger_config: { deadline_hours: 54 },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0.75,
        subject: "{{first_name}}, your snacks are still waiting (15% off inside)",
        subject_variants: [
          "You left something crunchy behind. Here is 15% off",
          "{{first_name}}, we saved your cart and took 15% off",
        ],
        preview_text: "Your cart is saved and your own 15% code is inside. Good for 2 days.",
        preview_variants: ["Pick up right where you left off, with 15% off."],
        coupon: { percent_off: 15, expires_in_days: 3, prefix: "CART15" },
        coupon_code: "",
        // Order: why (headline) -> first-screen CTA -> what they left (big
        // photos) -> the saving in rupees -> the code -> CTA again -> proof.
        body_html:
          h1("Still craving that crunch?") +
          hi("your snacks are still in your cart. Finish your order in the next 2 days and your own 15% off code is on us.") +
          button("Complete my order", "{{checkout_url}}", "solid", { full: true }) +
          "{{cart_items}}" +
          "{{cart_summary}}" +
          couponBox(CODE, "Your 15% off code", "One use only. Enter it at checkout within 2 days.") +
          button("Complete my order", "{{checkout_url}}", "solid", { full: true }) +
          reviewQuote(
            "Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?",
            "Sujay Thomas, on Noodle Masala Soya Crunchies",
            5,
          ) +
          trustRow(["Free shipping over ₹599", "Cash on delivery available", "Questions? Just reply"]),
      },
      {
        // Owner, 2026-09-30: the bare plain-text version read as unbranded
        // with too much empty space. Now a founder LETTER inside the branded
        // card: Parth's voice and sender name, plus the cart, code and button.
        type: "email",
        format: "designed",
        from_name: PARTH_FROM,
        delay_hours: 21.25,
        subject: "A quick note from PROMUNCH's founder",
        subject_variants: ["{{first_name}}, can I ask you something?", "Why I started PROMUNCH (30 second read)"],
        preview_text: "Your cart is still saved, and your 15% code still works.",
        preview_variants: ["What stopped you? Honest answers welcome."],
        coupon: { percent_off: 15, expires_in_days: 3, prefix: "CART15" },
        coupon_code: "",
        body_html:
          eyebrow("A note from our founder") +
          h1("Can I ask you something?") +
          p("Hi {{first_name}},") +
          p("I'm Parth, founder of PROMUNCH. I noticed your cart is still sitting there, so I wanted to write to you myself.") +
          p("We started PROMUNCH because a snack in India usually meant fried namkeen or chips with very little protein. We wanted something crunchy that actually fills you up. That is what is waiting in your cart.") +
          p("If something stopped you, a price question, a flavour doubt, a glitch at checkout, <strong>just hit reply and tell me.</strong> The team and I read every reply.") +
          founderSignoff() +
          "{{cart_items}}" +
          couponBox(CODE, "Your 15% off code still works", "One use only. Enter it at checkout.") +
          button("Complete my order", "{{checkout_url}}", "solid", { full: true }),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 24,
        subject: "Last chance: your 15% off ends tomorrow",
        subject_variants: [
          "{{first_name}}, your cart and your 15% code expire tomorrow",
          "Final reminder: your PROMUNCH cart is still saved",
        ],
        preview_text: "Your 15% code {{coupon_code}} still works, but not for long.",
        preview_variants: ["This is the last email we will send about your cart."],
        // Owner, 2026-09-30: carts are 15% only, never 20%. Same percent as
        // email 1, so the engine reuses THAT code (one code per enrolment per
        // percent). Minted ~45min in, it lives 3 days, so at ~46h it has
        // ~1 day left: "ends tomorrow" stays true.
        coupon: { percent_off: 15, expires_in_days: 3, prefix: "CART15" },
        coupon_code: "",
        body_html:
          h1("Last call: your 15% off ends tomorrow") +
          hi("this is the last email we will send about your cart. Your 15% code still works, but only until tomorrow.") +
          button("Complete my order", "{{checkout_url}}", "solid", { full: true }) +
          "{{cart_items}}" +
          "{{cart_summary}}" +
          couponBox(CODE, "Your 15% off code", "One use only. Expires tomorrow.") +
          button("Complete my order", "{{checkout_url}}", "solid", { full: true }) +
          REVIEWS +
          trustRow(["Free shipping over ₹599", "Cash on delivery available", "Questions? Just reply"]),
      },
    ],
  },
  {
    key: "browse_abandonment",
    name: "Browse abandonment",
    category: "recover",
    description: "Viewed a product but did not buy. 3 emails: a no-discount reminder of the product, a founder note that introduces a 15% unique code, then a last call before it expires. Needs the storefront pixel.",
    trigger_type: "segment_entry",
    // Enrolled by email-browse-tick (>= 1h after the view), not the daily
    // segment tick. Copy uses {{product.title}}, {{product.url}} (fallback: Best
    // Sellers) and {{product_card}} (image dropped when there is none).
    trigger_config: { segment: "browse_abandon", exit_on_order: true },
    needsSetup: true,
    steps: [
      {
        // Owner, 2026-09-30: no discount in email 1. A viewer is colder than a
        // carter; many buy from the plain reminder, and an instant code trains
        // browse-and-wait. The 15% arrives in email 2.
        type: "email",
        format: "designed",
        delay_hours: 0,
        subject: "{{first_name}}, still thinking it over?",
        subject_variants: ["You had your eye on this one", "{{product.title}} is still here for you"],
        preview_text: "Here it is again, in case you want another look.",
        preview_variants: ["The snack you were checking out, and why people love it."],
        body_html:
          h1("Still thinking it over?") +
          hi("you were checking out this one. Here it is again, in case you want another look.") +
          "{{product_card}}" +
          button("Take another look", "{{product.url}}", "solid", { full: true }) +
          p("<strong>Why people love PROMUNCH:</strong> high-protein snacks that actually fill you up, honest labels (our Edamame is roasted in olive oil, our Soya Crunchies are roasted, our Sticks and Chips are fried, and we always tell you which is which), and free shipping on orders over ₹599.") +
          reviewQuote(
            "Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?",
            "Sujay Thomas, on Noodle Masala Soya Crunchies",
            5,
          ) +
          trustRow(["Free shipping over ₹599", "Cash on delivery available", "Questions? Just reply"]),
      },
      {
        // Founder letter (approved style, cart email 2) that INTRODUCES the
        // 15% code. Minted here on day 1, valid 3 days, so email 3 on day 3
        // can truthfully say "ends tomorrow".
        type: "email",
        format: "designed",
        from_name: PARTH_FROM,
        delay_hours: 24,
        subject: "A quick note from PROMUNCH's founder",
        subject_variants: ["{{first_name}}, a little something from our founder", "15% off {{product.title}}, from me"],
        preview_text: "I saw you looking at {{product.title}}. Here is 15% off it.",
        preview_variants: ["A personal note, and 15% off just for you."],
        coupon: { percent_off: 15, expires_in_days: 3, prefix: "LOOK15" },
        coupon_code: "",
        body_html:
          eyebrow("A note from our founder") +
          h1("Here is 15% off, from me") +
          p("Hi {{first_name}},") +
          p("I'm Parth, founder of PROMUNCH. I saw you looking at <strong>{{product.title}}</strong>, so I wanted to write to you myself.") +
          p("We started PROMUNCH because a snack in India usually meant fried namkeen or chips with very little protein. We wanted something crunchy that actually fills you up, and we are honest about how each one is made: our Edamame is roasted in olive oil, our Soya Crunchies are roasted, and our Sticks and Chips are fried.") +
          p("Not sure about a flavour? <strong>Just hit reply</strong> and tell me what you like, spicy, tangy or light and salty, and I will point you to the right pack. To make it easy to try, here is 15% off, just for you.") +
          founderSignoff() +
          divider() +
          "{{product_card}}" +
          couponBox(CODE, "Your 15% off code", "One use only. Valid for 3 days.") +
          button("Get it for 15% off", "{{product.url}}", "solid", { full: true }),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Last chance: your 15% off ends tomorrow",
        subject_variants: ["{{first_name}}, your 15% code expires tomorrow", "Still thinking about {{product.title}}?"],
        preview_text: "Your 15% code still works, but only until tomorrow.",
        preview_variants: ["This is the last email about it."],
        // Same percent as email 2, so the engine reuses THAT code (minted day
        // 1, valid 3 days): at day 3 "ends tomorrow" is true.
        coupon: { percent_off: 15, expires_in_days: 3, prefix: "LOOK15" },
        coupon_code: "",
        body_html:
          h1("Your 15% off ends tomorrow") +
          hi("this is the last email about it. Your 15% code still works, but only until tomorrow.") +
          "{{product_card}}" +
          button("Get it for 15% off", "{{product.url}}", "solid", { full: true }) +
          couponBox(CODE, "Your 15% off code", "One use only. Expires tomorrow.") +
          REVIEWS +
          p(`Not quite right? <a href="${link(PATHS.bestSellers, "browse_abandon", 3)}">See our Best Sellers</a>.`) +
          trustRow(["Free shipping over ₹599", "Cash on delivery available", "Questions? Just reply"]),
      },
    ],
  },

  // ==== Welcome & convert ======================================================
  {
    key: "welcome",
    name: "Welcome series",
    category: "welcome",
    description: "Popup signup to first order: 5 emails over 8 days. 15% unique code, founder note, first picks, free shipping + reviews, then a final 20% offer. Stops the moment they order.",
    trigger_type: "customer_created",
    // 15% code minted in email 1 lives 8 days (copy: 7). Email 5 (day 8)
    // mints a separate 20% code that lives 3 days (copy: 48 hours).
    // exit_on_checkout defaults to true here: the cart flow takes over.
    trigger_config: { exit_on_order: true },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0,
        bypass_freq_cap: true,
        subject: "Welcome to PROMUNCH, here is 15% off",
        subject_variants: ["Your 15% welcome code is inside", "{{first_name}}, welcome to the crunchy side"],
        preview_text: "Your code {{coupon_code}} is ready. Good for 7 days.",
        preview_variants: ["15% off your first order, plus our promise to you."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "WELCOME15" },
        coupon_code: "",
        body_html:
          // Same finish as the approved cart/browse emails: offer + full-width
          // CTA in the first screen, then the founder story (Forbes photo) and
          // the promise, then whitelisting + socials (relationship email).
          h1("Welcome to PROMUNCH") +
          hi("welcome to savoury snacks with real protein in them. To say hello, here is 15% off your first order.") +
          couponBox(CODE, "15% off your first order", "One use only. Valid for 7 days.") +
          button("Shop Best Sellers", link(PATHS.bestSellers, "welcome", 1), "solid", { full: true }) +
          divider() +
          eyebrow("Why we started PROMUNCH") +
          photo("https://admin.promunch.in/email/parth-forbes.jpg", "Parth Mutha, founder of PROMUNCH, at the Forbes Under 30 Summit Asia", "Me at the Forbes Under 30 Summit Asia in Bangkok") +
          // Brand story (owner, 2026-09-30): the problem is the savoury snack
          // aisle, plenty of options, almost none with real protein. Say
          // "almost none", never "no snack has as much" (ASCI: absolute
          // comparative claims must be provable).
          // First person, Parth's voice (owner, 2026-09-30). No sign-off block
          // here (owner): the photo + "Hi, I'm Parth" already say who it is.
          p("Hi, I'm Parth. Walk down any snack aisle in India and you will find plenty of savoury snacks, but almost none that give you real protein. Most are fried namkeen and chips that taste great for ten minutes and do nothing for your body.") +
          p("I started PROMUNCH in 2021 to fix that: savoury, crunchy snacks with serious protein in every pack. Our Roasted Edamame packs <strong>42 to 45g of protein per 100g</strong>. In 2025, building it put me on the <strong>Forbes 30 Under 30 Asia</strong> list, but the best part is still hearing from people who finally found a snack they do not feel guilty about.") +
          p("<strong>My promise to you:</strong> real protein, honest labels (our Edamame is roasted in olive oil, our Soya Crunchies are roasted, our Sticks and Chips are fried, and we always tell you which is which), and free shipping on orders over ₹599.") +
          divider() +
          p("One small thing: add <strong>hello@promunch.in</strong> to your contacts so our emails, and your code, land in your inbox and not in spam.") +
          socialRow(),
      },
      {
        // Owner, 2026-09-30: welcome 1 already tells the founder story, so day
        // 2 is Parth's "what to try first" guide (founder-letter style). Sorted
        // by what you want, facts only (protein figures owner-confirmed).
        type: "email",
        format: "designed",
        from_name: PARTH_FROM,
        delay_hours: 48,
        subject: "Not sure what to try first? Here is my pick",
        subject_variants: ["{{first_name}}, which PROMUNCH is right for you?", "A quick guide from our founder"],
        preview_text: "Pick by what you are in the mood for. Your 15% code is still active.",
        preview_variants: ["Most protein, namkeen crunch or chip cravings? Start here."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "WELCOME15" },
        coupon_code: "",
        body_html:
          eyebrow("A note from our founder") +
          h1("Not sure what to try first?") +
          p("Hi {{first_name}}, Parth here. The question I get most is \"where do I start?\" So here is how I would pick:") +
          p(`<strong>Want the most protein?</strong> Go for our <a href="${link(PRODUCTS.edamameRockSalt.path, "welcome", 2)}">Roasted Edamame</a>, roasted in olive oil, with 42 to 45g of protein per 100g.`) +
          p(`<strong>Love a namkeen-style crunch?</strong> Try our <a href="${link(PRODUCTS.crunchies4.path, "welcome", 2)}">Soya Crunchies</a>, roasted, in Noodle Masala, Peri Peri, Tangy Pudina and Cheese &amp; Onion.`) +
          p(`<strong>Craving chips?</strong> Our <a href="${link(PRODUCTS.sticksChips.path, "welcome", 2)}">Soya Sticks and Chips</a> are fried, for that classic chip crunch.`) +
          p(`<strong>Can't decide?</strong> The <a href="${link(PRODUCTS.edamameCombo.path, "welcome", 2)}">Roasted Edamame Combo</a> has all three flavours. Or just hit reply and tell me what you like, I will point you to the right pack.`) +
          founderSignoff() +
          divider() +
          grid(["edamameCombo", "crunchies4", "sticksChips"], "welcome", 2) +
          couponBox(CODE, "Your 15% welcome code is still active", "One use only. Valid for 5 more days.") +
          button("Shop Best Sellers", link(PATHS.bestSellers, "welcome", 2), "solid", { full: true }),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Not sure what to try first?",
        subject_variants: ["The PROMUNCH packs people start with", "{{first_name}}, your 15% code has 3 days left"],
        preview_text: "Three easy first picks, and your code {{coupon_code}}.",
        preview_variants: ["3 days left on your welcome code."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "WELCOME15" },
        coupon_code: "",
        body_html:
          h1("Three easy first picks") +
          hi("not sure where to start? These are a good first order. Your 15% code has 3 days left.") +
          button("Shop Best Sellers", link(PATHS.bestSellers, "welcome", 3)) +
          grid(["edamameCombo", "crunchies4", "edamameTravel"], "welcome", 3) +
          couponBox(CODE, "Your welcome code", "15% off. 3 days left."),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Free shipping on orders over ₹599",
        subject_variants: ["{{first_name}}, here is how to get free shipping", "What PROMUNCH customers are saying"],
        preview_text: "Plus what real customers say about the crunch.",
        preview_variants: ["A combo gets you there in one go."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "WELCOME15" },
        coupon_code: "",
        body_html:
          h1("Free shipping over ₹599") +
          hi("every order over ₹599 ships free. A combo is the easiest way to get there, and you get to try more flavours in one go.") +
          button("See combos", link(PATHS.combos, "welcome", 4)) +
          REVIEWS +
          p("Your 15% welcome code <strong>{{coupon_code}}</strong> is still active for about a day."),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Last chance: we made it 20% off",
        subject_variants: ["{{first_name}}, one last welcome gift: 20% off", "Your final welcome offer: 20% off"],
        preview_text: "Our best welcome offer, good for 48 hours.",
        preview_variants: ["This is the last reminder about your welcome offer."],
        coupon: { percent_off: 20, expires_in_days: 3, prefix: "WELCOME20" },
        coupon_code: "",
        body_html:
          h1("One last welcome gift: 20% off") +
          hi("your welcome offer is ending, so here is our best one: 20% off your first order, good for the next 48 hours. This is the last reminder we will send about it.") +
          couponBox(CODE, "20% off your first order", "One use. Valid for 48 hours.") +
          button("Use my 20% now", link(PATHS.all, "welcome", 5)) +
          p("Why people stick with PROMUNCH: 42 to 45g of protein per 100g in our Roasted Edamame, ready to eat straight from the pack, and great on salads and soups too."),
      },
    ],
  },
  {
    key: "post_purchase",
    name: "Post-purchase",
    category: "welcome",
    description: "First order only. A human thank-you (no order details, Shopify and WhatsApp already confirm), then a how-to guide with the FAQ. Reviews have their own flow.",
    trigger_type: "order_placed",
    trigger_config: { first_order_only: true },
    steps: [
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 0.25,
        bypass_freq_cap: true,
        subject: "Thank you, {{first_name}} (this is not a receipt)",
        subject_variants: ["A quick thank you from a real human at PROMUNCH", "You just made our day, {{first_name}}"],
        preview_text: "No order details here, just a thank you.",
        preview_variants: ["Parth here, founder of PROMUNCH."],
        body_html: PLAIN(
          "Hi {{first_name}},",
          "Parth here, I'm the founder of PROMUNCH. Your order confirmation is already with you, so this is not another receipt. I just wanted to say thank you.",
          "You picked a small Indian snack brand to try, and that genuinely means a lot to us.",
          "One tip while you wait: once a pack is open, seal it tight so the crunch stays crunchy.",
          "If anything is not right with your order, just reply to this email and we will sort it out.",
        ),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 71.75,
        subject: "How to get the most out of your PROMUNCH",
        subject_variants: ["5 ways to enjoy your PROMUNCH snacks", "Your PROMUNCH questions, answered"],
        preview_text: "Storage, serving ideas and the protein facts.",
        preview_variants: ["A 1 minute guide to your snacks."],
        body_html:
          h1("Your 1 minute snack guide") +
          hi("here is how to get the most out of your PROMUNCH.") +
          button("Read our FAQs", link(PATHS.faqs, "post_purchase", 2)) +
          p("<strong>Keep it crunchy.</strong> Once a pack is open, seal it tight or tip it into an airtight jar, and keep it somewhere cool and dry.") +
          p("<strong>Ways to enjoy it.</strong> Straight from the pack, on a salad or a bowl of soup, tucked into wraps and sandwiches, or in your bag for the office and after a workout.") +
          p("<strong>What is in the pack.</strong> Roasted Edamame: roasted in olive oil, with 42 to 45g of protein per 100g depending on the flavour. Soya Crunchies: roasted, not fried. Soya Sticks and Chips: fried, for a classic chip crunch.") +
          p("Anything else? Reply to this email and a real person will answer.") +
          socialRow(),
      },
    ],
  },

  // ==== Retain & grow ==========================================================
  {
    key: "replenishment",
    name: "Replenishment",
    category: "retain",
    description: "Every order. Around day 25, a running-low reminder with Best Sellers and a 15% unique code, then one reminder on day 32. Skipped when WhatsApp already sent the refill reminder.",
    trigger_type: "order_placed",
    // A new order exits the running reminder (then enrols a fresh one for the
    // new order). 15% code lives 9 days (copy: 7), email 2 says "tomorrow".
    // WhatsApp's replenishment_reminder fires at day 30, after email 1.
    trigger_config: { exit_on_order: true },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 600,
        skip_if_wa_journey: "replenishment",
        subject: "Running low on PROMUNCH?",
        subject_variants: ["{{first_name}}, time for a refill?", "Restock before you run out (15% off)"],
        preview_text: "15% off your refill with code {{coupon_code}}. Good for 7 days.",
        preview_variants: ["Your favourites, 15% off this week."],
        coupon: { percent_off: 15, expires_in_days: 9, prefix: "REFILL15" },
        coupon_code: "",
        body_html:
          h1("Running low?") +
          hi("it has been a few weeks since your order, so your stash might be getting light. Here is 15% off your refill.") +
          couponBox(CODE, "15% off your refill", "One use. Valid for 7 days.") +
          button("Restock now", link(PATHS.bestSellers, "replenishment", 1)) +
          p("<strong>From our Best Sellers</strong>") +
          grid(["edamameRockSalt", "crunchies4", "bigBite"], "replenishment", 1) +
          SHIPPING,
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 168,
        skip_if_wa_journey: "replenishment",
        subject: "Your 15% refill code ends tomorrow",
        subject_variants: ["{{first_name}}, last day tomorrow for 15% off", "A quick reminder about your refill code"],
        preview_text: "Code {{coupon_code}} stops working after tomorrow.",
        preview_variants: ["This is the last reminder about it."],
        coupon: { percent_off: 15, expires_in_days: 9, prefix: "REFILL15" },
        coupon_code: "",
        body_html:
          h1("Your refill code ends tomorrow") +
          hi("just a heads up: your 15% code stops working after tomorrow. This is the last reminder about it.") +
          couponBox(CODE, "15% off your refill", "One use. Ends tomorrow.") +
          button("Restock now", link(PATHS.bestSellers, "replenishment", 2)) +
          SHIPPING,
      },
    ],
  },
  {
    key: "cross_sell",
    name: "Cross-sell",
    category: "retain",
    description: "First order only. Around day 18, suggest another kind of PROMUNCH to try. No discount. Stops if they order again first.",
    trigger_type: "order_placed",
    trigger_config: { first_order_only: true, exit_on_order: true },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 432,
        subject: "Ready to try another flavour?",
        subject_variants: ["{{first_name}}, your next favourite might be here", "Three PROMUNCH snacks worth a try"],
        preview_text: "Roasted edamame, roasted crunchies, or fried sticks and chips.",
        preview_variants: ["Three different ways to crunch."],
        body_html:
          h1("Try something new next time") +
          hi("thanks again for your first PROMUNCH order. If you liked it, here are three different ways to crunch.") +
          button("Shop all snacks", link(PATHS.all, "cross_sell", 1)) +
          grid(["edamameCombo", "crunchies4", "sticksChips"], "cross_sell", 1) +
          p("<strong>Roasted Edamame:</strong> roasted in olive oil, with 42 to 45g of protein per 100g depending on the flavour. <strong>Soya Crunchies:</strong> roasted, in Tangy Pudina, Peri Peri, Cheese &amp; Onion and Noodle Masala. <strong>Soya Sticks and Chips:</strong> fried, for a classic chip crunch.") +
          SHIPPING,
      },
    ],
  },
  {
    key: "win_back",
    name: "Win-back",
    category: "retain",
    description: "No order in 60 days. We-miss-you + 20% unique code, a founder follow-up, then a last call before the code expires. Stops on order.",
    trigger_type: "segment_entry",
    // 20% code minted in email 1 lives 9 days (copy: 7); email 3 lands on day 7
    // and says "tomorrow".
    trigger_config: { segment: "winback", days_since_last_order: 60, exit_on_order: true },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0,
        subject: "We miss you, {{first_name}}. Here is 20% off",
        subject_variants: ["It has been a while. 20% off to come back", "Come back to PROMUNCH (20% off inside)"],
        preview_text: "Your code {{coupon_code}} is good for 7 days.",
        preview_variants: ["A comeback code, just for you."],
        coupon: { percent_off: 20, expires_in_days: 9, prefix: "COMEBACK20" },
        coupon_code: "",
        body_html:
          h1("We miss you") +
          hi("it has been a couple of months since your last PROMUNCH order. Come back for 20% off, on us.") +
          couponBox(CODE, "20% off, welcome back", "One use. Valid for 7 days.") +
          button("Shop Best Sellers", link(PATHS.bestSellers, "winback", 1)) +
          p(`Have you tried our <a href="${link(PATHS.edamame, "winback", 1)}">Roasted Edamame</a>? Himalayan Rock Salt (45g of protein per 100g), Indori Chatka and Masala Mania (42g each), all roasted in olive oil.`) +
          SHIPPING,
      },
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 72,
        subject: "Did we do something wrong, {{first_name}}?",
        subject_variants: ["A quick question from PROMUNCH's founder", "{{first_name}}, can I ask why?"],
        preview_text: "Honest feedback welcome. Your 20% code is still active.",
        preview_variants: ["One line is enough."],
        coupon: { percent_off: 20, expires_in_days: 9, prefix: "COMEBACK20" },
        coupon_code: "",
        body_html: PLAIN(
          "Hi {{first_name}},",
          "Parth here, founder of PROMUNCH. You have not ordered in a while, and I would genuinely like to know why.",
          "Was it the taste, the price, the delivery, or did you just forget about us? Reply with one line. The team and I read every reply, and it helps us fix things.",
          `If you just forgot, your 20% code <b>{{coupon_code}}</b> is still active for a few more days. <a href="${link(PATHS.all, "winback", 2)}">Here is everything we make</a>.`,
        ),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 96,
        subject: "Last chance: your 20% off ends tomorrow",
        subject_variants: ["{{first_name}}, your comeback code expires tomorrow", "Final reminder: 20% off PROMUNCH"],
        preview_text: "After tomorrow this code stops working.",
        preview_variants: ["This is the last email about this offer."],
        coupon: { percent_off: 20, expires_in_days: 9, prefix: "COMEBACK20" },
        coupon_code: "",
        body_html:
          h1("Your 20% off ends tomorrow") +
          hi("your comeback code stops working after tomorrow. This is the last email we will send about it.") +
          couponBox(CODE, "20% off, last day tomorrow", "One use.") +
          button("Shop Best Sellers", link(PATHS.bestSellers, "winback", 3)) +
          REVIEWS,
      },
    ],
  },
  {
    key: "vip_reward",
    name: "VIP thank-you",
    category: "retain",
    description: "Customers with ₹2,000+ lifetime spend or 3+ orders. A founder thank-you, then the full range and an invite to shape the next flavour. No discount. Keeps running if they order.",
    trigger_type: "segment_entry",
    // Once ever per contact (dedup vip:<contact>). exit_on_order:false, or the
    // VIP's next order would cut their thank-you short.
    trigger_config: { segment: "vip", min_spend: 2000, min_orders: 3, exit_on_order: false },
    steps: [
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 0,
        subject: "Thank you, {{first_name}}. Really.",
        subject_variants: ["You are one of our regulars", "A thank you from PROMUNCH's founder"],
        preview_text: "No sale, no code. Just a thank you.",
        preview_variants: ["Parth here, founder of PROMUNCH."],
        body_html: PLAIN(
          "Hi {{first_name}},",
          "Parth here, founder of PROMUNCH. You are one of the people who keeps coming back to PROMUNCH, and I wanted to say thank you personally.",
          "A small brand like ours lives on regulars like you. Every reorder tells us we are getting something right.",
          "Since you know our snacks better than most, I would love your take: which flavour should we make next, and what would you change? Just hit reply. The team and I read every reply, and it shapes what we make next.",
        ),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 168,
        subject: "For our regulars: the full PROMUNCH range",
        subject_variants: ["{{first_name}}, have you tried the whole range?", "Your next favourite, from PROMUNCH"],
        preview_text: "Edamame, Crunchies, Sticks and Chips, all in one place.",
        preview_variants: ["And a chance to pick our next flavour."],
        body_html:
          h1("Have you tried the whole range?") +
          hi("as one of our regulars, here is everything PROMUNCH makes, in one place.") +
          button("See the full range", link(PATHS.all, "vip", 2)) +
          grid(["edamameCombo", "crunchies4", "sticksChips"], "vip", 2) +
          p("Got a flavour idea? Reply to this email and tell us. Ideas from our regulars go straight to the team.") +
          socialRow(),
      },
    ],
  },

  // ==== Engage =================================================================
  {
    key: "review_request",
    name: "Review request",
    category: "engage",
    description: "Every order. Around day 8, ask for a review on promunch.in, with one reminder on day 12. Skipped when WhatsApp already sent the review ask.",
    trigger_type: "order_placed",
    // WhatsApp review_request fires at day 7; skip_if_wa_journey makes the
    // email the fallback for customers WhatsApp did not reach. A new order
    // exits the pending ask (and enrols a fresh one for the new order).
    trigger_config: { exit_on_order: true },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 192,
        skip_if_wa_journey: "review",
        subject: "{{first_name}}, how were your snacks?",
        subject_variants: ["Got a minute? We would love your review", "Be honest: what did you think?"],
        preview_text: "A short review takes about a minute.",
        preview_variants: ["Good or bad, we want to hear it."],
        body_html:
          h1("How were your snacks?") +
          hi("your PROMUNCH should be with you by now. How was it? A short review takes about a minute and helps other snackers pick the right pack.") +
          button("Leave a review", link(PATHS.review, "review_request", 1)) +
          p("Something not right? Reply to this email instead and we will fix it.") +
          socialRow(),
      },
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 96,
        skip_if_wa_journey: "review",
        subject: "One small favour, {{first_name}}?",
        subject_variants: ["Would you rate your PROMUNCH?", "A minute of your time?"],
        preview_text: "A quick review helps a small brand a lot.",
        preview_variants: ["Parth here, one quick ask."],
        body_html: PLAIN(
          "Hi {{first_name}},",
          "Parth here, founder of PROMUNCH. If you have a minute, would you leave a quick review of your order? Reviews are how new snackers find us, and they help us a lot.",
          `<a href="${link(PATHS.review, "review_request", 2)}">Leave a review here</a>.`,
          "Already did it? Thank you, you can ignore this email.",
        ),
      },
    ],
  },
  {
    key: "first_order_anniversary",
    name: "First-order anniversary",
    category: "engage",
    description: "On the anniversary of a customer's first order, a thank-you with a 15% unique code.",
    trigger_type: "date_based",
    // 15% code lives 8 days (copy: 7).
    trigger_config: { kind: "first_order_anniversary" },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0,
        subject: "Happy PROMUNCH anniversary, {{first_name}}",
        subject_variants: ["On this day, you placed your first PROMUNCH order", "{{first_name}}, it is our anniversary (15% off inside)"],
        preview_text: "15% off to celebrate. Good for 7 days.",
        preview_variants: ["A thank you, and a code to celebrate."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "ANNIV15" },
        coupon_code: "",
        body_html:
          h1("Happy PROMUNCH anniversary") +
          hi("on this day you placed your first PROMUNCH order. Thank you for snacking with us. Here is 15% off to celebrate.") +
          couponBox(CODE, "15% off, to celebrate", "One use. Valid for 7 days.") +
          button("Treat myself", link(PATHS.bestSellers, "anniversary", 1)) +
          SHIPPING +
          socialRow(),
      },
    ],
  },

  // ==== Protect deliverability =================================================
  {
    key: "sunset_unengaged",
    name: "Sunset unengaged",
    category: "deliverability",
    description: "5+ marketing emails in 90 days and no open or click. One email: keep me subscribed, or unsubscribe. No discount. Protects sender reputation.",
    trigger_type: "segment_entry",
    // A click on "keep me subscribed" counts as engagement, so they drop out
    // of the sunset segment. Auto-suppressing non-responders is NOT wired yet
    // (shouldSuppressAfterSunset in segment-triggers.ts), so copy promises
    // nothing about removing them.
    trigger_config: { segment: "sunset", min_sends: 5, lookback_days: 90 },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0,
        subject: "Should we stop emailing you, {{first_name}}?",
        subject_variants: ["Do you still want to hear from PROMUNCH?", "Quick question about your inbox"],
        preview_text: "One tap to stay. Or unsubscribe, no hard feelings.",
        preview_variants: ["We only want to be in your inbox if you want us there."],
        body_html:
          h1("Should we stop emailing you?") +
          hi("we noticed you have not opened our emails in a while. We only want to be in your inbox if you want us there.") +
          button("Yes, keep me subscribed", link(PATHS.all, "sunset", 1)) +
          p("Tap the button and you stay on the list. It opens our store, no need to buy anything.") +
          p("Not for you anymore? Use the unsubscribe link at the bottom of this email. One tap and you are off the list, no hard feelings."),
      },
    ],
  },
];

/** The flows shipped in the 2026-09-30 content pack (docs/plans/2026-09-30-email-flow-content.sql). */
export const V1_FLOW_KEYS = [
  "abandoned_cart",
  "welcome",
  "browse_abandonment",
  "post_purchase",
  "review_request",
  "replenishment",
  "cross_sell",
  "win_back",
  "vip_reward",
  "sunset_unengaged",
  "first_order_anniversary",
] as const;

export function templateByKey(key: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.key === key);
}
