// Plain-English glossary for the WhatsApp marketing screens.
//
// Written for a non-technical marketer. Rules for every entry (enforced by
// glossary.test.ts): no em dashes, brand is always PROMUNCH in caps, every
// key has a non-empty `plain` line. `customerEffect` answers "what does the
// customer actually see or feel?" and is shown after "For the customer:".
//
// Consumed by <HelpTip term="..."> and <GlossaryTerm k="...">.

export type GlossaryKey =
  | "template"
  | "marketing"
  | "utility"
  | "approval"
  | "opted_in"
  | "window_24h"
  | "marketing_cap"
  | "held_back"
  | "daily_budget"
  | "meta_tier"
  | "quiet_hours"
  | "fair_use"
  | "automation"
  | "trigger"
  | "wait"
  | "blank_variable"
  | "stop_footer"
  | "rfm_segment"
  | "warm_audience"
  | "engaged_audience"
  | "delivered"
  | "read"
  | "reply"
  | "click"
  | "attributed_order"
  | "test_send"
  | "header_media"
  | "quality_rating"
  | "retarget"
  | "followup"
  | "journey";

export type GlossaryEntry = {
  /** Display name of the term, sentence case. */
  term: string;
  /** One or two plain sentences: what it is, in marketer language. */
  plain: string;
  /** What the customer experiences because of it. Shown as "For the customer: ...". */
  customerEffect?: string;
  /** Optional in-app link for more detail (next/link href). */
  learnMoreHref?: string;
};

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  template: {
    term: "Template",
    plain:
      "A pre-written WhatsApp message that Meta has checked and approved. We need one to message anyone who has not written to us in the last 24 hours.",
    customerEffect: "They get a neat, branded message from PROMUNCH, with any buttons or images you added.",
  },
  marketing: {
    term: "Marketing message",
    plain:
      "Anything promotional: offers, new flavours, restock news, reminders to buy again. Meta limits how many of these people receive.",
    customerEffect: "It arrives with a note that they can reply STOP to stop getting offers.",
  },
  utility: {
    term: "Utility message",
    plain:
      "Order or service information only, like an order confirmation or a shipping update. It must not contain any offer or sales push, or Meta will reclassify it as marketing.",
    customerEffect: "They get useful updates about their own order, even if they never opted in to offers.",
  },
  approval: {
    term: "Meta approval",
    plain:
      "Every template has to be approved by Meta before we can send it. This usually takes a few minutes and can take up to 24 hours.",
    customerEffect: "Nothing yet. Customers only see a template after it is approved.",
  },
  opted_in: {
    term: "Opted in",
    plain:
      "This person has agreed to receive WhatsApp messages from PROMUNCH and has not replied STOP. Only opted-in people get marketing.",
    customerEffect: "They hear from us only because they said yes.",
  },
  window_24h: {
    term: "24-hour window",
    plain:
      "After a customer messages us, we can reply with normal free text (no template needed) for the next 24 hours. After that, we need an approved template.",
    customerEffect: "Replies inside the window feel like a natural chat, not a broadcast.",
  },
  marketing_cap: {
    term: "Marketing limit",
    plain:
      "Each person gets at most 1 marketing message per day from us, counted across all campaigns and automations combined.",
    customerEffect: "Nobody gets flooded with offers, even if they are in several campaigns.",
  },
  held_back: {
    term: "Held back by Meta",
    plain:
      "Meta may choose not to deliver a marketing message to someone who has not been engaging with brands lately (error 131049). It is not a fault on our side. We wait 24 hours before trying that person again.",
    customerEffect: "They simply do not receive that message. Nothing looks broken on their phone.",
  },
  daily_budget: {
    term: "Daily sending budget",
    plain:
      "How many messages we can send today. It is the lower of Meta's limit and our own limit, and it is shared with order messages like confirmations.",
    customerEffect: "Order updates are never crowded out, and big campaigns spread over a few days.",
  },
  meta_tier: {
    term: "Meta messaging limit",
    plain:
      "The number of different people Meta lets our WhatsApp number start conversations with each day. It grows as we send good-quality messages that people engage with.",
  },
  quiet_hours: {
    term: "Quiet hours",
    plain:
      "We never send marketing between 9 PM and 9 AM (India time). Anything scheduled in that gap waits until 9 AM.",
    customerEffect: "No late-night or early-morning offers buzzing their phone.",
  },
  fair_use: {
    term: "Fair use rules",
    plain:
      "The guard rails that keep our WhatsApp number healthy: 1 marketing message per person per day, quiet hours, opted-in people only, and a STOP option on every offer.",
    customerEffect: "PROMUNCH feels like a friendly brand, not spam.",
  },
  automation: {
    term: "Automation",
    plain:
      "A message flow that runs by itself when something happens, like an abandoned cart or a first order. Set it up once and it keeps working.",
    customerEffect: "They get a timely, relevant message without anyone on the team pressing send.",
  },
  trigger: {
    term: "Trigger",
    plain: "The event that starts an automation for a person, for example \"placed an order\" or \"left items in the cart\".",
  },
  wait: {
    term: "Wait step",
    plain:
      "A pause inside an automation before the next message goes out, for example \"wait 2 days after delivery\".",
    customerEffect: "The message lands at a sensible moment instead of right away.",
  },
  blank_variable: {
    term: "Blank (variable)",
    plain:
      "A gap in a template, shown as {{1}}, {{2}} and so on, that gets filled in for each person, like their first name or order number.",
    customerEffect: "They see their own details, for example \"Hi Priya\" instead of \"Hi {{1}}\".",
  },
  stop_footer: {
    term: "STOP footer",
    plain:
      "A short line added automatically to every marketing template telling people they can reply STOP to opt out. You do not need to write it yourself.",
    customerEffect: "They can leave any time by replying STOP, and they will not get offers after that.",
  },
  rfm_segment: {
    term: "Customer segment",
    plain:
      "Groups of buyers based on how recently they bought, how often, and how much they spent. For example: loyal regulars, new buyers, or people who have not ordered in a while.",
    customerEffect: "They get offers that match where they are with PROMUNCH.",
  },
  warm_audience: {
    term: "Warm audience",
    plain:
      "People who messaged us or read one of our messages in the last 90 days, or bought in the last 60 days, and who have not had a marketing message from us in the last 7 days.",
    customerEffect: "They already know PROMUNCH, so the message is welcome, and fewer get held back by Meta.",
  },
  engaged_audience: {
    term: "Engaged audience",
    plain:
      "People who have recently interacted with our WhatsApp messages, for example by reading, replying or tapping a button.",
    customerEffect: "They are the most likely to open and enjoy the next message.",
  },
  delivered: {
    term: "Delivered",
    plain: "The message reached the person's phone. It does not mean they opened it yet.",
  },
  read: {
    term: "Read",
    plain:
      "The person opened the message. Some people turn off read receipts, so the real number is usually a little higher than shown.",
  },
  reply: {
    term: "Reply",
    plain: "The person wrote back to us after the message. Replies also open a fresh 24-hour window for free-text chat.",
  },
  click: {
    term: "Click",
    plain: "The person tapped a link or button in the message, for example \"Shop now\".",
  },
  attributed_order: {
    term: "Attributed order",
    plain:
      "An order placed by someone after they received this message, matched by their phone number. It is a strong signal, not absolute proof, that the message helped.",
  },
  test_send: {
    term: "Test send",
    plain:
      "Send the message to your own number first, so you can check how it looks on a real phone before any customer gets it.",
    customerEffect: "None. Only you receive a test.",
  },
  header_media: {
    term: "Header image or video",
    plain:
      "An optional picture or short video shown at the top of the message. It is set when the template is created and must match what Meta approved.",
    customerEffect: "The message looks richer and more eye-catching in their chat list.",
  },
  quality_rating: {
    term: "Quality rating",
    plain:
      "Meta's score for our WhatsApp number, based on how people react to our messages. Lots of blocks or reports lower it, which can cut how many people we can reach.",
  },
  retarget: {
    term: "Retarget",
    plain:
      "Send a follow-up to people from an earlier campaign based on what they did, for example those who read it but did not order.",
    customerEffect: "They get a gentle, relevant nudge rather than the same message again.",
  },
  followup: {
    term: "Follow-up",
    plain:
      "A second message that goes out by itself some time after a campaign, only to the people it fits, for example 2 days later to people who read it. The wait counts from when each person got the first message.",
    customerEffect:
      "They get a timely next message that matches what they did, never the same one twice, and still at most 1 marketing message a day.",
  },
  journey: {
    term: "Journey",
    plain:
      "A campaign together with its follow-ups: the first message, then the messages that go out later depending on what each person did.",
    customerEffect: "A short, sensible series of messages instead of one-off blasts.",
  },
};

export const GLOSSARY_KEYS = Object.keys(GLOSSARY) as GlossaryKey[];
