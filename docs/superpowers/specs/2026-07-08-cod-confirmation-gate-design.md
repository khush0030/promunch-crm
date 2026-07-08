# COD Order Confirmation Gate (RTO Reduction) — Design

Date: 2026-07-08
Status: **Approved by Khush** (hard gate + real Shopify fulfillment hold). WhatsApp behavior change explicitly approved per standing WA-change-approval rule.

## Problem

High RTO: COD orders shipped, customer refuses/unreachable at delivery, order returns. Each RTO costs forward shipping + return shipping + repack, plus locked inventory.

## Goal

No COD order leaves the warehouse without a positive confirmation signal: WhatsApp button tap, or a human phone call logged by ops. Explicit cancels are caught before shipping instead of at the doorstep.

## Non-goals

- Prepaid orders (unchanged — plain confirmation, ship immediately).
- ₹0.01 HYPD creator seed orders (skipped entirely, `is_creator` flag).
- Amazon FBA orders.
- Free-text intent parsing ("haan bhej do" does NOT auto-confirm — AI replies normally, order stays held). Zero false-confirms by design.
- RTO risk scoring, address validation, repeat-RTO blocklist (future phases).

## Customer experience (approved)

- COD order placed → instead of today's plain confirmation, customer gets utility template `order_verify_v1`: order summary + "We ship COD orders only after confirmation" + buttons **[✅ Confirm order] [❌ Cancel order]**.
- Silent after `cod_reminder_delay_hours` (default 6h) → one reminder template `order_verify_reminder_v1`.
- Tap Confirm → free-text thank-you ("Great, packing it now 📦" — window is open after a tap).
- Tap Cancel → existing explicit-cancel flow: urgent ticket + ops WhatsApp ping (`order_cancel_ops`).
- Bare STOP unaffected: still plain unsubscribe, never routed to confirm/cancel logic.

## State machine

`shopify_orders.confirmation_status`:

```
NULL (prepaid/creator/gate-off)
pending ──✅ tap / manual──▶ confirmed          (hold released, ship)
   │ ────❌ tap / manual──▶ cancelled           (hold kept, cancel flow)
   └─ silent past cod_needs_call_hours,
      or template send failed ──▶ needs_call ──manual──▶ confirmed | cancelled
```

Columns: `confirmation_status text`, `confirmation_sent_at timestamptz`, `confirmed_at timestamptz`, `confirmed_via text` (`button` | `manual`), `payment_gateway_names text[]` (new capture — not stored today).

## Components

### 1. Migration (dashboard SQL editor, manual — per deploy constraints)

- `shopify_orders`: the five columns above + index on `confirmation_status`.
- `wa_flow_settings`: `cod_gate_enabled boolean default false`, `cod_reminder_delay_hours int default 6`, `cod_needs_call_hours int default 24`. Mirrors `FLOW_DEFAULTS` in `_shared/flow-settings.ts` and `src/app/api/whatsapp/flows/route.ts`.

### 2. Meta templates (via wa-template-create, new v1s — never live edits)

- `order_verify_v1` (utility): body with order ref/items/total/COD note, quick-reply buttons with payloads `CONFIRM_{order_id}` / `CANCEL_{order_id}`.
- `order_verify_reminder_v1` (utility): shorter nudge, same buttons.
- Utility category → no marketing cap (131049) exposure. Follow `docs/whatsapp/META_WHATSAPP_TEMPLATE_RULES.md`.

### 3. Order intake — `_shared/order-confirmation.ts` (`handleOrderCreated`)

Single entry point for all order-created trigger paths; existing two-layer dedup (durable `wa_messages` guard + atomic claim) reused as-is.

