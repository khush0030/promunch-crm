// Pre-built flow templates for the "Create flow" gallery (Klaviyo-style).
// "Use template" inserts a flows row pre-filled with these steps; everything is
// editable afterwards in the builder. The four v1 flows (abandoned cart,
// welcome, post-purchase, win-back) carry full branded copy; the rest ship as
// editable starting points.
//
// Copy rules (AGENTS.md §5): PROMUNCH all caps, no em dashes, tagline
// "Your Munchy Pal", never mention Oltaflock. Body HTML here is the INNER
// content; renderMarketingEmail() wraps it with the header + unsubscribe footer
// at send time. Shipping: free over ₹599.

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
   * Falls back to coupon_code if minting fails. {{coupon_code}} in copy.
   */
  coupon?: { percent_off: number; expires_in_days?: number; prefix?: string };
  /**
   * Frequency-cap override. Default: only the first abandoned-cart email
   * bypasses the cap; every other step waits until the contact has had no
   * other marketing email for EMAIL_FREQ_CAP_HOURS (default 16h).
   */
  bypass_freq_cap?: boolean;
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

const p = (html: string) => html; // readability helper

// ---- Copy building blocks for the v1 sequences --------------------------------
// Styles are inline (email clients strip <style>). Palette mirrors layout.ts.
//
// Facts used in copy, and where they were verified (2026-09-30):
//   - Master KB rules (AGENTS.md §5, docs/plans/2026-09-05-wa-bot-quality-audit.md):
//     Crunchies are roasted; Soya Sticks and Chips are FRIED; only Tangy Pudina
//     Crunchies is Jain; free shipping over ₹599 (₹99 below), COD +₹50, prepaid 5% off.
//   - Roasted Edamame: 3 flavours, "roasted in olive oil" (Shopify product titles),
//     42.9 to 45.3 g protein per 100 g (KB pack labels), so copy says "over 40g".
//   - Serving ideas (salads, soups, wraps, sandwiches, ready to eat): promunch.in/pages/faqs.
//   - Reviews: real Judge.me reviews published on promunch.in, quoted verbatim.
//   - Every link below returned HTTP 200. Never link the bare home page.
// Tokens rendered by flow-engine.ts: {{first_name}}, {{checkout_url}} (cart only),
// {{cart_items}}, {{cart_total}}, {{coupon_code}}.

const SITE = "https://promunch.in";
/** Link with UTM so flow revenue is attributable per flow + step. */
const link = (path: string, campaign: string, step: number) =>
  `${SITE}${path}?utm_source=email&utm_medium=flow&utm_campaign=${campaign}&utm_content=email_${step}`;

const PATHS = {
  all: "/collections/all",
  bestSellers: "/collections/best-sellers",
  combos: "/collections/combos-and-gift-packs",
  edamame: "/collections/roasted-edamame-beans-high-protein-healthy-snacks-for-weight-loss",
  crunchies: "/collections/soya-crunchies",
  faqs: "/pages/faqs",
  review: "/pages/review-submission",
  edamameCombo: "/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack",
  edamameTravel: "/products/promunch-roasted-edamame-beans-mini-combo-pack-of-9-25g-x-9-all-3-flavours",
  noodleMasala: "/products/promunch-roasted-soya-snack-vegan-high-protein-healthy-gluten-free-flavor-noodle-masala-300-g-pack-of-1",
  assorted4: "/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each",
} as const;

const P = (t: string) => `<p style="font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;">${t}</p>`;
const MUTED = (t: string) => `<p style="font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;">${t}</p>`;
const H = (t: string) => `<p style="font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;">${t}</p>`;
const LIST = (items: string[]) =>
  `<ul style="font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;">${items.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join("")}</ul>`;
const BTN = (href: string, label: string, accent = false) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr><td style="background:${accent ? "#E0A24E" : "#1B2A20"};border-radius:10px;"><a href="${href}" style="display:inline-block;padding:14px 28px;color:${accent ? "#1B2A20" : "#ffffff"};font-size:16px;font-weight:800;text-decoration:none;">${label}</a></td></tr></table>`;
const CODE = (headline: string, note: string) =>
  `<div style="margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;"><div style="font-size:12px;color:#6E665A;letter-spacing:1px;">${headline}</div><div style="font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;">{{coupon_code}}</div><div style="font-size:12px;color:#6E665A;margin-top:6px;">${note}</div></div>`;
const QUOTE = (text: string, who: string) =>
  `<div style="margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;"><div style="font-size:13px;color:#E0A24E;letter-spacing:2px;">★★★★★</div><div style="font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;">"${text}"</div><div style="font-size:13px;color:#6E665A;">${who}</div></div>`;
