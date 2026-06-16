# PROMUNCH — WhatsApp Customer Flow & Marketing Map

> Companion to `whatsapp-templates-for-copy-optimization.md` (which has the exact copy of every
> template). **This file explains the full lifecycle: every WhatsApp message we send a customer,
> what triggers it, when, and why** — so an optimizer understands the whole marketing motion, not
> just isolated templates.

---

## 0. The big picture (one-line summary)

PROMUNCH runs a **Shopify store**; Shopify webhooks drive an automated WhatsApp journey through
**Supabase edge functions**. There are 5 motions:

1. **Transactional** — order confirmation + shipping update (always sent, utility).
2. **Abandoned-cart recovery** — 2 nudges if a checkout is left unfinished.
3. **Post-purchase nurture** — review request (+7d) + replenishment reminder (+30d).
4. **Inbound AI support chatbot** — 2-way conversation, answers questions, raises tickets.
5. **Broadcast campaigns** — manual bulk marketing to opted-in contacts.

Two message *types* on WhatsApp matter:
- **Template messages** (pre-approved by Meta) — required to message a customer *outside* an open
  chat window. UTILITY (transactional) or MARKETING (promotional, billable, opt-out required).
- **Free-text (session) messages** — allowed only within **24h of the customer's last inbound
  message** ("the 24h service window"). Free, uncapped. Used by the AI chatbot and, cleverly, for
  post-purchase asks (see §4) to dodge Meta's marketing throttle.

---

## 1. Triggers (Shopify → WhatsApp)

| Shopify webhook | What we do |
|---|---|
| `orders/create` | Send **order confirmation** immediately + enrol post-purchase journeys (review, replenishment) + mark any abandoned-cart runs `converted` (stop nudging) |
| `orders/fulfilled` | Send **shipping update** (with tracking link) |
| `orders/cancelled` | Cancel any queued review/replenishment messages; suppress shipping update |
| `checkouts/create` / `checkouts/update` | Enrol the **abandoned-cart** sequence (atomic per-cart, enrols exactly once) |

Customer inbound WhatsApp messages hit a separate webhook → the **AI chatbot** (§5).

---

## 2. Transactional motion (UTILITY — always sent, no opt-in needed)

```
Order placed ──► order_confirmation_v2        (instant)
                 "Welcome to the PROMUNCH family, {name}! Your order {ref} is confirmed…"

Order shipped ─► shipping_update              (when Shopify marks fulfilled)
                 "Good news {name}! Your order {ref} has shipped 🚚  Track it here: {link}"
```

- **Reliability guarantee:** order confirmation is protected by an **atomic per-order claim** plus a
  reconciliation **sweep cron** — a customer can never be confirmed twice, and a missed one is
  retried. (Hard product rule: *never message a customer twice.*)
- Tracking link is currently the **Shopify order-status page** (no carrier API yet).

---

## 3. Abandoned-cart recovery (MARKETING — 2 touches, opt-out honored)

Fires when a checkout is started but not completed.

```
Checkout abandoned
   │
   ├─ +1h  abandoned_cart_reminder   (NO discount — gentle nudge)
   │        button "Complete Order" → drops them back on their exact cart, full price
   │
   └─ +6h  abandoned_cart_recovery   (WITH discount — only if still not ordered)
            button "Checkout Now" → applies PROMUNCH10 (10% off ₹399+) on their cart
```

- **Stops instantly if they buy:** `orders/create` flips active runs to `converted`, so no nudge
  after purchase.
- **Was 3 touches, now 2:** a third touch at +24h re-sent the *same* recovery message verbatim —
  removed as spam (2026-06-10). Do not re-add touches; optimize wording only.
- Discount strategy: touch 1 gives away nothing (recover at full price first); touch 2 sweetens
  with PROMUNCH10 only if the reminder failed.

---

## 4. Post-purchase nurture (MARKETING — enrolled at order time)

Enrolled when the order is confirmed; each tied to that order (cancelled if the order is cancelled).

```
Order confirmed
   │
   ├─ +7 days   review_request          "hope you're loving your snacks — mind a quick review? {link}"
   │            (7d so it lands AFTER delivery, which takes ~4–6 days)
   │
   └─ +30 days  replenishment_reminder  "Running low, {name}? Restock in a tap: {link}"
```