- COD detection: `payment_gateway_names` contains cash-on-delivery variant, OR fallback `financial_status === 'pending'`.
- If `cod_gate_enabled` AND COD AND not creator seed:
  1. Place Shopify **fulfillment hold**: GraphQL `fulfillmentOrderHold` on the order's fulfillment orders (existing Dev Dashboard app + client-credentials token; add scope `write_merchant_managed_fulfillment_orders`). Non-blocking: hold failure logs to connector log + Slack, does not block the send.
  2. Send `order_verify_v1` instead of the plain confirmation (same dedup claim).
  3. Set `confirmation_status = 'pending'`, `confirmation_sent_at = now()`.
- Send failure (no WA on number etc.) → `needs_call` immediately.
- Else (prepaid / gate off): today's behavior, `confirmation_status` stays NULL.

### 4. Button intercept — `wa-webhook`

New branch BEFORE the AI-reply path: `msg.type === "button"` with payload matching `CONFIRM_(\d+)` / `CANCEL_(\d+)` (payload, not button text — text already parses at index.ts:219 and must keep flowing to AI for non-gate buttons).

- `CONFIRM_{id}`: release hold (`fulfillmentOrderReleaseHold`), `confirmation_status='confirmed'`, `confirmed_via='button'`, tag order `WA-Confirmed` (existing tagging plumbing), free-text thank-you.
- `CANCEL_{id}`: keep hold, `confirmation_status='cancelled'`, tag `WA-Cancelled`, route into existing explicit-cancel path (urgent ticket + `OPS_WA_ID` ping). Order cancellation itself stays manual/ops (existing policy).
- Idempotent: tap on non-`pending` order → polite "already handled" free text, no state change.
- Gate-button messages are logged to `wa_messages`/thread like any inbound, but never reach the AI.

### 5. Sweep — rides `wa-jobs-tick`

- `pending` older than `cod_reminder_delay_hours`, reminder not yet sent → send reminder (dedup via `wa_messages` order_ref suffix, same pattern as confirmation sweep).
- `pending` older than `cod_needs_call_hours` → `needs_call` + WhatsApp ping to `OPS_WA_ID` (Narendra) with order ref, amount, customer name + phone.

### 6. Dashboard

- Orders page: confirmation status chip + filter (Pending / Confirmed / Needs call / Cancelled).
- "Needs call" queue view: one-click **Confirm** / **Cancel** buttons → API route that mirrors the button-tap logic exactly (release hold, tags, `confirmed_via='manual'`). RBAC'd, audited.
- Flows tab: COD gate toggle + the two timing fields (existing wa_flow_settings editor pattern).

## Edge cases

- Order cancelled in Shopify before tap → intercept sees non-pending/cancelled order, no-ops.
- Customer taps Confirm after ops already manually confirmed → idempotent no-op.
- Hold placed but template send fails → `needs_call`; hold stays until ops decides (fail-closed: never ship unconfirmed).
- Template rejected by Meta → flag stays off, zero behavior change anywhere.
- Multiple fulfillment orders per order (split shipments) → hold/release all of them.
- HYPD COD orders: included in gate (they RTO too).

## Rollout

1. Deploy everything with `cod_gate_enabled = false` (default) — zero behavior change.
2. Submit both templates → wait for Meta approval.
3. Add fulfillment-hold scope to Shopify app, verify hold+release on a test order.
4. Self-test: test order to Khush's number, tap both paths, verify hold lifecycle + tags + dashboard.
5. Flip flag on from Flows tab.

Deploy mechanics: migration via dashboard SQL editor; edge fns (`shopify-webhook`, `wa-webhook`, `wa-jobs-tick`) via Supabase CLI; dashboard via `vercel --prod`.

## Metrics (phase 1 = counts on Orders page; deeper analytics later)

Confirm rate, median time-to-confirm, cancels caught pre-ship, needs-call volume, RTO rate before/after.

## Future (explicitly out of scope now)

Risk-based gating (repeat-RTO phone blocklist, high-value stricter), address validation, prepaid-conversion nudge on the confirm message (5% prepaid discount already exists in policy), carrier NDR integration when Maruti API exists.
