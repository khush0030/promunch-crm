# COD Confirmation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No COD order ships without a positive confirmation (WhatsApp button tap or logged ops call); explicit cancels auto-cancel the Shopify order before packing.

**Architecture:** Rides the existing order pipeline. `handleOrderCreated()` (single entry for every new order) sends a buttoned utility template + places a Shopify fulfillment hold for COD orders. `wa-webhook` intercepts button payloads before the AI and drives a small state machine on `shopify_orders.confirmation_status`. `wa-jobs-tick` sweeps reminders and needs-call escalation. A new `cod-gate-action` edge fn mirrors button logic for manual dashboard actions. Everything is inert behind `wa_flow_settings.cod_gate_enabled` (default **false**).

**Tech Stack:** Supabase Edge Functions (Deno/TS), Shopify Admin GraphQL (2025-01, client-credentials token), Meta WhatsApp Cloud API, Next.js App Router dashboard, Postgres (Supabase).

**Spec:** `docs/superpowers/specs/2026-07-08-cod-confirmation-gate-design.md` — read it first.

## Global Constraints

- **Never message a customer twice** (repo `promunch-email-agent/CLAUDE.md` §0): every send goes behind the atomic claim primitives in `_shared/confirmations.ts` (`claimConfirmation`/`claimSend`). On ANY uncertainty, do NOT send.
- **Feature flag:** all new behavior gated on `cod_gate_enabled` (default `false`). Deploying any task changes nothing in prod until the flag flips.
- **HARD ORDERING:** the migration (Task 1) must be applied in prod **before** the Task 5 `shopify-webhook` deploy — the upsert writes `payment_gateway_names` and will 500 every order webhook if the column is missing.
- **Copy rules:** brand is always `PROMUNCH` (all caps); **em dashes are banned** in all customer-facing copy.
- **Migrations** are applied manually in the Supabase dashboard SQL editor (CLI `db push` does not work on this machine). Edge fns deploy via `supabase functions deploy <name>` from `promunch-email-agent/`. Dashboard ships via `vercel --prod` (no git auto-deploy).
- **Repo workflow:** commit directly to `main`, no branches/PRs. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **CI checks that must stay green:** `cd promunch-email-agent/supabase/functions && deno check */index.ts`, `npm run test` (vitest, repo root), `npx tsc --noEmit`, `npm run build`.
- **Shopify API docs are the source of truth** for mutation shapes (training data may be stale): https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentOrderHold , `.../fulfillmentOrderReleaseHold` , `.../orderCancel` , `.../orderUpdate`. Verify argument names before finalizing Task 3.
- All timestamps/statuses on `shopify_orders`; identity key is `shopify_id` (numeric Shopify order id). Payload ids in button payloads are the numeric `order.id`, NOT the `#2091` ref.

---

### Task 1: Migration — gate columns + flow settings

**Files:**
- Create: `promunch-email-agent/supabase/migrations/20260708160000_cod_confirmation_gate.sql`

**Interfaces:**
- Produces: columns `shopify_orders.confirmation_status/confirmation_sent_at/confirmed_at/confirmed_via/payment_gateway_names`, settings `wa_flow_settings.cod_gate_enabled/cod_reminder_delay_hours/cod_needs_call_hours` — every later task reads these exact names.

- [ ] **Step 1: Write the migration file**

```sql
-- COD confirmation gate (RTO reduction).
-- Spec: docs/superpowers/specs/2026-07-08-cod-confirmation-gate-design.md
-- APPLY MANUALLY in the Supabase dashboard SQL editor (CLI migrations don't
-- run against this project). Must be applied BEFORE deploying the
-- shopify-webhook change that writes payment_gateway_names.

alter table shopify_orders
  add column if not exists confirmation_status text
    check (confirmation_status in ('pending','confirmed','cancelled','needs_call')),
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_via text
    check (confirmed_via in ('button','manual')),
  add column if not exists payment_gateway_names jsonb;

-- sweep + dashboard queue both filter on status; partial index keeps it tiny
create index if not exists shopify_orders_confirmation_status_idx
  on shopify_orders (confirmation_status)
  where confirmation_status is not null;

alter table wa_flow_settings
  add column if not exists cod_gate_enabled boolean not null default false,
  add column if not exists cod_reminder_delay_hours numeric not null default 6
    check (cod_reminder_delay_hours > 0),
  add column if not exists cod_needs_call_hours numeric not null default 24
    check (cod_needs_call_hours > 0);
```

- [ ] **Step 2: Commit**

```bash
git add promunch-email-agent/supabase/migrations/20260708160000_cod_confirmation_gate.sql
git commit -m "feat(cod-gate): migration for confirmation status + gate settings" -- promunch-email-agent/supabase/migrations/20260708160000_cod_confirmation_gate.sql
```

(Path-scoped commit: the working tree may hold unrelated changes — never `git add -A`. Same for every commit below.)

Prod application happens in Task 11 (rollout), not here.

---

### Task 2: `_shared/cod-gate.ts` — pure helpers (TDD)

**Files:**
- Create: `promunch-email-agent/supabase/functions/_shared/cod-gate.ts`
- Test: `promunch-email-agent/supabase/functions/_shared/cod-gate_test.ts`

**Interfaces:**
- Produces (used by Tasks 5, 6, 7, 8):
  - `GATE_TEMPLATE = "order_verify_v1"`, `GATE_REMINDER_TEMPLATE = "order_verify_reminder_v1"` (string consts)
  - `isCodOrder(order: any): boolean`
  - `type GateAction = "confirm" | "cancel_ask" | "cancel_confirm" | "keep"`
  - `parseGatePayload(payload: string | null | undefined): { action: GateAction; shopifyId: string } | null`
  - `buildVerifyVars(name: string, orderRef: string, totalLabel: string): Record<string, string>`
  - `buildVerifyComponents(vars: Record<string, string>, shopifyId: string | number): TemplateComponent[]`
  - `codTotalLabel(total: number, currency: string): string` (e.g. `"₹398"`)

- [ ] **Step 1: Write the failing tests**

```ts
// _shared/cod-gate_test.ts
import { assertEquals } from "jsr:@std/assert";
import {
  buildVerifyComponents,
  buildVerifyVars,
  codTotalLabel,
  isCodOrder,
  parseGatePayload,
} from "./cod-gate.ts";

Deno.test("isCodOrder: true when gateway names contain COD", () => {
  assertEquals(isCodOrder({ payment_gateway_names: ["Cash on Delivery (COD)"] }), true);
  assertEquals(isCodOrder({ payment_gateway_names: ["cod"] }), true);
});

Deno.test("isCodOrder: false for prepaid gateways", () => {
  assertEquals(isCodOrder({ payment_gateway_names: ["Razorpay Secure"], financial_status: "pending" }), false);
});

Deno.test("isCodOrder: falls back to financial_status when gateways missing", () => {
  assertEquals(isCodOrder({ financial_status: "pending" }), true);
  assertEquals(isCodOrder({ financial_status: "paid" }), false);
  assertEquals(isCodOrder({}), false);
});

Deno.test("parseGatePayload: all four actions", () => {
  assertEquals(parseGatePayload("CONFIRM_123"), { action: "confirm", shopifyId: "123" });
  assertEquals(parseGatePayload("CANCEL_123"), { action: "cancel_ask", shopifyId: "123" });
  assertEquals(parseGatePayload("CANCELCONF_123"), { action: "cancel_confirm", shopifyId: "123" });
  assertEquals(parseGatePayload("KEEP_123"), { action: "keep", shopifyId: "123" });
});

Deno.test("parseGatePayload: rejects noise", () => {
  assertEquals(parseGatePayload("hello"), null);
  assertEquals(parseGatePayload("CONFIRM_abc"), null);
  assertEquals(parseGatePayload(null), null);
  assertEquals(parseGatePayload("CONFIRM_"), null);
});

Deno.test("buildVerifyComponents: body params + two payload buttons", () => {
  const comps = buildVerifyComponents(buildVerifyVars("Priya", "#2091", "₹398"), 555) as any[];
  assertEquals(comps[0].type, "body");
  assertEquals(comps[0].parameters.map((p: any) => p.text), ["Priya", "#2091", "₹398"]);
  assertEquals(comps[1], {
    type: "button", sub_type: "quick_reply", index: "0",
    parameters: [{ type: "payload", payload: "CONFIRM_555" }],
  });
  assertEquals(comps[2], {
    type: "button", sub_type: "quick_reply", index: "1",
    parameters: [{ type: "payload", payload: "CANCEL_555" }],
  });
});

Deno.test("codTotalLabel: rounds and prefixes rupee for INR", () => {
  assertEquals(codTotalLabel(398.0, "INR"), "₹398");
  assertEquals(codTotalLabel(499.5, "USD"), "USD 500");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd promunch-email-agent/supabase/functions && deno test _shared/cod-gate_test.ts`
