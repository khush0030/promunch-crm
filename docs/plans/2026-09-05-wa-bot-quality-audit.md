# WhatsApp bot quality audit and improvement plan

Date: 2026-09-05. Scope: every bot conversation Aug 15 to Sep 3 2026 (50 threads, 131 bot replies), the live Master KB, the `wa-ai-reply` prompt and retrieval code, and the open ticket queue.

Status: FULLY LIVE 5 Sep 2026. Migration applied, three edge functions deployed, catalogue synced, nine draft-mode scenarios verified. See section 5.

## 1. Headline

The bot is not hallucinating wildly and it is not rude. Its failures are narrower and fixable:

1. **It answers from a stale copy of the KB.** The embedded `kb_chunks` are the May 2026 version of the Master KB. The June edits (Roasted Edamame "NOW AVAILABLE", "sold as combos/multipacks on promunch.in") never reached the bot. On Aug 28 it told a customer the edamame range is "coming soon".
2. **The KB does not cover what customers actually ask.** Rakhi hampers (64 units sold Jul to Aug, second best seller) and Beetroot Chips (sold in Bloom Hotel vending) are absent, so the bot said "I don't have details" and "PROMUNCH does not offer beet root chips", once to a customer holding a food safety complaint about that exact product.
3. **It loops.** It re-asks a clarifying question the customer already answered, three to five times in a row, on nearly every wholesale, supplier and influencer thread.
4. **It drags order-support language into non-order chats.** "Share your Order ID" and "do you want to cancel, return, replace or change address?" appear in product, wholesale and link-request conversations.
5. **It went generic on the worst conversation in the dataset.** On a fly-in-packet food safety complaint it sent the canned fallback ("Thanks for messaging PROMUNCH! I've noted this") three times, including as the answer to "Proceed with refund", and never handed off even though the KB escalation rules say health/safety goes to a human immediately.
6. **Tickets are raised and then nobody closes the loop.** 29 tickets open, oldest from Jul 2. 22 are wholesale or partnership leads the bot promised "the team will get back to you".

## 2. Evidence by failure type

### 2.1 Stale embeddings (bug, ops fix)

- `kb_documents.raw_text` for the Master KB says "Last updated: June 2026". Every chunk in `kb_chunks` says "May 2026".
- Probe strings present in raw_text but absent from chunks: "NOW AVAILABLE", "combos/multipacks".
- `retrieveKb` only falls back to raw_text when the RPC returns nothing, so the bot reads the stale chunks every time.
- Cause: raw_text was updated without the re-ingest path (`POST /api/whatsapp/kb/[id]` which chains `kb-ingest` then `kb-embed`). There is no re-embed button in the dashboard and the local service key cannot call `kb-embed` directly (401, see memory note on internal fn secret mismatch).

### 2.2 KB content gaps (content fix)

Customers asked, bot could not answer:

| Asked | Threads | What the bot said |
|---|---|---|
| Rakhi hamper price / details / ready hamper | 5d54b1cc, 630069e9, 11807868 | "I don't have the exact price details" (x3), "we do not have ready Rakhi hampers listed". Khush then replied by hand with an Amazon link. |
| Beetroot chips (Cheese & Onion, ricebran oil) | 26ed6d70, 4a2dd47c | "PROMUNCH does not offer beet root chips" |
| A link to order a specific product | 26ed6d70 ("Link*" three times) | "Could you please share your Order ID" |
| HYPD store link | 5d54b1cc | "We don't have a direct link to a HYPD store" (HYPD is a live channel per CLAUDE.md) |
| 1 kg edamame pouch / bulk pack | 4dabcda0 | correct answer, but no bulk-pack alternative to offer |
| Protein per 25 g edamame serving | 4dabcda0 (from a pack photo) | read 11 g off the photo; not in KB |
| "Call me" / connect me for a call | 4dabcda0, 73095d3c | "I can't make calls", no callback route |
| Complaint with no Order ID (vending machine, hotel) | 4a2dd47c | kept asking for an Order ID |
| Wholesale price list / catalogue | f62c9ca4, 4 open tickets | asks for business details, never offers a catalogue |
| Support hours | many | bot quotes 10am to 7pm Mon to Sat (env default); KB says Mon to Fri 9:30 to 6, Sat 9:30 to 5 |