**Smart delivery (cost + deliverability optimization):** review_request and replenishment_reminder
are MARKETING templates, which Meta throttles per-recipient (error 131049) and bills for. So:

- If the customer's **24h chat window is open** (they messaged us recently), we send the ask as a
  **personalized free-text message** instead — composed by the AI from their real order, **free and
  uncapped**, and woven naturally into conversation.
- Only if the window is closed do we fall back to the approved MARKETING template (capped retries).
- An inbound reply can also **piggyback** a due ask (the bot adds the review/restock nudge to its
  normal answer). Atomic claims ensure the ask is delivered exactly once across all these paths.

---

## 5. Inbound AI support chatbot (2-way, free-text in the 24h window)

When a customer messages the WhatsApp number, an AI agent ("Your Munchy Pal") replies:

- **Brain:** OpenAI model + a shared **Knowledge Base** (products, prices, shipping, discount codes,
  policies — the same KB the email agent uses).
- **Tools:** looks up the customer's real Shopify orders (their phone is known from WhatsApp) to
  answer order/delivery/refund questions with real data.
- **Tone rules (enforced in the prompt):** English by default, short, warm, **patient, never rude**,
  **one message per turn** (no multi-message spam), answer the exact thing asked.
- **Escalation:** raises a **ticket** to the team (Slack) for issues needing human action (missing/
  damaged item, refund, complaint, wholesale lead) — *without* stopping the conversation. **Hands off**
  to a human only when the customer explicitly asks for one.
- **No-duplicate guarantee:** an atomic per-turn claim collapses rapid-fire bursts into one reply and
  blocks retry duplicates.

This is the channel where the customer in our recent incident asked about a ₹99 shipping charge — the
bot answers these directly from the KB.

---

## 6. Broadcast campaigns (MARKETING — manual, dashboard-triggered)

- Bulk marketing sends to **opted-in contacts**, optionally filtered by tag/segment.
- Sends an **approved MARKETING template** to each recipient; copy can be **static or AI-personalized**.
- Resumable batch sender (won't double-send a recipient). Used for launches, festive offers, etc.
- This is the only *push* marketing initiated by the team rather than by a customer action.

---

## 7. Compliance & guardrails (applies to everything above)

- **Opt-out:** every MARKETING message carries `Reply STOP to opt out`. A `STOP` / `unsubscribe`
  inbound flips the contact to `opted_in = false` → no more marketing.
- **Never message twice:** hard invariant. Every send path takes an atomic claim before sending;
  on failure it releases (so a retry can resend), on success it locks (so it can't resend).
- **Meta marketing cap (131049):** worked around for post-purchase asks via the free-text 24h-window
  path (§4); genuine caps are expected, not bugs.
- **Failure alerting:** every send/delivery failure Slack-alerts the team with Meta's reason.

---

## 8. Timeline view (a typical happy-path customer)

```
T+0      Order placed        → order_confirmation_v2          (UTILITY)
T+~1d    Order ships         → shipping_update                (UTILITY)
T+4–6d   Order delivered     (no message)
T+7d     Review nudge        → review_request                 (MARKETING, or free-text if chatting)
T+30d    Restock nudge       → replenishment_reminder         (MARKETING, or free-text if chatting)

Anytime  Customer messages   → AI chatbot replies             (free-text, 24h window)
```

```
Cart abandoned (no order):
T+0   checkout abandoned
T+1h  abandoned_cart_reminder   (no discount)
T+6h  abandoned_cart_recovery   (PROMUNCH10)
      └─ if they order at any point → sequence stops (converted)
```

---

## 9. What an optimizer might consider

- The motions above are deliberately **light-touch** (transactional + a couple of nudges) — the brand
  priority is *not feeling spammy*. Any suggestion must respect that and the §7 guardrails.
- Levers available: the **wording** of each template (see the companion file), the **discount framing**
  in the recovery message, the **review/restock hooks**, and campaign copy.
- Cadence/number-of-touches is intentionally fixed — propose word/positioning changes, not more sends.
- All copy is "Your Munchy Pal" voice: warm, India-English, English-first, never pushy.
```