Expected: FAIL — `Module not found "./cod-gate.ts"`.

- [ ] **Step 3: Write the implementation**

```ts
// _shared/cod-gate.ts
// COD confirmation gate (RTO reduction) — pure helpers.
// Spec: docs/superpowers/specs/2026-07-08-cod-confirmation-gate-design.md
// Stateful handlers (confirm/cancel/bounce) are added in a later task and
// live in this same module so the whole gate reads in one place.

import type { TemplateComponent } from "./whatsapp.ts";

export const GATE_TEMPLATE = "order_verify_v1";
export const GATE_REMINDER_TEMPLATE = "order_verify_reminder_v1";

// COD detection. payment_gateway_names is authoritative when present
// (webhook payload carries it; older rows may not). A known non-COD gateway
// with financial_status 'pending' (e.g. a Razorpay order awaiting capture)
// must NOT be gated, hence the early false.
export function isCodOrder(order: any): boolean {
  const names: string[] = Array.isArray(order?.payment_gateway_names)
    ? order.payment_gateway_names.map((n: unknown) => String(n))
    : [];
  if (names.length) return names.some((n) => /cash\s*on\s*delivery|\bcod\b/i.test(n));
  return String(order?.financial_status ?? "").toLowerCase() === "pending";
}

export type GateAction = "confirm" | "cancel_ask" | "cancel_confirm" | "keep";

const PAYLOAD_RE = /^(CONFIRM|CANCEL|CANCELCONF|KEEP)_(\d+)$/;
const ACTION_MAP: Record<string, GateAction> = {
  CONFIRM: "confirm",
  CANCEL: "cancel_ask",
  CANCELCONF: "cancel_confirm",
  KEEP: "keep",
};

export function parseGatePayload(
  payload: string | null | undefined,
): { action: GateAction; shopifyId: string } | null {
  const m = String(payload ?? "").match(PAYLOAD_RE);
  if (!m) return null;
  return { action: ACTION_MAP[m[1]], shopifyId: m[2] };
}

// Template vars: {"1": name, "2": orderRef, "3": total}. Var "2" MUST stay the
// order ref — the confirmation dedup ledger (confirmations.ts) keys on it.
export function buildVerifyVars(
  name: string,
  orderRef: string,
  totalLabel: string,
): Record<string, string> {
  return { "1": name, "2": orderRef, "3": totalLabel };
}

export function codTotalLabel(total: number, currency: string): string {
  const n = Math.round(Number(total) || 0);
  return currency === "INR" ? `₹${n}` : `${currency} ${n}`;
}

// Full component array for a gated template send: body params + the two
// quick-reply payload buttons. Payload carries the numeric Shopify order id.
export function buildVerifyComponents(
  vars: Record<string, string>,
  shopifyId: string | number,
): TemplateComponent[] {
  const sorted = Object.entries(vars).sort(([a], [b]) => Number(a) - Number(b));
  return [
    { type: "body", parameters: sorted.map(([, v]) => ({ type: "text", text: v })) },
    {
      type: "button", sub_type: "quick_reply", index: "0",
      parameters: [{ type: "payload", payload: `CONFIRM_${shopifyId}` }],
    } as TemplateComponent,
    {
      type: "button", sub_type: "quick_reply", index: "1",
      parameters: [{ type: "payload", payload: `CANCEL_${shopifyId}` }],
    } as TemplateComponent,
  ];
}
```

Check `TemplateComponent` in `_shared/whatsapp.ts` (~line 80-95): it already allows `sub_type?: "quick_reply" | "url"`. If the `parameters` element type lacks `{ type: "payload"; payload: string }`, add that variant to the union in `whatsapp.ts` rather than casting.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd promunch-email-agent/supabase/functions && deno test _shared/cod-gate_test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add promunch-email-agent/supabase/functions/_shared/cod-gate.ts promunch-email-agent/supabase/functions/_shared/cod-gate_test.ts
git commit -m "feat(cod-gate): pure helpers — COD detection, payload parsing, template components" -- promunch-email-agent/supabase/functions/_shared/cod-gate.ts promunch-email-agent/supabase/functions/_shared/cod-gate_test.ts
```

---

### Task 3: `_shared/shopify-fulfillment.ts` — hold / release / cancel / note

**Files:**
- Create: `promunch-email-agent/supabase/functions/_shared/shopify-fulfillment.ts`

**Interfaces:**
- Consumes: `adminGraphQL(query, variables)` from `./shopify-customer.ts` (already exported; throws `"admin-not-configured"` when env is missing).
- Produces (used by Tasks 5, 6, 7):
  - `holdOrderFulfillments(orderId: number | string, note: string): Promise<{ ok: boolean; reason?: string }>`
  - `releaseOrderHolds(orderId: number | string): Promise<{ ok: boolean; reason?: string }>`
  - `cancelOrderByCustomer(orderId: number | string, staffNote: string): Promise<{ ok: boolean; reason?: string }>`
  - `setOrderNote(orderId: number | string, note: string): Promise<{ ok: boolean; reason?: string }>`

**Before writing:** open the four Shopify doc pages listed in Global Constraints and confirm argument names for API version 2025-01 (`fulfillmentOrderHold` takes `id` + `fulfillmentHold: { reason, reasonNotes }`; `orderCancel` takes `orderId, reason, refund, restock, staffNote, notifyCustomer`). Adjust the code below if the docs disagree — the docs win.

- [ ] **Step 1: Write the implementation**

```ts
// _shared/shopify-fulfillment.ts
// Shopify fulfillment holds + customer-initiated order cancellation for the
// COD confirmation gate. All calls ride the same client-credentials Admin
// token as customer upserts (shopify-customer.ts). Requires app scopes:
//   read/write_merchant_managed_fulfillment_orders  (hold + release)
//   write_orders                                     (cancel + note; already
//                                                     granted for tagsAdd)
// Every function returns { ok, reason } and never throws — callers decide
// whether a failure blocks (it never blocks a customer-facing send).

import { adminGraphQL } from "./shopify-customer.ts";