### 2.3 Looping and redundant qualification (prompt fix)

- 73095d3c (edamame importer, 10 MT): bot asked "wholesale, corporate gifting or vending?" four times across three days, then "cancel, return, replace or address change?" three times in a wholesale chat. Customer: "No i do not need any changes. Just a connect with your team."
- c0bd815c (creator): "barter or partnership?" three times after "Both works for me".
- 94fef83b (supplier, 40 MT/month): five turns of "are you interested in wholesale partnership, distribution or supply?" after the customer had said supply twice.
- aeb2fb1d (college gifting, 150 boxes): repeated the same intake question the next day.

Root causes:
- No rule "never re-ask something already answered in CONVERSATION SO FAR".
- No rule "once name, business, city and requirement are captured, confirm once and stop".
- The bot does not know a ticket is already open on the thread, so on the next inbound it re-qualifies from scratch instead of saying "already logged, the team has your details".
- The `request_order_change` tool description is strong enough that the model offers its menu unprompted.
- KB has no "supplier / vendor pitch" category, so inbound suppliers get treated as wholesale buyers.

### 2.4 Order-support bleed into product chats (prompt fix)

- Product questions end with "If you want help with a past order, please share the order number" (230e8025, 26ed6d70).
- A bare YouTube link (12d43c56) triggered `lookup_order` and "I can't find any orders with your WhatsApp number".
- The prompt's ORDER LOOKUP paragraph is the longest instruction in the system prompt and fires on weak signals.

### 2.5 Generic fallback and missed escalation (prompt + code fix)

Thread 4a2dd47c, Sep 2, 14:29 to 14:34 IST, model `gpt-4.1-mini`:
- Two image turns and the "Proceed with refund" turn each produced a 55 to 79 token completion with no usable `reply`, so `wa-ai-reply` sent the canned fallback and opened an "AI output unparseable" ticket.
- The customer explicitly framed it as a food safety complaint with batch number 0607. KB "Escalation Rules" say escalate to a human immediately for health/safety. The bot never set `handoff: true` and kept asking "refund or replacement?".
- The KB escalation block is the last chunk and easy to lose; the system prompt says the ONLY handoff trigger is the customer asking for a human, which contradicts the KB.

### 2.6 Smaller quality issues

- Invented explanations: "₹704 because it may include multiple items or gift packaging" (11807868). The order lookup does not expose discounts or shipping lines, so the bot guessed.
- Over-promising: "Since Rakhi is near, we will try our best to get it to you before then" (46916d5f), then a cancel request an hour later.
- Pedantic corrections: "Your order from 21st August was actually placed on 20th August" (cda2f75a).
- Double greeting: "Hello" then the real question one minute later gets two bot messages (230e8025, 73095d3c).
- Tagline appended on a creator's "Thank you" mid-negotiation (b22f82ec); tagline text in `wa_flow_settings` is null so the code-side default is used.
- Em dashes appear in the stored `wa_messages.body` because the ledger stores the pre-strip text. `wa-send` strips them before Meta, so customers do not see them. Cosmetic only.

### 2.7 Retrieval design

- 14 chunks total, threshold 0.25, top 10, 12k char budget. Retrieval returns most of the KB every turn, so semantic search adds little today and mid-line chunk cuts (nutrition rows split across chunks) can drop a row. Fine while the KB is this small. Once section 3 lands the KB doubles and structure matters.

## 3. Plan

### P0: ops, no code, no behaviour change

1. Re-embed the Master KB from the dashboard (WhatsApp, Knowledge, re-process the Master KB document) or run `kb-embed` from an authorised context. Verify with a chunk probe for "NOW AVAILABLE".
2. Triage the 29 open tickets. Reply or close every wholesale and partnership lead older than a week.
3. Reconcile support hours: either set `WA_BUSINESS_OPEN/CLOSE/DAYS` to match the KB or update the KB to 10 to 7 Mon to Sat.

### P1: KB content (needs facts from Khush, no code)

Add to the Master KB, in this order:

1. **Full product catalogue with promunch.in URLs** for every live listing: Rakhi hamper (contents, price, Amazon and site link), Roasted Edamame combos and packs of 2 and 3, Soya Sticks and Chips combos (pack of 9, 12, 100 g x 2, 100 g x 3), Travel Combo, Big Bite Munch Combo, Variety Packs, Assorted Pack, Crunchies 270 g. Titles above are the exact Shopify titles from `shopify_orders` since Jul 1.
2. **Beetroot Chips** as a product line (flavours, oil, where sold, whether it is on promunch.in).
3. **Channel links**: HYPD store URL, Amazon store URL, Instamart cities.
4. **Edamame per-serving nutrition** for 25 g (11 g protein for Himalayan Rock Salt per the pack).
5. **Lead scripts with an exit**: wholesale buyer, distributor, corporate gifting, college/event sponsorship, influencer/creator, inbound supplier or vendor pitch, agency pitch. Each: what to collect (once), what to promise (a call back within N working days), what NOT to do (no pricing, no catalogue promise unless one exists). If a wholesale price list PDF exists, add its link.
6. **Callback policy**: whether the team calls back, from which number, within what window.
7. **Non-order complaints**: vending machine, hotel, marketplace purchase. Collect batch number, purchase point, photo; no Order ID needed.
8. **Food safety**: foreign object, illness, allergen reaction. Hand off immediately, never offer refund or replacement as the first response, ask for batch and photos, promise a quality team response.
9. **Bulk pack availability**: is there any 1 kg or institutional pack.

### P2: prompt and code changes (needs approval, section 4.2)

Customer-visible effect stated per item.

1. **Anti-loop rules.** Add to system prompt: never ask something answered in CONVERSATION SO FAR; once a lead has name, business, city and requirement, confirm once and close; do not offer the cancel/return/replace/address menu unless the customer raised an existing order. Effect: wholesale and creator chats end in two to three turns instead of ten.
2. **Open-ticket awareness.** Pass `ticket_status`, category and `escalation_reason` into the prompt. If a ticket is open, the bot says "already logged with the team, they have your details" and answers only new questions. Effect: no re-qualification on day two.
3. **Order lookup gating.** Only call `lookup_order` when the customer mentions an order, delivery, tracking, refund, return or a specific item problem. Never append "share your Order ID" to product or partnership replies. Effect: fewer off-topic order prompts.
4. **Safety escalation.** Add a second handoff trigger: health, safety, foreign object, legal, consumer court, FSSAI. Ticket priority urgent, category complaint, handoff true. Effect: the bot sends one acknowledgement and goes quiet; ops gets the ping.
5. **Fallback hardening.** When the parsed reply is empty, retry once with `tool_choice: "none"` and an explicit "write the customer reply now" nudge before falling back to the canned line. Log the raw completion to `connector_events` so the next unparseable case can be diagnosed. Effect: fewer "I've noted this" non-answers.
6. **Product link tool.** New `lookup_product` tool backed by a small `kb_products` table or a Shopify products mirror (title, URL, price, in stock). Effect: "send me the link" gets a link.
7. **No invented reasons.** Add to prompt: when an order total or charge is asked about, quote the order lines and shipping charge only; if the breakdown is not in the tool result, say the team will confirm. Extend `orderForAI` to include discount and shipping lines. Effect: no more "maybe packaging" guesses.
8. **Burst collapse.** Extend the bow-out window in `claimReplyTurn` so "Hello" followed by the real question within 60 to 90 seconds gets one reply. Effect: fewer double greetings.

### P3: keep it honest

1. Weekly sample of 20 bot turns scored on: answered from KB, no loop, no off-topic order prompt, correct escalation. Track "I don't have details" and "team will follow up" as a KB-miss rate.
2. Log a `kb_miss` connector event whenever the reply contains a "don't have details" phrase, with the customer question, so KB gaps surface without reading transcripts.
3. Re-embed on every KB write. Make the dashboard KB editor call the re-ingest route after save, and add a "Re-embed" button.

## 4. Questions Khush needs to answer for P1

1. Rakhi hamper: still selling? Contents, price, promunch.in URL and Amazon URL.
2. Beetroot Chips: flavours, oil, on promunch.in or vending only, price.
3. HYPD store link. Amazon brand store link.
4. Wholesale: minimum order, is there a price list or catalogue to share, callback SLA and who calls.
5. Inbound suppliers (edamame importers): interested or standard decline?
6. Influencers: standard reply (email hello@promunch.in with profile) or does the team want them logged and called?
7. Callback: does anyone call customers back, and from which number?
8. Support hours: 10 to 7 Mon to Sat (code) or 9:30 to 6 / 9:30 to 5 (KB)?
9. Any 1 kg or institutional packs?