/** Plain founder-style paragraphs (format: "plain"); plain-layout.ts adds the footer. */
const PLAIN = (...paras: string[]) => paras.map((t) => `<p style="margin:0 0 14px;">${t}</p>`).join("");
const PARTH_SIG = "Parth\nFounder, PROMUNCH";
const PARTH_FROM = "Parth from PROMUNCH";

// Real 5-star reviews from promunch.in (Judge.me widget on the Noodle Masala Soya
// Crunchies 270gm page), quoted exactly as published, names as displayed.
// Chosen over the Sep 12-16 2026 batch, see flag in the SQL plan doc.
const REVIEWS = QUOTE(
  "Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?",
  "Sujay Thomas, on Noodle Masala Soya Crunchies",
) + QUOTE(
  "Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.",
  "Naresh Saw, on Noodle Masala Soya Crunchies",
);
const REVIEWS_BLOCK = H("What snackers say") + REVIEWS + MUTED("Real reviews from promunch.in.");

export const FLOW_TEMPLATES: FlowTemplate[] = [
  // ---- Recover lost sales ---------------------------------------------------
  {
    key: "abandoned_cart",
    name: "Abandoned cart",
    category: "recover",
    description: "Checkout started but not paid. 3 emails over 2 days: cart + 10% unique code, a founder note, then a last call before the code expires. Uses the Super Money Breeze recovery link.",
    trigger_type: "checkout_abandoned",
    // deadline 54h: the last email lands at ~46h. The unique code is minted at
    // email 1 (~45 min) and lives 3 days, so "expires in about a day" in email 3
    // stays true even after a 6h retry backoff.
    trigger_config: { coupon_code: "PROMUNCH10", deadline_hours: 54 },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0.75,
        subject: "{{first_name}}, your cart is saved (plus 10% off)",
        subject_variants: [
          "You left something behind. Here is 10% off it",
          "[Saved for you] Your PROMUNCH cart and a 10% code",
        ],
        preview_text: "Your code {{coupon_code}} takes 10% off. Good for 3 days.",
        preview_variants: ["Pick up right where you left off, 10% off is on us."],
        coupon: { percent_off: 10, expires_in_days: 3, prefix: "CART" },
        coupon_code: "PROMUNCH10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("You were one step away from your snacks, so we saved your cart for you. Here is what is in it:") +
          "{{cart_items}}" +
          CODE("10% OFF, JUST FOR YOU", "One use. Enter it at checkout within 3 days.") +
          BTN("{{checkout_url}}", "Finish my order") +
          MUTED("Free shipping on orders over ₹599.") +
          MUTED("Stuck at checkout? Just reply to this email and a real person will help."),
        ),
      },
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 21.25,
        subject: "A quick note from PROMUNCH's founder",
        subject_variants: ["{{first_name}}, can I ask you something?", "Why I started PROMUNCH (30 second read)"],
        preview_text: "And your 10% code is still waiting for you.",
        preview_variants: ["What stopped you? Honest answers welcome."],
        coupon: { percent_off: 10, expires_in_days: 3, prefix: "CART" },
        coupon_code: "PROMUNCH10",
        body_html: p(PLAIN(
          "Hi {{first_name}},",
          "I'm Parth, I started PROMUNCH. I noticed your cart is still sitting there, so I wanted to write to you myself.",
          "We started PROMUNCH because a snack in India usually meant fried namkeen or chips with very little protein. We wanted something crunchy that actually fills you up. That is what is waiting in your cart: high-protein soya and edamame snacks.",
          "If something stopped you, a price question, a flavour doubt, a glitch at checkout, just hit reply and tell me. The team and I read every reply.",
          "Your 10% code still works: <b>{{coupon_code}}</b>",
          "<a href=\"{{checkout_url}}\">Here is your cart</a> whenever you are ready.",
        )),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 24,
        subject: "Last chance: your 10% code expires soon",
        subject_variants: ["{{first_name}}, your 10% code runs out in about a day", "Final reminder about your PROMUNCH cart"],
        preview_text: "This is the last email we will send about your cart.",
        preview_variants: ["After this, your code stops working."],
        coupon: { percent_off: 10, expires_in_days: 3, prefix: "CART" },
        coupon_code: "PROMUNCH10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("This is the last email we will send about your cart. Your 10% code expires in about a day, and after that it will not work.") +
          CODE("YOUR CODE, EXPIRING SOON", "10% off. One use.") +
          "{{cart_items}}" +
          BTN("{{checkout_url}}", "Grab my snacks", true) +
          REVIEWS_BLOCK +
          MUTED("Free shipping on orders over ₹599. Questions? Reply and we will help."),
        ),
      },
    ],
  },
  {
    key: "cart_reminder",
    name: "Cart reminder, no discount",
    category: "recover",
    description: "A single gentle nudge that protects your margin. No coupon.",
    trigger_type: "checkout_abandoned",
    trigger_config: { deadline_hours: 48 },
    steps: [
      {
        type: "email",
        delay_hours: 3,
        subject: "You left your munchies behind",
        body_html: p("<p>Your PROMUNCH cart is still saved. Ready when you are.</p><p><a href=\"{{checkout_url}}\">Finish checkout</a></p>"),
      },
    ],
  },
  {
    key: "browse_abandonment",
    name: "Browse abandonment",
    category: "recover",
    description: "Viewed a product but did not buy. 3 emails: the product + 10% unique code, a founder note, then a last call with bestsellers.",
    trigger_type: "segment_entry",
    // email-browse-tick already waits >= 1h after the view, so step 1 is instant.
    // Context tokens {{product.title}} / {{product.url}} / {{product_image}} are
    // rendered by the engine with fallbacks (url -> best-sellers collection,
    // image -> nothing). The code lives 4 days so email 3 (~72h) is honest.
    trigger_config: { segment: "browse_abandon", coupon_code: "PROMUNCH10" },
    needsSetup: true,
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0,
        subject: "{{first_name}}, still thinking it over?",
        subject_variants: ["You had your eye on this one", "A 10% code for the snack you were checking out"],
        preview_text: "{{product.title}}, now 10% off with your own code.",
        preview_variants: ["Here it is again, with 10% off for the next 4 days."],
        coupon: { percent_off: 10, expires_in_days: 4, prefix: "LOOK" },
        coupon_code: "PROMUNCH10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("You were checking out <b>{{product.title}}</b>. Here it is again, in case you want another look.") +
          "{{product_image}}" +
          CODE("10% OFF, JUST FOR YOU", "One use. Valid for 4 days.") +
          BTN("{{product.url}}", "Take another look") +
          MUTED("Free shipping on orders over ₹599."),
        ),
      },
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 24,
        subject: "Why people pick PROMUNCH",
        subject_variants: ["{{first_name}}, a quick note from our founder", "The honest version of what we make"],
        preview_text: "Roasted where it matters, and a lot of protein per bite.",
        preview_variants: ["Your 10% code is still active."],
        coupon: { percent_off: 10, expires_in_days: 4, prefix: "LOOK" },
        coupon_code: "PROMUNCH10",
        body_html: p(PLAIN(
          "Hi {{first_name}},",
          "Parth here, founder of PROMUNCH. I saw you looking at {{product.title}}, so here is the honest version of what we make.",
          "Our Roasted Edamame is roasted in olive oil and has over 40g of protein per 100g. Our Soya Crunchies are roasted too. Our Soya Sticks and Chips are fried, for when you want that classic chip crunch.",
          "All of it is ready to eat straight from the pack, and it works on salads and soups too.",
          "If you are unsure about a flavour, reply and tell me what you like, spicy, tangy or light and salty, and I will point you to the right pack.",
          "Your 10% code is still active: <b>{{coupon_code}}</b>. <a href=\"{{product.url}}\">Here is the product again</a>.",
        )),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Last chance: your 10% code expires soon",
        subject_variants: ["{{first_name}}, your code runs out in about a day", "Before your 10% goes, see our Best Sellers"],
        preview_text: "After this, your code stops working.",
        preview_variants: ["Plus the packs people keep coming back for."],
        coupon: { percent_off: 10, expires_in_days: 4, prefix: "LOOK" },
        coupon_code: "PROMUNCH10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("Your 10% code expires in about a day. This is the last email about it.") +
          CODE("YOUR CODE, EXPIRING SOON", "10% off. One use.") +
          BTN("{{product.url}}", "Back to {{product.title}}", true) +
          H("Or start with our Best Sellers") +
          LIST([
            `<a href="${link(PATHS.edamameCombo, "browse_abandon", 3)}" style="color:#1B2A20;font-weight:700;">Roasted Edamame Combo</a>: all three flavours, roasted in olive oil`,
            `<a href="${link(PATHS.assorted4, "browse_abandon", 3)}" style="color:#1B2A20;font-weight:700;">Assorted Flavored Pack, 150g x 4</a>: roasted Soya Crunchies in four flavours`,
          ]) +
          BTN(link(PATHS.bestSellers, "browse_abandon", 3), "Shop Best Sellers") +
          REVIEWS_BLOCK,
        ),
      },
    ],
  },
  {
    key: "price_drop",
    name: "Price drop alert",
    category: "recover",
    description: "An item they viewed just got cheaper. Fires when the price changes.",
    trigger_type: "segment_entry",
    trigger_config: {},
    needsSetup: true,
    steps: [
      { type: "email", delay_hours: 0, subject: "Good news, the price just dropped", body_html: p("<p>Something you had your eye on is now cheaper. Grab it before it is gone.</p>") },
    ],
  },

  // ---- Welcome & convert ----------------------------------------------------
  {
    key: "welcome",
    name: "Welcome series",
    category: "welcome",
    description: "Popup signup to first order: 5 emails over 8 days. 10% unique code, founder note, Best Sellers, free-shipping angle with reviews, final reminder. Stops the moment they order.",
    trigger_type: "customer_created",
    // The unique code is minted in email 1 and lives 9 days, so every expiry
    // line below is true: "5 days left" on day 4, "expires tomorrow" on day 8.
    trigger_config: { coupon_code: "WELCOME10", exit_on_order: true },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0,
        // They just asked for the code on the popup: never hold it behind the cap.
        bypass_freq_cap: true,
        subject: "Welcome to PROMUNCH, here is 10% off",
        subject_variants: ["Your 10% welcome code is inside", "{{first_name}}, welcome to the crunchy side"],
        preview_text: "Your code {{coupon_code}} is ready, plus our promise to you.",
        preview_variants: ["10% off your first order, good for 9 days."],
        coupon: { percent_off: 10, expires_in_days: 9, prefix: "WELCOME" },
        coupon_code: "WELCOME10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("Welcome to PROMUNCH. We make high-protein snacks for people who want their snack to actually do something for them. Here is your welcome gift:") +
          CODE("10% OFF YOUR FIRST ORDER", "One use. Valid for 9 days.") +
          BTN(link(PATHS.bestSellers, "welcome", 1), "Shop Best Sellers") +
          H("Our promise to you") +
          LIST([
            "<b>Real protein.</b> Our Roasted Edamame has over 40g of protein per 100g.",
            "<b>Honest labels.</b> Our Soya Crunchies and Edamame are roasted. Our Sticks and Chips are fried, and we will always tell you which is which.",
            "<b>Big flavour.</b> Noodle Masala, Tangy Pudina, Peri Peri and Cheese &amp; Onion Crunchies, plus Edamame in Himalayan Rock Salt, Indori Chatka and Masala Mania.",
            "<b>Fair shipping.</b> Free on orders over ₹599.",
          ]) +
          MUTED("One small thing: add <b>hello@promunch.in</b> to your contacts so our emails, and your code, land in your inbox and not in spam."),
        ),
      },
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 48,
        subject: "Hi {{first_name}}, it's Parth from PROMUNCH",
        subject_variants: ["A quick hello from our founder", "Thanks for joining us, {{first_name}}"],
        preview_text: "Why we make PROMUNCH, in a few lines.",
        preview_variants: ["Not sure what to try first? Ask me."],
        coupon: { percent_off: 10, expires_in_days: 9, prefix: "WELCOME" },
        coupon_code: "WELCOME10",
        body_html: p(PLAIN(
          "Hi {{first_name}},",
          "I'm Parth, the founder of PROMUNCH. Thank you for joining us.",
          "Quick story. We started PROMUNCH because snacking in India mostly meant fried namkeen and chips. Tasty, but with very little protein. We wanted a crunchy snack you could reach for every day and feel good about.",
          "If you are not sure where to start, reply and tell me what you like, spicy, tangy or light and salty, and I will point you to the right pack.",
          `And if you just want to dive in, your 10% code <b>{{coupon_code}}</b> is still active. <a href="${link(PATHS.bestSellers, "welcome", 2)}">Here are our Best Sellers</a>.`,
        )),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Your 10% code is still waiting (5 days left)",
        subject_variants: ["The PROMUNCH packs people start with", "{{first_name}}, do not let your 10% go to waste"],
        preview_text: "Our Best Sellers, and your code {{coupon_code}}.",
        preview_variants: ["5 days left on your welcome code."],
        coupon: { percent_off: 10, expires_in_days: 9, prefix: "WELCOME" },
        coupon_code: "WELCOME10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("Not sure what to try first? Start with a pick from our Best Sellers. Your welcome code has 5 days left.") +
          LIST([
            `<a href="${link(PATHS.edamameCombo, "welcome", 3)}" style="color:#1B2A20;font-weight:700;">Roasted Edamame Combo</a>: all three flavours, roasted in olive oil, over 40g protein per 100g`,
            `<a href="${link(PATHS.assorted4, "welcome", 3)}" style="color:#1B2A20;font-weight:700;">Assorted Flavored Pack, 150g x 4</a>: roasted Soya Crunchies in four flavours`,
            `<a href="${link(PATHS.edamameTravel, "welcome", 3)}" style="color:#1B2A20;font-weight:700;">Edamame Travel Combo, pack of 9</a>: 25g packs made for your bag`,
          ]) +
          CODE("YOUR WELCOME CODE", "10% off. 5 days left.") +
          BTN(link(PATHS.bestSellers, "welcome", 3), "Shop Best Sellers", true),
        ),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Free shipping on orders over ₹599",
        subject_variants: ["{{first_name}}, here is how to get free shipping", "What PROMUNCH customers are saying"],
        preview_text: "Plus what real customers say about the crunch.",
        preview_variants: ["A combo gets you there in one go."],
        coupon: { percent_off: 10, expires_in_days: 9, prefix: "WELCOME" },
        coupon_code: "WELCOME10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("Every order over ₹599 ships free. The easiest way to get there is a combo, so you get to try more flavours in one go.") +
          BTN(link(PATHS.combos, "welcome", 4), "See combos") +
          REVIEWS_BLOCK +
          MUTED("Your welcome code <b>{{coupon_code}}</b> has 3 days left."),
        ),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 48,
        subject: "Last chance: your 10% code expires tomorrow",
        subject_variants: ["{{first_name}}, your welcome code ends tomorrow", "One last thing before your code expires"],
        preview_text: "After tomorrow it stops working. Here is why people stick with PROMUNCH.",
        preview_variants: ["This is the last reminder about your code."],
        coupon: { percent_off: 10, expires_in_days: 9, prefix: "WELCOME" },
        coupon_code: "WELCOME10",
        body_html: p(
          P("Hi {{first_name}},") +
          P("Your 10% welcome code expires tomorrow. This is the last reminder we will send about it.") +
          CODE("LAST DAY TOMORROW", "10% off your first order. One use.") +
          H("Why people stick with PROMUNCH") +
          LIST([
            "Over 40g of protein per 100g in our Roasted Edamame, roasted in olive oil.",
            "Ready to eat straight from the pack, at your desk, in the car or after a workout.",
            "Great on salads and soups, or tucked into wraps and sandwiches.",
            "Free shipping on every order over ₹599.",
          ]) +
          P("We started PROMUNCH to make a crunchy snack you can feel good about every day. We would love for you to try it.") +
          BTN(link(PATHS.all, "welcome", 5), "Use my 10% now", true) +
          MUTED("Parth and the PROMUNCH team"),
        ),
      },
    ],
  },
  {
    key: "first_order_thanks",
    name: "First-order thank you",
    category: "welcome",
    description: "Welcome a brand new customer and make them feel part of the club.",
    trigger_type: "order_placed",
    trigger_config: { first_order_only: true },
    steps: [
      { type: "email", delay_hours: 2, subject: "Thank you for your first PROMUNCH order", body_html: p("<p>Your munchies are on the way. Welcome to the PROMUNCH family.</p>") },
    ],
  },
  {
    key: "second_purchase",
    name: "Second-purchase nudge",
    category: "welcome",
    description: "Turn a one-time buyer into a repeat customer.",
    trigger_type: "segment_entry",
    trigger_config: {},
    needsSetup: true,
    steps: [
      { type: "email", delay_hours: 240, subject: "Ready for round two?", body_html: p("<p>Hope you loved your munchies. Here is an easy way to restock your favourites.</p>") },
    ],
  },
  {
    key: "free_shipping_nudge",
    name: "Free-shipping nudge",
    category: "welcome",
    description: "Cart under ₹599. Show how close they are to free shipping.",
    trigger_type: "checkout_abandoned",
    trigger_config: {},
    needsSetup: true,
    steps: [
      { type: "email", delay_hours: 2, subject: "You are almost at free shipping", body_html: p("<p>Add a little more to your cart and shipping is on us over ₹599.</p><p><a href=\"{{checkout_url}}\">Back to my cart</a></p>") },
    ],
  },

  // ---- Retain & grow --------------------------------------------------------
  {
    key: "post_purchase",
    name: "Post-purchase",
    category: "retain",
    description: "First order only. A human thank-you (no order details, Shopify and WhatsApp already confirm), a how-to guide, a review ask, then a 3-question reply survey.",
    trigger_type: "order_placed",
    trigger_config: { first_order_only: true },
    steps: [
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 0.25,
        // Often follows a cart email by minutes; the thank-you should not wait 16h.
        bypass_freq_cap: true,
        subject: "Thank you, {{first_name}} (this is not a receipt)",
        subject_variants: ["A quick thank you from a real human at PROMUNCH", "You just made our day, {{first_name}}"],
        preview_text: "No order details here, just a thank you.",
        preview_variants: ["Parth here, founder of PROMUNCH."],
        body_html: p(PLAIN(
          "Hi {{first_name}},",
          "Parth here, I'm the founder of PROMUNCH. Your order confirmation is already with you, so this is not another receipt. I just wanted to say thank you.",
          "You picked a small Indian snack brand to try, and that genuinely means a lot to us. Somewhere in our office a small cheer just went up. (Okay, it was me.)",
          "One tip while you wait: once a pack is open, seal it tight so the crunch stays crunchy.",
          "If anything is not right with your order, just reply to this email and we will sort it out.",
        )),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 71.75,
        subject: "How to get the most out of your PROMUNCH",
        subject_variants: ["5 ways to enjoy your PROMUNCH snacks", "Your PROMUNCH questions, answered"],
        preview_text: "Storage, serving ideas and the protein facts.",
        preview_variants: ["A 1 minute guide to your snacks."],
        body_html: p(
          P("Hi {{first_name}},") +
          P("Your snacks are on their way or already open. Here is the short guide.") +
          H("Keep it crunchy") +
          LIST([
            "Once a pack is open, seal it tight or tip it into an airtight jar.",
            "Keep it somewhere cool and dry, away from direct sunlight.",
          ]) +
          H("Ways to enjoy it") +
          LIST([
            "Straight from the pack. It is ready to eat, no cooking needed.",
            "On a salad or a bowl of soup for extra crunch.",
            "Tucked into wraps and sandwiches.",
            "In your bag for travel, the office or after a workout.",
          ]) +
          H("The protein facts") +
          LIST([
            "<b>Roasted Edamame:</b> over 40g of protein per 100g, roasted in olive oil.",
            "<b>Soya Crunchies:</b> roasted, not fried. Only Tangy Pudina is Jain friendly.",
            "<b>Soya Sticks and Chips:</b> fried, for when you want a classic chip crunch.",
          ]) +
          BTN(link(PATHS.faqs, "post_purchase", 2), "Read our FAQs") +
          MUTED("Anything else? Reply to this email and a real person will answer."),
        ),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 168,
        subject: "{{first_name}}, how were your snacks?",
        subject_variants: ["Got a minute? We would love your review", "Be honest: what did you think?"],
        preview_text: "Your review helps other snackers pick the right pack.",
        preview_variants: ["Good or bad, we want to hear it."],
        body_html: p(
          P("Hi {{first_name}},") +
          P("You have had your PROMUNCH for a little while now. How was it? A short review takes about a minute and helps other snackers pick the right pack.") +
          BTN(link(PATHS.review, "post_purchase", 3), "Leave a review", true) +
          P("Got a photo of your snacks? Post it on Instagram and tag <b>@promunch.snacks</b>. We love seeing where PROMUNCH ends up.") +
          MUTED("Something not right? Reply to this email instead and we will fix it."),
        ),
      },
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 96,
        subject: "3 quick questions (just hit reply)",
        subject_variants: ["Can I ask you 3 things, {{first_name}}?", "Help us make PROMUNCH better"],
        preview_text: "A word or two for each is plenty.",
        preview_variants: ["Parth here, 30 seconds of your time?"],
        body_html: p(PLAIN(
          "Hi {{first_name}},",
          "Parth again. Now that you have tried PROMUNCH, could you answer three quick questions? Just hit reply, a word or two each is plenty.",
          "1. How did you first hear about PROMUNCH?<br>2. What almost stopped you from ordering?<br>3. Which flavour or product should we make next?",
          "The team reads every reply, and your answers shape what we make next.",
          "Thank you.",
        )),
      },
    ],
  },
  {
    key: "replenishment",
    name: "Replenishment reminder",
    category: "retain",
    description: "Nudge a reorder around the typical refill cycle.",
    trigger_type: "order_placed",
    trigger_config: {},
    steps: [
      { type: "email", delay_hours: 720, subject: "Running low on munchies?", body_html: p("<p>It has been about a month. Time to restock your PROMUNCH before you run out.</p><p><a href=\"https://promunch.in/collections/all?utm_source=email&utm_medium=flow&utm_campaign=replenishment\">Reorder now</a></p>") },
    ],
  },
  {
    key: "win_back",
    name: "Win-back",
    category: "retain",
    description: "No order in 60 days. We-miss-you + 15% unique code and what is new, a founder follow-up, then a last call before the code expires. Stops on order.",
    trigger_type: "segment_entry",
    // Code minted in email 1 lives 8 days; email 3 lands on day 7 ("tomorrow").
    trigger_config: { segment: "winback", days_since_last_order: 60, coupon_code: "COMEBACK15", exit_on_order: true },
    steps: [
      {
        type: "email",
        format: "designed",
        delay_hours: 0,
        subject: "We miss you, {{first_name}}. Here is 15% off",
        subject_variants: ["It has been a while. 15% off to come back", "What is new at PROMUNCH (and 15% off)"],
        preview_text: "Your code {{coupon_code}} is good for 8 days.",
        preview_variants: ["A comeback code, just for you."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "COMEBACK" },
        coupon_code: "COMEBACK15",
        body_html: p(
          P("Hi {{first_name}},") +
          P("It has been a couple of months since your last PROMUNCH order, and we miss you. So here is a bigger thank you than usual:") +
          CODE("15% OFF, WELCOME BACK", "One use. Valid for 8 days.") +
          H("What is new") +
          LIST([
            `<a href="${link(PATHS.edamame, "winback", 1)}" style="color:#1B2A20;font-weight:700;">Roasted Edamame</a> in Himalayan Rock Salt, Indori Chatka and Masala Mania. Roasted in olive oil, over 40g of protein per 100g.`,
            `<a href="${link(PATHS.edamameTravel, "winback", 1)}" style="color:#1B2A20;font-weight:700;">Edamame Travel Combo</a>: nine 25g packs across all three flavours, made for your bag.`,
          ]) +
          BTN(link(PATHS.edamame, "winback", 1), "See what is new") +
          MUTED("Free shipping on orders over ₹599."),
        ),
      },
      {
        type: "email",
        format: "plain",
        from_name: PARTH_FROM,
        signature: PARTH_SIG,
        delay_hours: 72,
        subject: "Did we do something wrong, {{first_name}}?",
        subject_variants: ["A quick question from PROMUNCH's founder", "{{first_name}}, can I ask why?"],
        preview_text: "Honest feedback welcome. Your 15% code is still active.",
        preview_variants: ["One line is enough."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "COMEBACK" },
        coupon_code: "COMEBACK15",
        body_html: p(PLAIN(
          "Hi {{first_name}},",
          "Parth here, founder of PROMUNCH. You have not ordered in a while, and I would genuinely like to know why.",
          "Was it the taste, the price, the delivery, or did you just forget about us? Reply with one line. The team and I read every reply, and it helps us fix things.",
          `If you just forgot, your 15% code <b>{{coupon_code}}</b> is still active for a few more days. <a href="${link(PATHS.all, "winback", 2)}">Here is everything we make</a>.`,
        )),
      },
      {
        type: "email",
        format: "designed",
        delay_hours: 96,
        subject: "Last chance: your 15% off ends tomorrow",
        subject_variants: ["{{first_name}}, your comeback code expires tomorrow", "Final reminder: 15% off PROMUNCH"],
        preview_text: "After tomorrow this code stops working.",
        preview_variants: ["This is the last email about this offer."],
        coupon: { percent_off: 15, expires_in_days: 8, prefix: "COMEBACK" },
        coupon_code: "COMEBACK15",
        body_html: p(
          P("Hi {{first_name}},") +
          P("Your 15% comeback code expires tomorrow. This is the last email we will send about it.") +
          CODE("LAST DAY TOMORROW", "15% off. One use.") +
          BTN(link(PATHS.bestSellers, "winback", 3), "Shop Best Sellers", true) +
          REVIEWS_BLOCK,
        ),
      },
    ],
  },
  {
    key: "vip_reward",
    name: "VIP reward",
    category: "retain",
    description: "Recognise your 3+ order customers with a members-only perk.",
    trigger_type: "segment_entry",
    trigger_config: {},
    steps: [
      { type: "email", delay_hours: 0, subject: "A little thank you, from us to you", body_html: p("<p>You are one of our favourite munchers. Here is an early look and a members-only treat.</p>") },
    ],
  },
  {
    key: "back_in_stock",
    name: "Back-in-stock alert",
    category: "retain",
    description: "Customer asked to be notified when a sold-out flavour returns.",
    trigger_type: "segment_entry",
    trigger_config: {},
    needsSetup: true,
    steps: [
      { type: "email", delay_hours: 0, subject: "It is back in stock", body_html: p("<p>Good news, the flavour you wanted is back. Grab it before it sells out again.</p>") },
    ],
  },
  {
    key: "referral",
    name: "Referral invite",
    category: "retain",
    description: "Ask happy customers to share PROMUNCH with a friend.",
    trigger_type: "segment_entry",
    trigger_config: {},
    steps: [
      { type: "email", delay_hours: 0, subject: "Share the crunch with a friend", body_html: p("<p>Love your munchies? Share PROMUNCH with a friend and you both get a treat.</p>") },
    ],
  },

  // ---- Engage & seasonal ----------------------------------------------------
  {
    key: "review_request",
    name: "Review request",
    category: "engage",
    description: "A few days after delivery, ask for a rating.",
    trigger_type: "order_placed",
    trigger_config: {},
    steps: [
      { type: "email", delay_hours: 120, subject: "How were your munchies?", body_html: p("<p>We would love to hear what you thought.</p><p><a href=\"https://promunch.in/pages/review-submission\">Leave a quick review</a></p>") },
    ],
  },
  {
    key: "delivered_followup",
    name: "Order delivered follow-up",
    category: "engage",
    description: "Confirm it arrived and open the door to support.",
    trigger_type: "order_placed",
    trigger_config: {},
    needsSetup: true,
    steps: [
      { type: "email", delay_hours: 24, subject: "Did your munchies arrive safely?", body_html: p("<p>Your order should have arrived. If anything is not right, just reply and we will sort it out.</p>") },
    ],
  },
  {
    key: "birthday",
    name: "Birthday treat",
    category: "engage",
    description: "A small discount on their birthday.",
    trigger_type: "date_based",
    trigger_config: {},
    needsSetup: true,
    steps: [
      { type: "email", delay_hours: 0, subject: "Happy birthday from PROMUNCH", body_html: p("<p>Happy birthday! Here is a little treat to celebrate. Enjoy on us.</p>") },
    ],
  },
  {
    key: "seasonal",
    name: "Festival & seasonal",
    category: "engage",
    description: "Diwali, Republic Day, gifting hampers. Clone each occasion.",
    trigger_type: "segment_entry",
    trigger_config: {},
    steps: [
      { type: "email", delay_hours: 0, subject: "A seasonal treat from PROMUNCH", body_html: p("<p>Celebrate the season with our gifting hampers and festive favourites.</p>") },
      { type: "email", delay_hours: 72, subject: "Last chance for the festive munchies", body_html: p("<p>The season is almost over. Grab your hampers before they are gone.</p>") },
    ],
  },
  {
    key: "product_education",
    name: "Product education",
    category: "engage",
    description: "How to enjoy PROMUNCH, pairings and recipes.",
    trigger_type: "customer_created",
    trigger_config: {},
    steps: [
      { type: "email", delay_hours: 96, subject: "5 ways to enjoy your munchies", body_html: p("<p>From salad toppers to on-the-go protein, here are our favourite ways to munch.</p>") },
      { type: "email", delay_hours: 168, subject: "Did you know our Crunchies are roasted?", body_html: p("<p>Our Crunchies are roasted, not fried. Here is what makes them different.</p>") },
    ],
  },

  // ---- Protect deliverability ----------------------------------------------
  {
    key: "sunset_unengaged",
    name: "Sunset unengaged",
    category: "deliverability",
    description: "Ask subscribers who have not opened in months to re-confirm, then suppress the rest. Keeps sender reputation clean.",
    trigger_type: "segment_entry",
    trigger_config: {},
    steps: [
      { type: "email", delay_hours: 0, subject: "Do you still want to hear from us?", body_html: p("<p>We have not seen you open our emails in a while. Want to keep getting PROMUNCH news and offers?</p><p><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=sunset\">Yes, keep me in</a></p>") },
      { type: "email", delay_hours: 168, subject: "Last call before we say goodbye", body_html: p("<p>If we do not hear from you, we will stop emailing to respect your inbox. You can always rejoin from our website.</p>") },
    ],
  },
];

/** The four flows shipped live in v1. */
export const V1_FLOW_KEYS = ["abandoned_cart", "welcome", "post_purchase", "win_back"] as const;

export function templateByKey(key: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.key === key);
}