const orderGid = (id: number | string) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Order/${id}`;

const errsOf = (j: any, path: string): unknown[] | null => {
  const node = path.split(".").reduce((o, k) => o?.[k], j?.data);
  const errs = node?.userErrors ?? j?.errors;
  return Array.isArray(errs) && errs.length ? errs : null;
};

const fail = (reason: unknown) => ({ ok: false as const, reason: JSON.stringify(reason).slice(0, 300) });

async function fulfillmentOrderIds(
  orderId: number | string,
  statuses: string[],
): Promise<string[] | { error: string }> {
  const j = await adminGraphQL(
    `query($id: ID!){ order(id:$id){ fulfillmentOrders(first: 10){ nodes { id status } } } }`,
    { id: orderGid(orderId) },
  );
  if (j?.errors) return { error: JSON.stringify(j.errors).slice(0, 300) };
  const nodes: any[] = j?.data?.order?.fulfillmentOrders?.nodes ?? [];
  return nodes.filter((n) => statuses.includes(String(n?.status))).map((n) => String(n.id));
}

// Place a hold on every open fulfillment order (split shipments each get one).
export async function holdOrderFulfillments(
  orderId: number | string,
  note: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const ids = await fulfillmentOrderIds(orderId, ["OPEN", "IN_PROGRESS", "SCHEDULED"]);
    if (!Array.isArray(ids)) return fail(ids.error);
    if (!ids.length) return { ok: false, reason: "no-holdable-fulfillment-orders" };
    for (const id of ids) {
      const j = await adminGraphQL(
        `mutation($id: ID!, $hold: FulfillmentOrderHoldInput!){
           fulfillmentOrderHold(id: $id, fulfillmentHold: $hold){
             userErrors { field message } } }`,
        { id, hold: { reason: "OTHER", reasonNotes: note } },
      );
      const errs = errsOf(j, "fulfillmentOrderHold");
      if (errs) return fail(errs);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

export async function releaseOrderHolds(
  orderId: number | string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const ids = await fulfillmentOrderIds(orderId, ["ON_HOLD"]);
    if (!Array.isArray(ids)) return fail(ids.error);
    if (!ids.length) return { ok: true }; // nothing held — releasing is a no-op
    for (const id of ids) {
      const j = await adminGraphQL(
        `mutation($id: ID!){
           fulfillmentOrderReleaseHold(id: $id){ userErrors { field message } } }`,
        { id },
      );
      const errs = errsOf(j, "fulfillmentOrderReleaseHold");
      if (errs) return fail(errs);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

// Cancel an unpaid COD order at the customer's request. No refund (nothing
// was paid), restock inventory, no Shopify email (customer is phone-only,
// we message them on WhatsApp ourselves).
export async function cancelOrderByCustomer(
  orderId: number | string,
  staffNote: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const j = await adminGraphQL(
      `mutation($orderId: ID!, $reason: OrderCancelReason!, $staffNote: String){
         orderCancel(orderId: $orderId, reason: $reason, refund: false,
                     restock: true, staffNote: $staffNote, notifyCustomer: false){
           orderCancelUserErrors { field message }
           userErrors { field message } } }`,
      { orderId: orderGid(orderId), reason: "CUSTOMER", staffNote },
    );
    const errs = errsOf(j, "orderCancel") ??
      (Array.isArray(j?.data?.orderCancel?.orderCancelUserErrors) &&
          j.data.orderCancel.orderCancelUserErrors.length
        ? j.data.orderCancel.orderCancelUserErrors
        : null);
    if (errs) return fail(errs);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

// Order note shows in the Shopify admin order page sidebar.
export async function setOrderNote(
  orderId: number | string,
  note: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const j = await adminGraphQL(
      `mutation($input: OrderInput!){
         orderUpdate(input: $input){ userErrors { field message } } }`,
      { input: { id: orderGid(orderId), note } },
    );
    const errs = errsOf(j, "orderUpdate");
    if (errs) return fail(errs);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd promunch-email-agent/supabase/functions && deno check _shared/shopify-fulfillment.ts`