## 5. Build log (5 Sep 2026)

Decisions from Khush: Rakhi hamper out of scope. Beetroot Chips are B2B only (Bloom Hotels, vending), never D2C. HYPD and Amazon store links added. Wholesale and bulk go to the sales team after qualification. Influencers: log, collect handle, followers, average views, engagement rate, commercials, then schedule a call. Ops calls back Mon to Fri 10 to 6, Sat 10 to 5. Only Tangy Pudina Crunchies is Jain, nothing else. Front-of-jar protein phrased as "over 45g per 100g". Replies must be short and human, tagline gone everywhere, em dashes banned.

Live now (config, no deploy needed):
- `wa_flow_settings`: tagline text cleared, all four tagline toggles off. COD gate and checkout footer stop signing off immediately.
- `kb_documents` Master KB rewritten from pack labels (Crunchies, Sticks, Chips, Edamame per 100 g and per 25 g), corrected Noodle Masala carbs (27.4 to 9.09), Chips protein (3.85 to 3.55), Indori Chatka protein (42 to 42.9), zero em dashes, all handling scripts. Separate edamame doc deleted (folded in).

Deployed 5 Sep 2026 (after Khush re-ran `supabase login`):
- `wa-ai-reply`: new prompt (tone rules, never re-ask, open-ticket awareness, order-lookup gating, lead and creator scripts, supplier decline, safety handoff), `lookup_product` tool, empty-reply retry, 320-char shorten pass, safety regex backstop, tagline stripped from model output, dash strip before ledger, KB read from raw_text while it fits 28k chars, default model gpt-4.1 (env WA_AI_MODEL still pins gpt-4.1-mini in prod, unset it or set gpt-4.1), support hours Mon to Fri 10 to 6 and Sat 10 to 5.
- `shopify-catalog-sync`: handle, URL, product id, inventory quantity, compare-at price, description and tags written to `wa_catalog_items`; generated KB doc carries links, no dashes.
- `_shared/orders.ts`: subtotal, discount and code, shipping, COD flag in the order tool result.
- `_shared/whatsapp.ts`: double hyphen stripped too (affects `wa-send`).

Migration `20260905120000` applied by Khush. `wa_catalog_items` live, `shopify-catalog-sync` every 30 min, `kb-embed` nightly.

Secrets set at deploy: `WA_AI_MODEL=gpt-4.1` (was gpt-4.1-mini, the model behind the canned fallbacks), `WA_BUSINESS_OPEN=10:00`, `WA_BUSINESS_CLOSE=18:00`, `WA_BUSINESS_SAT_CLOSE=17:00`, `WA_BUSINESS_DAYS=1..6`, `SHOPIFY_PUBLIC_STORE_URL=https://promunch.in`.

First catalogue sync: 23 variants, 0 missing URLs, all 8 edamame listings present, Rakhi hamper and Ultimate Munch Combo correctly flagged out of stock. Generated KB doc is 21 chunks.

Verification (draft mode, no customer messaged), nine scenarios, all passed:

| Input | Reply | Chars | Ticket |
|---|---|---|---|
| hi | Hey! How can I help you today? | 30 | none |
| link for cream and onion sticks | real combo URL from the live catalogue | 160 | none |
| do you have beetroot chips | B2B only, suggests Soya Chips or Sticks | 180 | none |
| fly in packet, Bloom vending, batch 0607 | apology, quality team will call, asks for photo | 157 | complaint urgent, handoff true |
| distributor Mumbai 10 MT monthly | one question, says it goes to sales | 102 | after intake |
| call me | ops team will call back in hours | 53 | general |
| which has most protein | edamame 45.3g/100g, crunchies 15.2g/30g | 213 | none |
| a bare YouTube link | asks what they need, no order lookup | 81 | none |
| creator with 45k, 200k views, 6% ER | logs it, no re-asking | 93 | partnership |

No tagline, no em dashes, no greeting or closing filler in any reply. Average reply length dropped from roughly 300 characters to about 120.

Still open: triage the 29 stale tickets (P0 item 2), and P3 monitoring (weekly sample, kb_miss logging, re-embed button in the dashboard).
