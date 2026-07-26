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

export const FLOW_TEMPLATES: FlowTemplate[] = [
  // ---- Recover lost sales ---------------------------------------------------
  {
    key: "abandoned_cart",
    name: "Abandoned cart",
    category: "recover",
    description: "Checkout started but not paid. A reminder, then a coupon. Uses the Super Money Breeze recovery link.",
    trigger_type: "checkout_abandoned",
    trigger_config: { coupon_code: "PROMUNCH10", deadline_hours: 72 },
    steps: [
      {
        type: "email",
        delay_hours: 1,
        subject: "Your PROMUNCH cart is waiting",
        body_html: p("<p>Hi there,</p><p>You left some munchies behind. Your cart is still saved, so you can pick up right where you left off.</p><p><a href=\"{{checkout_url}}\">Finish your order</a></p><p>Free shipping over ₹599. Your Munchy Pal is holding your snacks.</p>"),
      },
      {
        type: "email",
        delay_hours: 5,
        subject: "A little something to finish your order",
        coupon_code: "PROMUNCH10",
        body_html: p("<p>Still thinking it over?</p><p>Here is 10% off to seal the deal. Use code <b>PROMUNCH10</b> at checkout.</p><p><a href=\"{{checkout_url}}\">Complete my order</a></p><p>Free shipping over ₹599.</p>"),
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
    description: "Viewed a product but never added it to cart. One reminder.",
    trigger_type: "segment_entry",
    trigger_config: {},
    needsSetup: true,
    steps: [
      { type: "email", delay_hours: 4, subject: "Still curious about that snack?", body_html: p("<p>You were checking out one of our munchies. Here it is again if you want another look.</p>") },
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
    description: "New subscriber intro, discount, brand story and bestsellers over a few days.",
    trigger_type: "customer_created",
    trigger_config: { coupon_code: "WELCOME10" },
    steps: [
      {
        type: "email",
        delay_hours: 0,
        subject: "Welcome to PROMUNCH, here is 10% off",
        coupon_code: "WELCOME10",
        body_html: p("<p>Welcome to the club!</p><p>PROMUNCH makes high-protein roasted soya snacks that actually taste good. As a thank you for joining, here is 10% off your first order with code <b>WELCOME10</b>.</p><p><a href=\"https://promunch.in\">Start snacking</a></p><p>Free shipping over ₹599. Your Munchy Pal.</p>"),
      },
      {
        type: "email",
        delay_hours: 48,
        subject: "The story behind your munchies",
        body_html: p("<p>PROMUNCH started with a simple idea: a snack you can feel good about eating every day. High protein, big crunch, real ingredients.</p><p>Our Crunchies are roasted, not fried. Give them a try.</p>"),
      },
      {
        type: "email",
        delay_hours: 72,
        subject: "The munchies everyone reorders",
        body_html: p("<p>Not sure where to start? These are the flavours our customers keep coming back for.</p><p><a href=\"https://promunch.in\">Shop bestsellers</a></p>"),
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
    description: "Thank the buyer, share tips, then ask for a review and cross-sell.",
    trigger_type: "order_placed",
    trigger_config: {},
    steps: [
      {
        type: "email",
        delay_hours: 48,
        subject: "How to get the most out of your munchies",
        body_html: p("<p>Thanks for your order! A quick tip: PROMUNCH is great on its own, over salads, or as a protein-packed travel snack.</p><p>Enjoy every crunch. Your Munchy Pal.</p>"),
      },
      {
        type: "email",
        delay_hours: 168,
        subject: "How are we doing?",
        body_html: p("<p>You have had a week with your munchies. We would love a quick review.</p><p><a href=\"https://promunch.in/pages/review-submission\">Leave a review</a></p><p>While you are here, here are a few flavours you have not tried yet.</p>"),
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
      { type: "email", delay_hours: 720, subject: "Running low on munchies?", body_html: p("<p>It has been about a month. Time to restock your PROMUNCH before you run out.</p><p><a href=\"https://promunch.in\">Reorder now</a></p>") },
    ],
  },
  {
    key: "win_back",
    name: "Win-back",
    category: "retain",
    description: "No order in 45 to 120 days. A we-miss-you note, then a comeback offer.",
    trigger_type: "segment_entry",
    trigger_config: { coupon_code: "COMEBACK15" },
    steps: [
      {
        type: "email",
        delay_hours: 0,
        subject: "We miss you at PROMUNCH",
        body_html: p("<p>It has been a while! Your munchies are still here whenever you are ready.</p>"),
      },
      {
        type: "email",
        delay_hours: 72,
        subject: "Here is 15% off to welcome you back",
        coupon_code: "COMEBACK15",
        body_html: p("<p>Come back for a crunch. Use code <b>COMEBACK15</b> for 15% off your next order.</p><p><a href=\"https://promunch.in\">Shop now</a></p><p>Free shipping over ₹599.</p>"),
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
      { type: "email", delay_hours: 0, subject: "Do you still want to hear from us?", body_html: p("<p>We have not seen you open our emails in a while. Want to keep getting PROMUNCH news and offers?</p><p><a href=\"https://promunch.in\">Yes, keep me in</a></p>") },
      { type: "email", delay_hours: 168, subject: "Last call before we say goodbye", body_html: p("<p>If we do not hear from you, we will stop emailing to respect your inbox. You can always rejoin from our website.</p>") },
    ],
  },
];

/** The four flows shipped live in v1. */
export const V1_FLOW_KEYS = ["abandoned_cart", "welcome", "post_purchase", "win_back"] as const;

export function templateByKey(key: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.key === key);
}