Expected: no errors. (Live verification against a real order happens in Task 11 — these can't be unit-tested without the network.)

- [ ] **Step 3: Commit**

```bash
git add promunch-email-agent/supabase/functions/_shared/shopify-fulfillment.ts
git commit -m "feat(cod-gate): Shopify hold/release/cancel/note GraphQL helpers" -- promunch-email-agent/supabase/functions/_shared/shopify-fulfillment.ts
```

---

### Task 4: Gate settings — edge defaults + flows API + Flows tab UI

**Files:**
- Modify: `promunch-email-agent/supabase/functions/_shared/flow-settings.ts`
- Modify: `src/app/api/whatsapp/flows/route.ts`
- Modify: `src/components/whatsapp/FlowsView.tsx`

**Interfaces:**
- Produces: `FlowSettings.cod_gate_enabled: boolean`, `.cod_reminder_delay_hours: number`, `.cod_needs_call_hours: number` — read by Tasks 5, 6, 8 via the existing `getFlowSettings()`.

- [ ] **Step 1: Edge defaults** — in `_shared/flow-settings.ts`, add to the `FlowSettings` interface:

```ts
  // COD confirmation gate (RTO reduction) — see _shared/cod-gate.ts
  cod_gate_enabled: boolean;
  cod_reminder_delay_hours: number;
  cod_needs_call_hours: number;
```

and to `FLOW_DEFAULTS`:

```ts
  cod_gate_enabled: false,
  cod_reminder_delay_hours: 6,
  cod_needs_call_hours: 24,
```

(The generic copy loop in `getFlowSettings()` picks up new keys automatically; missing DB columns fall back to these defaults, so this is deploy-safe pre-migration.)

- [ ] **Step 2: Flows API route** — in `src/app/api/whatsapp/flows/route.ts`: add the same three key/value pairs to `DEFAULTS`, add `"cod_gate_enabled"` to `BOOL_KEYS`, and add to `NUM_LIMITS`:

```ts
  cod_reminder_delay_hours: { min: 0.5, max: 48 },
  cod_needs_call_hours: { min: 1, max: 168 },
```

Add a cross-field check next to the existing cart ones:

```ts
  if (merged.cod_needs_call_hours <= merged.cod_reminder_delay_hours) {
    return NextResponse.json(
      { error: "needs-call escalation must come after the reminder (needs-call hours > reminder hours)" },
      { status: 400 });
  }
```

- [ ] **Step 3: FlowsView card** — in `src/components/whatsapp/FlowsView.tsx`: add the three fields to the `Settings` type (top of file, same shape as Step 1). Then add a new `FlowCard` after the order-confirmation card (~line 292), copying its exact structure/props. Content:

```tsx
        <FlowCard icon={PackageCheck} title="COD confirmation gate"
          subtitle="COD orders are held until the customer confirms on WhatsApp"
          enabled={draft.cod_gate_enabled} dimmed={!draft.cod_gate_enabled}
          onToggle={(v) => set("cod_gate_enabled", v)}>
          <SettingRow label="Send reminder after">
            <NumField value={draft.cod_reminder_delay_hours} unit="h" min={0.5} max={48}
              onChange={(v) => set("cod_reminder_delay_hours", v)} />
          </SettingRow>
          <SettingRow label="Escalate to a call after">
            <NumField value={draft.cod_needs_call_hours} unit="h" min={1} max={168}
              onChange={(v) => set("cod_needs_call_hours", v)} />
          </SettingRow>
        </FlowCard>
```

Match the file's ACTUAL child-row and prop names — read the order-confirmation and abandoned-cart cards first and mirror them exactly (e.g. if rows are plain `<div>`s with labels rather than a `SettingRow` component, do that). Icon: reuse an already-imported lucide icon (`PackageCheck` is imported for TRIGGER_LABELS).

- [ ] **Step 4: Verify**

Run: `cd promunch-email-agent/supabase/functions && deno check */index.ts && cd ../../.. && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cod-gate): flag + timings in flow settings (edge, API, Flows tab)" -- promunch-email-agent/supabase/functions/_shared/flow-settings.ts src/app/api/whatsapp/flows/route.ts src/components/whatsapp/FlowsView.tsx
```

---

### Task 5: Gated send path — `handleOrderCreated` + gateway capture + dedup ledger

**Files:**
- Modify: `promunch-email-agent/supabase/functions/_shared/order-confirmation.ts`
- Modify: `promunch-email-agent/supabase/functions/_shared/confirmations.ts`
- Modify: `promunch-email-agent/supabase/functions/shopify-webhook/index.ts`
- Modify: `src/app/api/whatsapp/confirmations/route.ts`

**Interfaces:**
- Consumes: `isCodOrder`, `GATE_TEMPLATE`, `buildVerifyVars`, `buildVerifyComponents`, `codTotalLabel` (Task 2); `holdOrderFulfillments` (Task 3); `FlowSettings.cod_gate_enabled` (Task 4); `isCreatorOrder` from `./shopify-customer.ts`.
- Produces: gated COD orders get `confirmation_status='pending'` + `confirmation_sent_at` on their `shopify_orders` row (keyed `shopify_id = order.id`); send failure sets `confirmation_status='needs_call'`.

- [ ] **Step 1: Gateway capture in shopify-webhook** — in `shopify-webhook/index.ts`, inside the `.upsert({...})` object (after `financial_status`), add:

```ts
    payment_gateway_names: Array.isArray(order.payment_gateway_names)
      ? order.payment_gateway_names
      : null,
```

⚠️ This line requires the Task 1 migration in prod BEFORE this function deploys (Global Constraints).

- [ ] **Step 2: Dedup ledger knows the gate template** — in `_shared/confirmations.ts`, the `confirmedOrderRefs()` query lists confirmation template names. Change:

```ts
    .in("template_name", ["order_confirmation", "order_confirmation_v2"])
```
to:
```ts
    // order_verify_v1 (COD gate) IS the order confirmation for gated orders —
    // without it here the sweep would see "missing" and double-message.
    .in("template_name", ["order_confirmation", "order_confirmation_v2", "order_verify_v1"])
```

Make the same list change in `src/app/api/whatsapp/confirmations/route.ts` (two spots: the `wa_messages` select `.in("template_name", ...)` and any hardcoded list nearby — search the file for `order_confirmation_v2`).

- [ ] **Step 3: Gated branch in handleOrderCreated** — in `_shared/order-confirmation.ts`:

Add imports:

```ts
import {
  buildVerifyComponents,
  buildVerifyVars,
  codTotalLabel,
  GATE_TEMPLATE,
  isCodOrder,
} from "./cod-gate.ts";
import { isCreatorOrder } from "./shopify-customer.ts";
import { holdOrderFulfillments } from "./shopify-fulfillment.ts";
```

After `const flows = await getFlowSettings();` (line ~60) add:

```ts
  // COD confirmation gate — spec docs/superpowers/specs/2026-07-08-cod-confirmation-gate-design.md
  // Gated orders get the buttoned verify template INSTEAD of the plain
  // confirmation, plus a Shopify fulfillment hold. Inert while the flag is off.
  const gated = flows.cod_gate_enabled && isCodOrder(order) && !isCreatorOrder(order);
```

In the send branch (the final `else` that currently calls `callWaSend` with `buildConfirmationTemplate`), replace the body with:

```ts
    let template: Record<string, unknown>;
    if (gated) {
      // Hold BEFORE messaging: fail-closed for shipping. A hold failure is
      // logged loudly but does not block the send — ops sees the pending
      // status in the dashboard either way.
      const hold = await holdOrderFulfillments(order.id, "Awaiting WhatsApp COD confirmation");
      if (!hold.ok) {
        await logConnector({
          connector: "shopify_wa", level: "error", event: "cod_hold_failed",
          message: `Order ${orderRef}: fulfillment hold failed — ${hold.reason}. Order is NOT hold-protected; rely on dashboard status.`,
          ref: orderRef,
        }).catch(() => {});
      }
      const vars = buildVerifyVars(
        name, orderRef,
        codTotalLabel(Number(order.total_price ?? order.current_total_price ?? 0), order.currency ?? "INR"),
      );
      template = {
        name: GATE_TEMPLATE, language: "en",
        vars, components: buildVerifyComponents(vars, order.id),
      };
    } else {
      template = buildConfirmationTemplate(name, orderRef);
    }
    const res = await callWaSend({
      to: waId,
      kind: "template",
      template,
      sent_by: gated ? "journey:cod_gate" : "journey:order_confirmation",
    });
```

Keep the existing success/failure claim handling (`markConfirmationSent`/`releaseConfirmation`) untouched below it, then append after the `logConnector` call inside that same `else` block:

```ts
    if (gated) {
      // stamp the gate state on the order row (keyed by shopify_id)
      const stamp = res?.ok
        ? { confirmation_status: "pending", confirmation_sent_at: new Date().toISOString() }
        : { confirmation_status: "needs_call" }; // send failed → human calls
      await db().from("shopify_orders").update(stamp)
        .eq("shopify_id", order.id).is("confirmation_status", null)
        .then(() => {}, () => {});
      if (!res?.ok) {
        await logConnector({
          connector: "shopify_wa", level: "error", event: "cod_gate_needs_call",
          message: `Order ${orderRef}: COD verify send failed (${res?.error ?? "unknown"}) — marked needs_call.`,
          ref: orderRef,
        }).catch(() => {});
      }
    }
```

Note: on gated send failure the confirmation claim is released (existing code) so the sweep may retry the send — the `.is("confirmation_status", null)` guard means a retry that succeeds later will NOT overwrite `needs_call` back to `pending`; that's acceptable (ops call resolves it) and never double-messages.

- [ ] **Step 4: Verify**

Run: `cd promunch-email-agent/supabase/functions && deno check */index.ts && deno test _shared/cod-gate_test.ts`
Expected: clean, tests pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cod-gate): gated verify send + fulfillment hold in handleOrderCreated" -- promunch-email-agent/supabase/functions/_shared/order-confirmation.ts promunch-email-agent/supabase/functions/_shared/confirmations.ts promunch-email-agent/supabase/functions/shopify-webhook/index.ts src/app/api/whatsapp/confirmations/route.ts
```

---

### Task 6: Button intercept — state machine in `cod-gate.ts` + `wa-webhook` hook

**Files:**
- Modify: `promunch-email-agent/supabase/functions/_shared/cod-gate.ts` (stateful handlers)
- Modify: `promunch-email-agent/supabase/functions/_shared/cod-gate_test.ts` (transition tests)
- Modify: `promunch-email-agent/supabase/functions/wa-webhook/index.ts` (intercept)

**Interfaces:**
- Consumes: Task 2 helpers, Task 3 Shopify helpers, `addOrderTags` from `./shopify-customer.ts`, `db()` from `./supabase.ts`, `logConnector` from `./connector-log.ts`.
- Produces (used by Task 7):
  - `handleGateButton(action: GateAction, shopifyId: string, waId: string, threadId: string): Promise<void>` — full button flow incl. customer messages
  - `confirmGate(shopifyId: string | number, via: "button" | "manual"): Promise<{ ok: boolean; outcome: "confirmed" | "already"; already?: string }>`
  - `cancelGate(shopifyId: string | number, via: "button" | "manual"): Promise<{ ok: boolean; outcome: "cancelled" | "already" | "guard_failed"; already?: string; reason?: string }>`

- [ ] **Step 1: Write failing transition tests** — append to `cod-gate_test.ts`:

```ts
import { decideCancelGuards } from "./cod-gate.ts";

Deno.test("decideCancelGuards: unpaid + unfulfilled → auto-cancel allowed", () => {
  assertEquals(decideCancelGuards({ financial_status: "pending", raw: {} }), { allow: true });
});

Deno.test("decideCancelGuards: paid order → manual path", () => {
  assertEquals(
    decideCancelGuards({ financial_status: "paid", raw: {} }),
    { allow: false, why: "paid" },
  );
});

Deno.test("decideCancelGuards: fulfilled order → manual path", () => {
  assertEquals(
    decideCancelGuards({ financial_status: "pending", raw: { fulfillment_status: "fulfilled" } }),
    { allow: false, why: "fulfilled" },
  );
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd promunch-email-agent/supabase/functions && deno test _shared/cod-gate_test.ts`
Expected: 3 new FAILs (`decideCancelGuards` not exported).

- [ ] **Step 3: Implement the stateful half of cod-gate.ts** — append:

```ts
import { db } from "./supabase.ts";
import { logConnector } from "./connector-log.ts";
import { addOrderTags } from "./shopify-customer.ts";
import {
  cancelOrderByCustomer,
  releaseOrderHolds,
  setOrderNote,
} from "./shopify-fulfillment.ts";

// Auto-cancel is allowed ONLY while nothing has been paid or shipped.
// Anything else goes to the manual ticket path — never auto-touch money.
export function decideCancelGuards(
  row: { financial_status: string | null; raw: any },
): { allow: true } | { allow: false; why: string } {
  if (String(row.financial_status ?? "").toLowerCase() !== "pending") {
    return { allow: false, why: "paid" };
  }
  if (row.raw?.fulfillment_status) return { allow: false, why: "fulfilled" };
  return { allow: true };
}

type OrderRow = {
  shopify_id: number;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_price: number;
  currency: string;
  financial_status: string | null;
  confirmation_status: string | null;
  raw: any;
};

const ORDER_COLS =
  "shopify_id, order_number, customer_name, customer_phone, total_price, currency, financial_status, confirmation_status, raw";

async function orderRow(shopifyId: string | number): Promise<OrderRow | null> {
  const { data } = await db().from("shopify_orders")
    .select(ORDER_COLS).eq("shopify_id", shopifyId).maybeSingle();
  return (data as OrderRow) ?? null;
}

// Atomic status transition — the row-level claim that makes taps idempotent.
// Returns the row when THIS caller won the transition, null when someone
// (double tap, ops click, another isolate) already moved it.
async function claimTransition(
  shopifyId: string | number,
  to: "confirmed" | "cancelled",
  via: "button" | "manual",
): Promise<OrderRow | null> {
  const patch: Record<string, unknown> = { confirmation_status: to, confirmed_via: via };
  if (to === "confirmed") patch.confirmed_at = new Date().toISOString();
  const { data } = await db().from("shopify_orders")
    .update(patch)
    .eq("shopify_id", shopifyId)
    .in("confirmation_status", ["pending", "needs_call"])
    .select(ORDER_COLS)
    .maybeSingle();
  return (data as OrderRow) ?? null;
}

export async function confirmGate(
  shopifyId: string | number,
  via: "button" | "manual",
): Promise<{ ok: boolean; outcome: "confirmed" | "already"; already?: string }> {
  const row = await claimTransition(shopifyId, "confirmed", via);
  if (!row) {
    const cur = await orderRow(shopifyId);
    return { ok: true, outcome: "already", already: cur?.confirmation_status ?? "unknown" };
  }
  const rel = await releaseOrderHolds(shopifyId);
  if (!rel.ok) {
    await logConnector({
      connector: "shopify_wa", level: "error", event: "cod_release_failed",
      message: `Order ${row.order_number}: confirmed but hold release failed — ${rel.reason}. Release it manually in Shopify.`,
      ref: row.order_number,
    }).catch(() => {});
  }
  await addOrderTags(shopifyId, ["WA-Confirmed"]).catch(() => {});
  await logConnector({
    connector: "shopify_wa", level: "info", event: "cod_confirmed",
    message: `Order ${row.order_number}: COD confirmed via ${via}.`, ref: row.order_number,
  }).catch(() => {});
  return { ok: true, outcome: "confirmed" };
}

export async function cancelGate(
  shopifyId: string | number,
  via: "button" | "manual",
): Promise<{ ok: boolean; outcome: "cancelled" | "already" | "guard_failed"; already?: string; reason?: string }> {
  const pre = await orderRow(shopifyId);
  if (!pre) return { ok: false, outcome: "guard_failed", reason: "order-not-found" };
  if (pre.confirmation_status !== "pending" && pre.confirmation_status !== "needs_call") {
    return { ok: true, outcome: "already", already: pre.confirmation_status ?? "unknown" };
  }
  const guards = decideCancelGuards(pre);
  if (!guards.allow) return { ok: true, outcome: "guard_failed", reason: guards.why };

  const row = await claimTransition(shopifyId, "cancelled", via);
  if (!row) {
    const cur = await orderRow(shopifyId);
    return { ok: true, outcome: "already", already: cur?.confirmation_status ?? "unknown" };
  }
  const note = via === "button"
    ? "Cancelled by customer via WhatsApp confirmation flow (button tap)"
    : "Cancelled by ops via CRM after customer call";
  const cancel = await cancelOrderByCustomer(shopifyId, note);
  if (!cancel.ok) {
    // Shopify refused after we claimed — park it for a human, never retry
    // automatically (retrying a cancel is scarier than a stuck order).
    await db().from("shopify_orders")
      .update({ confirmation_status: "needs_call", confirmed_via: null })
      .eq("shopify_id", shopifyId).then(() => {}, () => {});
    await logConnector({
      connector: "shopify_wa", level: "error", event: "cod_cancel_failed",
      message: `Order ${row.order_number}: Shopify orderCancel failed — ${cancel.reason}. Moved to needs_call.`,
      ref: row.order_number,
    }).catch(() => {});
    return { ok: false, outcome: "guard_failed", reason: cancel.reason };
  }
  await setOrderNote(shopifyId, note).catch(() => {});
  await addOrderTags(shopifyId, ["WA-Cancelled"]).catch(() => {});
  await logConnector({
    connector: "shopify_wa", level: "info", event: "cod_cancelled",
    message: `Order ${row.order_number}: auto-cancelled in Shopify (${via}).`, ref: row.order_number,
  }).catch(() => {});
  return { ok: true, outcome: "cancelled" };
}

// ---- WhatsApp-side flow (button taps) --------------------------------------

async function waSend(body: Record<string, unknown>): Promise<void> {
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((e) => console.error("[cod-gate] wa-send failed", e));
}

// FYI/urgent ping to ops on WhatsApp via the approved ops_ticket_alert
// utility template (lands outside any 24h window). Same var layout as
// wa-ai-reply/ticket.ts notifyOps.
async function pingOps(label: string, row: OrderRow, reason: string): Promise<void> {
  const to = (Deno.env.get("OPS_WA_ID") ?? "").replace(/^\+/, "").replace(/\D/g, "");
  if (!to) return;
  await waSend({
    to,
    kind: "template",
    sent_by: "cod_gate_ops",
    template: {
      name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert",
      language: "en",
      vars: {
        "1": label,
        "2": "—",
        "3": row.customer_name ?? "—",
        "4": row.customer_phone ? `+${row.customer_phone}` : "—",
        "5": reason.slice(0, 300),
      },
    },
  });
}

const statusLabel: Record<string, string> = {
  confirmed: "confirmed and on its way to packing",
  cancelled: "cancelled",
  needs_call: "with our team, we will call you shortly",
  pending: "awaiting your confirmation",
};

// Entry point for wa-webhook. All replies are free text: the customer just
// tapped, so the 24h service window is open.
export async function handleGateButton(
  action: GateAction,
  shopifyId: string,
  _waId: string,
  threadId: string,
): Promise<void> {
  const say = (text: string) =>
    waSend({ thread_id: threadId, kind: "text", sent_by: "cod_gate", text });

  const row = await orderRow(shopifyId);
  if (!row) {
    await say("Hmm, we could not find that order. Our team will take a look and get back to you 💚");
    return;
  }
  const ref = row.order_number;

  if (action === "confirm" || action === "keep") {
    const r = await confirmGate(shopifyId, "button");
    if (r.outcome === "confirmed") {
      await say(`Awesome! Order ${ref} is confirmed and heading to packing 📦 Your Munchy Pal 💚`);
    } else {
      await say(`All sorted! Order ${ref} is already ${statusLabel[r.already ?? ""] ?? r.already}. Need anything else? Just ask 😊`);
    }
    return;
  }

  if (action === "cancel_ask") {
    if (row.confirmation_status !== "pending" && row.confirmation_status !== "needs_call") {
      await say(`Order ${ref} is already ${statusLabel[row.confirmation_status ?? ""] ?? row.confirmation_status}. Need anything else? Just ask 😊`);
      return;
    }
    // fat-finger guard — no state change until they confirm the cancel
    await waSend({
      thread_id: threadId,
      kind: "interactive",
      sent_by: "cod_gate",
      interactive: {
        type: "button",
        body: { text: `You sure you want to cancel order ${ref}? 🥺` },
        footer: { text: "Your Munchy Pal 💚" },
        action: {
          buttons: [
            { type: "reply", reply: { id: `CANCELCONF_${shopifyId}`, title: "Yes, cancel it" } },
            { type: "reply", reply: { id: `KEEP_${shopifyId}`, title: "Keep my order" } },
          ],
        },
      },
    });
    return;
  }

  // action === "cancel_confirm"
  const r = await cancelGate(shopifyId, "button");
  if (r.outcome === "cancelled") {
    await say(`Done. Order ${ref} is cancelled ✅ Nothing to pay for COD orders. Hope to see you again soon 💚`);
    await pingOps("COD auto-cancel (FYI)", row, `Order ${ref} cancelled by customer via WhatsApp. No action needed.`);
  } else if (r.outcome === "already") {
    await say(`Order ${ref} is already ${statusLabel[r.already ?? ""] ?? r.already}. Need anything else? Just ask 😊`);
  } else {
    // guards failed (paid/fulfilled/API error) — manual path, urgent ticket
    await say(`Got it! We have flagged your cancellation request for order ${ref}. Our team will confirm with you shortly 💚`);
    await db().from("wa_threads").update({
      status: "human",
      ticket_status: "open",
      ticket_priority: "urgent",
      ticket_category: "order_issue",
      ticket_opened_at: new Date().toISOString(),
      escalation_reason: `COD gate: customer asked to cancel ${ref} but auto-cancel was blocked (${r.reason}). Cancel manually in Shopify.`.slice(0, 500),
    }).eq("id", threadId).then(() => {}, () => {});
    await pingOps("Cancel request (manual)", row,
      `Customer wants to cancel ${ref}; auto-cancel blocked (${r.reason}). Handle in Shopify.`);
  }
}
```

- [ ] **Step 4: wa-webhook intercept** — in `wa-webhook/index.ts`:

Add import: `import { handleGateButton, parseGatePayload } from "../_shared/cod-gate.ts";`

In `handleInboundMessage`, directly after the `if (wamid) markRead(wamid).catch(() => {});` line (i.e. message already persisted + thread snippet updated) and BEFORE the STOP block, insert:

```ts
  // COD confirmation gate — button taps carry machine payloads. Handle them
  // deterministically and never let them reach the AI. Non-gate buttons
  // (any payload not matching the gate pattern) fall through unchanged.
  const gateRaw = msg.type === "button"
    ? msg.button?.payload
    : msg.type === "interactive"
    ? msg.interactive?.button_reply?.id
    : null;
  const gate = parseGatePayload(gateRaw);
  if (gate) {
    await handleGateButton(gate.action, gate.shopifyId, waId, thread.id)
      .catch((e) => console.error("[wa-webhook] gate button failed", e));
    return;
  }
```

- [ ] **Step 5: Run tests + checks**

Run: `cd promunch-email-agent/supabase/functions && deno test _shared/cod-gate_test.ts && deno check */index.ts`
Expected: all pass, clean.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(cod-gate): button state machine + wa-webhook intercept (confirm/bounce/auto-cancel)" -- promunch-email-agent/supabase/functions/_shared/cod-gate.ts promunch-email-agent/supabase/functions/_shared/cod-gate_test.ts promunch-email-agent/supabase/functions/wa-webhook/index.ts
```

---

### Task 7: `cod-gate-action` edge function (manual dashboard actions)

**Files:**
- Create: `promunch-email-agent/supabase/functions/cod-gate-action/index.ts`
- Modify: `promunch-email-agent/supabase/config.toml` (only if per-function entries are the existing pattern — mirror whatever `wa-send` has, e.g. `verify_jwt = false`)

**Interfaces:**
- Consumes: `confirmGate`, `cancelGate` (Task 6); `requireInternal` from `../_shared/require-internal.ts`.
- Produces: `POST /functions/v1/cod-gate-action` body `{ shopify_id: number|string, action: "confirm"|"cancel" }` → `{ ok, outcome, reason? }`. Called by Task 9's Next.js route with the service-role bearer.

- [ ] **Step 1: Write the function**

```ts
// Manual COD-gate actions from the dashboard (Needs-call queue buttons).
// Mirrors the button-tap logic exactly, with confirmed_via='manual'.
// No customer WhatsApp message is sent on manual actions — ops just spoke to
// them on the phone; bias to silence (CLAUDE.md §0).

import { requireInternal } from "../_shared/require-internal.ts";
import { cancelGate, confirmGate } from "../_shared/cod-gate.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let body: { shopify_id?: number | string; action?: string };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  const id = body.shopify_id;
  if (id === undefined || id === null || !/^\d+$/.test(String(id))) {
    return j({ error: "shopify_id (numeric) required" }, 400);
  }

  if (body.action === "confirm") {
    const r = await confirmGate(id, "manual");
    return j(r, r.ok ? 200 : 500);
  }
  if (body.action === "cancel") {
    const r = await cancelGate(id, "manual");
    return j(r, r.ok ? 200 : 500);
  }
  return j({ error: "action must be 'confirm' or 'cancel'" }, 400);
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 2: config.toml** — check how existing internal functions are declared (`grep -n "wa-send" promunch-email-agent/supabase/config.toml -A2`); add a matching block for `cod-gate-action` if the pattern requires one.

- [ ] **Step 3: Check**

Run: `cd promunch-email-agent/supabase/functions && deno check cod-gate-action/index.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cod-gate): cod-gate-action edge fn for manual confirm/cancel" -- promunch-email-agent/supabase/functions/cod-gate-action promunch-email-agent/supabase/config.toml
```

---

### Task 8: Reminder + needs-call sweep in `wa-jobs-tick`

**Files:**
- Modify: `promunch-email-agent/supabase/functions/wa-jobs-tick/index.ts`

**Interfaces:**
- Consumes: `getFlowSettings` (Task 4 keys), `claimSend`/`markSendSent`/`releaseSend` from `../_shared/confirmations.ts`, `GATE_REMINDER_TEMPLATE`/`buildVerifyVars`/`buildVerifyComponents`/`codTotalLabel` (Task 2).
- Produces: pending orders older than `cod_reminder_delay_hours` get ONE reminder; older than `cod_needs_call_hours` become `needs_call` + ONE ops ping. Runs inside the existing every-minute cron.

- [ ] **Step 1: Add imports** to `wa-jobs-tick/index.ts`:

```ts
import { getFlowSettings } from "../_shared/flow-settings.ts";
import { claimSend, markSendSent, releaseSend } from "../_shared/confirmations.ts";
import {
  buildVerifyComponents,
  buildVerifyVars,
  codTotalLabel,
  GATE_REMINDER_TEMPLATE,
} from "../_shared/cod-gate.ts";
```

- [ ] **Step 2: Wire into the handler** — change the `Deno.serve` body to also run the new sweep:

```ts
  const codGate = await sweepCodGate().catch((e) => ({ error: String(e) }));
  return j({ ok: true, jobs, campaigns, reports, codGate });
```

- [ ] **Step 3: Implement the sweep** — append:

```ts
// ---- 3. COD confirmation gate sweep ----------------------------------------
// Reminders + needs-call escalation for orders stuck in 'pending'. Every send
// and every ops ping is behind an atomic claimSend key — the cron fires every
// minute, so without the claims each tick would re-send (CLAUDE.md §0).
const norm2 = (s: unknown) => String(s ?? "").trim().replace(/^#/, "");

async function sweepCodGate() {
  const flows = await getFlowSettings();
  if (!flows.cod_gate_enabled) return { skipped: "flag off" };
  const sb = db();
  const now = Date.now();
  const remBefore = new Date(now - flows.cod_reminder_delay_hours * 3600_000).toISOString();
  const callBefore = new Date(now - flows.cod_needs_call_hours * 3600_000).toISOString();

  const { data: due } = await sb.from("shopify_orders")
    .select("shopify_id, order_number, customer_name, customer_phone, total_price, currency, confirmation_sent_at")
    .eq("confirmation_status", "pending")
    .lt("confirmation_sent_at", remBefore)
    .limit(50);

  let reminded = 0, escalated = 0;
  for (const o of due ?? []) {
    const ref = norm2(o.order_number);
    if (!ref) continue;

    if (o.confirmation_sent_at < callBefore) {
      // ESCALATE — one ping ever, then park as needs_call
      if (!(await claimSend(`cod_needs_call:${ref}`))) continue;
      await sb.from("shopify_orders")
        .update({ confirmation_status: "needs_call" })
        .eq("shopify_id", o.shopify_id).eq("confirmation_status", "pending");
      const to = (Deno.env.get("OPS_WA_ID") ?? "").replace(/^\+/, "").replace(/\D/g, "");
      if (to) {
        await callWaSendTick({
          to,
          kind: "template",
          sent_by: "cod_gate_ops",
          template: {
            name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert",
            language: "en",
            vars: {
              "1": "COD confirm call",
              "2": "—",
              "3": o.customer_name ?? "—",
              "4": o.customer_phone ? `+${o.customer_phone}` : "—",
              "5": `Order ${o.order_number} (${codTotalLabel(o.total_price, o.currency)}) unconfirmed for ${flows.cod_needs_call_hours}h. Call to confirm, then flag it on the dashboard.`,
            },
          },
        });
      }
      await markSendSent(`cod_needs_call:${ref}`);
      escalated++;
      continue;
    }

    // REMIND — once per order
    if (!o.customer_phone) continue;
    if (!(await claimSend(`cod_reminder:${ref}`))) continue;
    const vars = buildVerifyVars(
      (o.customer_name ?? "there").split(/\s+/)[0],
      o.order_number,
      codTotalLabel(o.total_price, o.currency),
    );
    const res = await callWaSendTick({
      to: o.customer_phone,
      kind: "template",
      sent_by: `journey:cod_gate_reminder:${ref}`,
      template: {
        name: GATE_REMINDER_TEMPLATE, language: "en",
        vars, components: buildVerifyComponents(vars, o.shopify_id),
      },
    });
    if (res?.ok) { await markSendSent(`cod_reminder:${ref}`); reminded++; }
    else await releaseSend(`cod_reminder:${ref}`);
  }
  return { candidates: due?.length ?? 0, reminded, escalated };
}

async function callWaSendTick(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
```

NOTE the reminder template has 3 body vars (same as the main one) — Task 11 creates it with matching copy. The reminder's `sent_by` carries the orderRef suffix (existing convention for order-scoped sends).

- [ ] **Step 4: Check**

Run: `cd promunch-email-agent/supabase/functions && deno check wa-jobs-tick/index.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cod-gate): reminder + needs-call sweep in wa-jobs-tick" -- promunch-email-agent/supabase/functions/wa-jobs-tick/index.ts
```

---

### Task 9: Next.js API — needs-call queue + manual actions

**Files:**
- Create: `src/app/api/whatsapp/cod-gate/route.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/supabase-admin`; `requireAdmin` (same import the flows route uses — copy it verbatim); the Task 7 edge function.
- Produces: `GET /api/whatsapp/cod-gate` → `{ orders: [...] }` (all rows with non-null `confirmation_status` in the last 14 days); `POST` body `{ shopify_id, action: "confirm"|"cancel" }` → proxied edge result. Used by Task 10 UI.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
// use the exact same auth-gate import as src/app/api/whatsapp/flows/route.ts
// (open that file and copy its requireAdmin import line verbatim)

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("shopify_orders")
    .select("shopify_id, order_number, customer_name, customer_phone, total_price, currency, confirmation_status, confirmation_sent_at, confirmed_at, confirmed_via, shopify_created_at")
    .not("confirmation_status", "is", null)
    .gte("shopify_created_at", since)
    .order("shopify_created_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const shopifyId = String(body?.shopify_id ?? "");
  const action = String(body?.action ?? "");
  if (!/^\d+$/.test(shopifyId) || !["confirm", "cancel"].includes(action)) {
    return NextResponse.json({ error: "shopify_id + action (confirm|cancel) required" }, { status: 400 });
  }

  const r = await fetch(`${SUPABASE_URL}/functions/v1/cod-gate-action`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shopify_id: shopifyId, action }),
  });
  const out = await r.json().catch(() => ({ error: "bad edge response" }));
  return NextResponse.json(out, { status: r.ok ? 200 : 502 });
}
```

If the repo has an audit-log helper used by other admin POST routes (search `src/lib` for `audit`), call it after a successful action with `{ action: "cod_gate_" + action, target: shopifyId }` following its existing signature.

- [ ] **Step 2: Check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(cod-gate): dashboard API — gate queue + manual confirm/cancel proxy" -- src/app/api/whatsapp/cod-gate/route.ts
```

---

### Task 10: Dashboard UI — gate status + Needs-call queue on order-confirmations page

**Files:**
- Modify: `src/app/dashboard/order-confirmations/page.tsx` (239 lines — read it fully first)

**Interfaces:**
- Consumes: `GET/POST /api/whatsapp/cod-gate` (Task 9).

- [ ] **Step 1: Read the page** and note its data-fetch pattern (plain `fetch` in a client component vs React Query) and its table/card styling (`pm-` design-system classes). Mirror both.

- [ ] **Step 2: Add the gate section.** Requirements (adapt JSX to the page's existing components):

1. Fetch `/api/whatsapp/cod-gate` alongside the existing confirmations fetch.
2. Above the existing coverage table, render a **"COD gate — needs a call"** card listing orders with `confirmation_status === "needs_call"`: order number, customer name, `tel:` link on the phone, amount, hours since `confirmation_sent_at`, and two buttons:
   - **Confirm & release** → `POST { shopify_id, action: "confirm" }`
   - **Cancel order** → `window.confirm("Cancel " + order_number + " in Shopify? This cannot be undone.")` then `POST { shopify_id, action: "cancel" }`
   - On response, refetch; on `{ error }` show it inline (match the page's existing error style). Empty state: "No calls needed 🎉".
3. In the existing per-order table rows, add a small status chip when the order has a `confirmation_status`: ⏳ Pending / ✅ Confirmed (+ `via` label) / ❌ Cancelled / 📞 Needs call. Orders with `null` status show nothing (prepaid / pre-gate orders).
4. A one-line KPI strip above the card: counts of pending / confirmed / needs-call / cancelled from the fetched 14-day window.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cod-gate): needs-call queue + gate status chips on order-confirmations page" -- src/app/dashboard/order-confirmations/page.tsx
```

---

### Task 11: Rollout — checks, deploy, templates, scopes, live test, flip

Nothing in this task is code; it is the ordered runbook. **Do not reorder.**

- [ ] **Step 1: Full check suite**

```bash
cd promunch-email-agent/supabase/functions && deno check */index.ts && deno test _shared/cod-gate_test.ts
cd ../../.. && npx tsc --noEmit && npm run test && npm run build
```
Expected: everything green.

- [ ] **Step 2: Push** — `git push` (commits from Tasks 1-10 are already on main locally).

- [ ] **Step 3: Apply the migration** in the Supabase dashboard SQL editor (paste Task 1's SQL). Verify:

```sql
select column_name from information_schema.columns
 where table_name = 'shopify_orders' and column_name like 'confirm%' or column_name = 'payment_gateway_names';
select cod_gate_enabled, cod_reminder_delay_hours, cod_needs_call_hours from wa_flow_settings;
```
Expected: 5 columns listed; settings row shows `false, 6, 24`.

- [ ] **Step 4: Add Shopify scopes.** In the Shopify Dev Dashboard app (the client-credentials app whose `SHOPIFY_CLIENT_ID` is in Supabase secrets): add `read_merchant_managed_fulfillment_orders` and `write_merchant_managed_fulfillment_orders`; confirm `write_orders` and `read_orders` are present (tagging already works, so `write_orders` almost certainly is). Re-install/approve if the dashboard asks. The client-credentials token picks up new scopes on its next 24h refresh — force it by waiting for a new token (or just proceed; verify in Step 7).

- [ ] **Step 5: Deploy edge functions.** First check which functions import the changed shared modules:

```bash
cd promunch-email-agent/supabase/functions
grep -rln "order-confirmation.ts\|confirmations.ts\|flow-settings.ts\|cod-gate.ts" --include="index.ts" .
```

Deploy every listed function plus the new one (expected set):

```bash
supabase functions deploy shopify-webhook wa-webhook wa-jobs-tick wa-confirmation-sweep cod-gate-action
# plus any others the grep surfaced (e.g. shopify-wa, wa-journey-tick, nudge-pending)
```

- [ ] **Step 6: Deploy the dashboard** — `vercel --prod` from the repo root. Verify the Flows tab shows the "COD confirmation gate" card (off) and order-confirmations shows the empty needs-call card.

- [ ] **Step 7: Create the two Meta templates** via the dashboard template builder (Settings → WhatsApp → Templates → builder), category **UTILITY**, language **en**:

**`order_verify_v1`** — body:
> Hi {{1}}! Your PROMUNCH order {{2}} is in 🎉 Total: {{3}}, payable Cash on Delivery. We ship COD orders only after a quick confirmation. Please tap below 👇

Footer: `Your Munchy Pal 💚` · Buttons (quick reply): `✅ Confirm order`, `❌ Cancel order` · Examples: `Priya` / `#2091` / `₹398`.

**`order_verify_reminder_v1`** — body:
> Hi {{1}}! Friendly nudge about your PROMUNCH order {{2}} ({{3}}, Cash on Delivery). We pack it the moment you confirm. Tap below 👇

Same footer, same two buttons, same examples.

Wait for both to show **approved** (webhook auto-syncs status into `wa_templates`; utility approvals are usually minutes-to-hours). **Do not proceed until approved.**

- [ ] **Step 8: Live smoke test on a real test order.** Place a COD test order on the store with Khush's own phone number, then:

1. Flip `cod_gate_enabled` ON in the Flows tab.
2. Trigger the flow: either place the order AFTER flipping, or re-fire `handleOrderCreated` via the confirmations page force-send for that order.
3. Verify: WhatsApp arrives with both buttons; Shopify admin shows the order ON HOLD; `shopify_orders.confirmation_status = 'pending'`.
4. Tap **❌ Cancel order** → "sure?" bounce arrives → tap **Keep my order** → confirm status flips to `confirmed`, hold released, tag `WA-Confirmed` present, thank-you text arrives.
5. Place a second COD test order → tap **❌** → **Yes, cancel it** → order cancelled in Shopify with the note "Cancelled by customer via WhatsApp confirmation flow (button tap)", tag `WA-Cancelled`, customer gets the cancelled text, ops number gets the FYI ping.
6. Dashboard: both orders show correct chips; manually re-test the needs-call buttons against a third pending order if desired (temporarily set `cod_needs_call_hours` to 1 to watch the escalation fire, then restore to 24).
7. **If anything misbehaves: flip the flag OFF** (instant kill switch — everything reverts to plain confirmations) and debug.

- [ ] **Step 9: Go live.** Leave the flag ON. Watch the first day's orders on the order-confirmations page and the `#` connector-events feed for `cod_hold_failed` / `cod_cancel_failed` events.

- [ ] **Step 10: Update project memory** — mark `cod-confirmation-gate` memory as DEPLOYED with date + commit hashes, note the flag location and the two template names.

---

## Self-Review Notes (already applied)

- Spec coverage: every spec section maps to a task (migration→1, templates→11, intake→5, intercept→6, sweep→8, dashboard→9/10, manual actions→7/9, rollout→11). Metrics = the Task 10 KPI strip (phase 1 per spec).
- The gate template is registered in BOTH dedup ledgers (edge + dashboard route) — Task 5 Step 2 — closing the double-send hazard between the gate send and `wa-confirmation-sweep`.
- Type consistency: `confirmGate`/`cancelGate` signatures identical in Tasks 6 (definition) and 7 (consumption); flow-settings keys identical across Tasks 1/4/8.
