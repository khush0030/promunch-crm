# Voice Agent v2 (15-min cart call + COD confirmation call) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Call abandoned-cart customers ~15 minutes after they go quiet, and call COD customers who ignored the WhatsApp confirm buttons, with every result folded back into the WhatsApp/email flows and the CRM.

**Architecture:** Extend the existing Sarvam voice pipeline (`voice_calls` ledger, `voice-call-start`, `voice-webhook`, `voice-tool-wa-link`). A new every-minute `voice-tick` edge function owns all dialling (cart pass, COD pass, Sarvam-analytics reconcile pass). Outcome handling lives in one shared `finaliseVoiceCall()` used by both the webhook and the reconcile pass. Spec: `docs/plans/2026-10-01-voice-agent-cart-cod-design.md`.

**Tech Stack:** Supabase Edge Functions (Deno, `deno test` with std@0.224.0 assert), Postgres (hand-applied SQL), pg_cron, Next.js 16 App Router + vitest, Sarvam Voice Agents API.

## Global Constraints

- Never message (or call) a customer twice: every dial is behind an atomic claim (journey run `active→completed`, or `shopify_orders.voice_attempts` compare-and-swap) plus a DB unique index backstop.
- WhatsApp reply-behaviour and customer-flow changes: owner approved the design on 2026-10-01; deploying still needs a separate explicit owner yes.
- PROMUNCH in all caps in customer copy; no em dashes in customer-facing copy (agent prompts, tool reply messages, WA text).
- Both flags ship OFF: `voice_call_enabled` (cart) and `cod_voice_enabled` (COD). `VOICE_TEST_WA_IDS` allowlist must work for both.
- IST call window: `voice_call_start_hour` (incl.) to `voice_call_end_hour` (excl.), defaults 10 and 20.
- Reached = `status='connected'` AND (`duration_s >= 20` OR link was sent mid-call).
- Cart: max 1 real dial per cart; outside the window = no call (WA flow continues).
- COD: max `cod_voice_max_attempts` (default 2) dials, `cod_voice_retry_hours` (3) apart, first due at `confirmation_sent_at + cod_reminder_delay_hours + cod_voice_delay_hours` (6 + 2). The agent never cancels an order.
- Edge functions read config via `Deno.env` / `getAppSecret`; Next reads via env/`getSecret`. New shared edge logic goes in `_shared/`.
- Commit straight to `main` (from this worktree: `git push origin HEAD:main`). Before each commit run `git branch --show-current` / `git status` and confirm only your files are staged.
- New docs under `docs/`; update `docs/README.md`.

Working directory for all paths: repo root of this worktree. Edge commands run from `promunch-email-agent/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `promunch-email-agent/supabase/migrations/20261001120000_voice_cart_cod.sql` (new) | Schema: voice_calls purpose/attempt/tool/shopify_id, shopify_orders.voice_attempts, confirmed_via 'voice', 5 flow settings |
| `promunch-email-agent/supabase/migrations/20261001120100_voice_tick_cron.sql` (new) | pg_cron schedule for voice-tick (applied AFTER deploy) |
| `_shared/voice-eligibility.ts` (rewrite) + `_test.ts` | Pure: `cartVoiceEligibility`, `codVoiceEligibility`, `codCallDueBefore`, IST helpers |
| `_shared/voice-outcome.ts` (new) + `_test.ts` | Pure `decideOutcomeEffects`, `clampOutcome`; stateful `finaliseVoiceCall` |
| `_shared/sarvam.ts` (modify) + `sarvam_test.ts` (new) | Per-purpose agent config, outbound, analytics `listAttempts` / `fetchTranscript` |
| `_shared/voice-tool-auth.ts` (new) | Shared bearer check for Sarvam HTTPS tools |
| `_shared/voice-dial.ts` (new) | `voiceAllowlisted`, `placeVoiceCall` (ledger insert + voice-call-start) |
| `_shared/cod-gate.ts` (modify) | `via:'voice'`, `escalateNeedsCall`, `requestCancelFromVoice` |
| `_shared/flow-settings.ts` (modify) | New defaults |
| `_shared/window-asks.ts` (modify) | Exclude voice rows from inbound weave |
| `voice-tick/index.ts` (new) | Cart pass, COD pass, reconcile pass |
| `voice-tool-cod/index.ts` (new) | Mid-call COD confirm / cancel-request tool |
| `voice-call-start/index.ts` (modify) | Purpose-aware agent + variables |
| `voice-webhook/index.ts` (modify) | Delegates to `finaliseVoiceCall` |
| `voice-tool-wa-link/index.ts` (modify) | Uses shared tool auth |
| `wa-journey-tick/index.ts` (modify) | Skip voice rows, drop voice handler + stuck sweep, defer WA step while a call is dialing |
| `wa-jobs-tick/index.ts` (modify) | Uses `escalateNeedsCall` |
| `shopify-wa/index.ts` (modify) | Enrol voice run at +minutes; refresh pushes it later |
| `supabase/config.toml` (modify) | verify_jwt=false for voice-tick, voice-tool-cod |
| `src/app/api/whatsapp/flows/{route,permissions}.ts`, `src/components/whatsapp/flows/{types,copy}.ts`, `OrderSection.tsx` | Settings UI |
| `src/lib/sarvam-voice.ts`, `src/app/api/whatsapp/voice-calls/route.ts`, `VoiceView.tsx`, `src/app/api/whatsapp/threads/[id]/route.ts` + inbox message list | Call log, purpose filter, call entries in inbox |
| Docs: `docs/whatsapp/VOICE_AGENT_SETUP.md`, `docs/runbooks/CRON_TOPOLOGY.md`, canonical cron file, counts in `CLAUDE.md`/`AGENTS.md`/`docs/architecture/ARCHITECTURE.md` | |

---

### Task 1: Migration

**Files:**
- Modify: `promunch-email-agent/supabase/functions/_shared/flow-settings.ts` (new FlowSettings fields; needed by Tasks 5 and 9)
- Create: `promunch-email-agent/supabase/migrations/20261001120000_voice_cart_cod.sql`
- Create: `promunch-email-agent/supabase/migrations/20261001120100_voice_tick_cron.sql`

**Interfaces:**
- Produces: columns `voice_calls.purpose ('cart'|'cod_confirm')`, `voice_calls.attempt_no int`, `voice_calls.tool_action ('confirm'|'cancel_request'|null)`, `voice_calls.shopify_id bigint`, `shopify_orders.voice_attempts int`, `shopify_orders.confirmed_via` accepts `'voice'`, `wa_flow_settings.{cart_voice_delay_minutes, cod_voice_enabled, cod_voice_delay_hours, cod_voice_max_attempts, cod_voice_retry_hours}`.

- [ ] **Step 1: Write the schema migration**

```sql
-- Voice agent v2: 15-minute cart call + COD confirmation call.
-- Design: docs/plans/2026-10-01-voice-agent-cart-cod-design.md
-- APPLY BY HAND (Supabase SQL editor or `supabase db query --linked`), BEFORE deploying the functions.

alter table voice_calls
  add column if not exists purpose     text not null default 'cart',
  add column if not exists attempt_no  int  not null default 1,
  add column if not exists tool_action text,
  add column if not exists shopify_id  bigint;

do $$ begin
  alter table voice_calls add constraint voice_calls_purpose_check
    check (purpose in ('cart','cod_confirm'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table voice_calls add constraint voice_calls_tool_action_check
    check (tool_action is null or tool_action in ('confirm','cancel_request'));
exception when duplicate_object then null; end $$;

-- DB backstop for "never call twice": one live COD dial per order per attempt
-- number. start_failed rows are excluded so a failed start can be retried with
-- the same attempt number (the customer's phone never rang).
create unique index if not exists voice_calls_cod_attempt_uq
  on voice_calls (shopify_id, attempt_no)
  where purpose = 'cod_confirm' and status <> 'start_failed';
create index if not exists voice_calls_purpose_created_idx on voice_calls (purpose, created_at desc);
create index if not exists voice_calls_shopify_idx on voice_calls (shopify_id) where shopify_id is not null;

-- Row-level claim counter for COD dials (compare-and-swap in voice-tick).
alter table shopify_orders add column if not exists voice_attempts int not null default 0;

alter table shopify_orders drop constraint if exists shopify_orders_confirmed_via_check;
alter table shopify_orders add constraint shopify_orders_confirmed_via_check
  check (confirmed_via in ('button','manual','voice'));

alter table wa_flow_settings
  add column if not exists cart_voice_delay_minutes numeric not null default 15,
  add column if not exists cod_voice_enabled        boolean not null default false,
  add column if not exists cod_voice_delay_hours    numeric not null default 2,
  add column if not exists cod_voice_max_attempts   int     not null default 2,
  add column if not exists cod_voice_retry_hours    numeric not null default 3;

do $$ begin
  alter table wa_flow_settings add constraint wa_flow_settings_cart_voice_delay_minutes_check
    check (cart_voice_delay_minutes between 5 and 180);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table wa_flow_settings add constraint wa_flow_settings_cod_voice_check
    check (cod_voice_delay_hours > 0 and cod_voice_retry_hours > 0 and cod_voice_max_attempts between 1 and 3);
exception when duplicate_object then null; end $$;
```

- [ ] **Step 2: Write the cron migration (applied only after voice-tick is deployed)**

```sql
-- voice-tick: every minute. Apply AFTER `supabase functions deploy voice-tick`
-- (scheduling first would 404 every minute). _cron_post comes from
-- 20260705100000_cron_jobs_canonical.sql.
select cron.unschedule('voice-tick') where exists (select 1 from cron.job where jobname = 'voice-tick');
select cron.schedule('voice-tick', '* * * * *',
  _cron_post('https://hlykspakpewuilttnydm.supabase.co/functions/v1/voice-tick', 'service_role_key'));
```

- [ ] **Step 2b: flow-settings.ts** (`promunch-email-agent/supabase/functions/_shared/flow-settings.ts`) — add to `FlowSettings` (after `voice_language`) and `FLOW_DEFAULTS`:

```ts
  cart_voice_delay_minutes: number; // minutes of checkout silence before the cart call
  cod_voice_enabled: boolean;       // COD confirmation call (needs cod_gate_enabled too)
  cod_voice_delay_hours: number;    // hours after the COD reminder before the first call
  cod_voice_max_attempts: number;
  cod_voice_retry_hours: number;
```
```ts
  cart_voice_delay_minutes: 15,
  cod_voice_enabled: false,
  cod_voice_delay_hours: 2,
  cod_voice_max_attempts: 2,
  cod_voice_retry_hours: 3,
```
Update the comment on `voice_call_enabled` to `// Sarvam cart call (~15 min after the cart goes quiet; voice-tick dials)` and on `cart_voice_delay_hours` to `// UNUSED since 2026-10-01 (call-first); kept until the column is dropped`.

- [ ] **Step 3: Commit**

```bash
git add promunch-email-agent/supabase/functions/_shared/flow-settings.ts promunch-email-agent/supabase/migrations/20261001120000_voice_cart_cod.sql promunch-email-agent/supabase/migrations/20261001120100_voice_tick_cron.sql
git commit -m "feat(voice): schema for 15-min cart call and COD confirmation call"
```

---

### Task 2: Pure eligibility rules

**Files:**
- Modify (rewrite body): `promunch-email-agent/supabase/functions/_shared/voice-eligibility.ts`
- Modify (rewrite): `promunch-email-agent/supabase/functions/_shared/voice-eligibility_test.ts`

**Interfaces:**
- Produces:
  - `VOICE_TEMPLATE = "voice_cart_call"` (unchanged; shopify-wa imports it)
  - `istHour(nowMs)`, `inCallWindow(nowMs, start, end)`, `nextWindowOpen(nowMs, start)` (unchanged)
  - `cartVoiceEligibility(i: CartVoiceInput): VoiceVerdict` where `VoiceVerdict = {action:"call"} | {action:"cancel";reason} | {action:"defer";minutes;reason}`
  - `codVoiceEligibility(i: CodVoiceInput): CodVerdict` where `CodVerdict = {action:"call"} | {action:"skip";reason}`
  - `codCallDueBefore(nowMs, reminderHours, voiceDelayHours): string` (ISO)
- Removes: `voiceEligibility`, `VoiceEligibilityInput`, `CART_ATTEMPT_CAP` (only wa-journey-tick used them; Task 9 removes that use).

- [ ] **Step 1: Write the failing tests** (replace the file; keep the 4 existing IST tests at the top unchanged, then append)

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cartVoiceEligibility, CartVoiceInput, codCallDueBefore, codVoiceEligibility, CodVoiceInput,
  inCallWindow, istHour, nextWindowOpen,
} from "./voice-eligibility.ts";

// (keep the existing T_* constants and the istHour / window / nextWindowOpen tests here)

const cart = (o: Partial<CartVoiceInput> = {}): CartVoiceInput => ({
  enabled: true, inWindow: true, cartTotal: 500, minCartValue: 0, voiceDnd: false, optedIn: true,
  inboundSinceEnrol: false, openTicket: false, allowlisted: true, cartDialled: false, cartInFlight: false,
  connectedWithin7d: false, ...o,
});

Deno.test("cart: happy path calls", () => {
  assertEquals(cartVoiceEligibility(cart()), { action: "call" });
});
Deno.test("cart: outside window cancels (WA flow takes over), never defers", () => {
  assertEquals(cartVoiceEligibility(cart({ inWindow: false })), { action: "cancel", reason: "outside_call_window" });
});
Deno.test("cart: in-flight dial defers 15 min", () => {
  assertEquals(cartVoiceEligibility(cart({ cartInFlight: true })), { action: "defer", minutes: 15, reason: "call_in_flight" });
});
Deno.test("cart: one real dial per cart", () => {
  assertEquals(cartVoiceEligibility(cart({ cartDialled: true })).action, "cancel");
});
Deno.test("cart: every guard cancels", () => {
  for (const o of [
    { enabled: false }, { voiceDnd: true }, { optedIn: false }, { inboundSinceEnrol: true },
    { openTicket: true }, { allowlisted: false }, { connectedWithin7d: true }, { cartTotal: 100, minCartValue: 499 },
  ] as Partial<CartVoiceInput>[]) {
    assertEquals(cartVoiceEligibility(cart(o)).action, "cancel", JSON.stringify(o));
  }
});

const NOW = Date.parse("2026-10-01T06:30:00Z"); // 12:00 IST
const cod = (o: Partial<CodVoiceInput> = {}): CodVoiceInput => ({
  enabled: true, inWindow: true, status: "pending", voiceDnd: false, allowlisted: true,
  attempts: 0, maxAttempts: 2, lastCallStatus: null, lastCallAtMs: null, nowMs: NOW, retryHours: 3, ...o,
});

Deno.test("cod: first attempt calls", () => {
  assertEquals(codVoiceEligibility(cod()), { action: "call" });
});
Deno.test("cod: retry only after spacing", () => {
  assertEquals(codVoiceEligibility(cod({ attempts: 1, lastCallStatus: "no_answer", lastCallAtMs: NOW - 2 * 3600_000 })),
    { action: "skip", reason: "retry_spacing" });
  assertEquals(codVoiceEligibility(cod({ attempts: 1, lastCallStatus: "no_answer", lastCallAtMs: NOW - 3 * 3600_000 })),
    { action: "call" });
});
Deno.test("cod: guards skip", () => {
  assertEquals(codVoiceEligibility(cod({ status: "confirmed" })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ attempts: 2 })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ lastCallStatus: "dialing", lastCallAtMs: NOW - 10 * 3600_000 })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ voiceDnd: true })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ inWindow: false })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ enabled: false })).action, "skip");
  assertEquals(codVoiceEligibility(cod({ allowlisted: false })).action, "skip");
});
Deno.test("cod: due-before = now minus reminder + voice delay", () => {
  assertEquals(codCallDueBefore(NOW, 6, 2), new Date(NOW - 8 * 3600_000).toISOString());
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd promunch-email-agent && deno test supabase/functions/_shared/voice-eligibility_test.ts`
Expected: FAIL (`cartVoiceEligibility` is not exported).

- [ ] **Step 3: Implement.** Keep the file header comment's first two lines, `VOICE_TEMPLATE`, `IST_OFFSET_MS`, `istHour`, `inCallWindow`, `nextWindowOpen`. Delete the long RETRY RULE comment, `CART_ATTEMPT_CAP`, `VoiceEligibilityInput`, `voiceEligibility`, and add:

```ts
// CART (call-first, 2026-10-01 design): one call ~15 minutes after the cart goes
// quiet. Every "no" is a CANCEL, never a defer: a cart call that slips hours is
// a creepy call, and the WhatsApp + email sequence still covers the cart. The
// only defer is a dial already in flight for this cart.
export interface CartVoiceInput {
  enabled: boolean;
  inWindow: boolean;
  cartTotal: number;
  minCartValue: number;
  voiceDnd: boolean;
  optedIn: boolean;
  inboundSinceEnrol: boolean;
  openTicket: boolean;
  allowlisted: boolean;
  /** A real dial (Sarvam accepted it) already exists for this cart. */
  cartDialled: boolean;
  /** A dial for this cart is still 'dialing'. */
  cartInFlight: boolean;
  /** Any cart call for this customer CONNECTED in the last 7 days. */
  connectedWithin7d: boolean;
}

export type VoiceVerdict =
  | { action: "call" }
  | { action: "cancel"; reason: string }
  | { action: "defer"; minutes: number; reason: string };

export function cartVoiceEligibility(i: CartVoiceInput): VoiceVerdict {
  const cancel = (reason: string): VoiceVerdict => ({ action: "cancel", reason });
  if (!i.enabled) return cancel("voice_disabled");
  if (i.cartInFlight) return { action: "defer", minutes: 15, reason: "call_in_flight" };
  if (i.cartDialled) return cancel("cart_already_called");
  if (i.connectedWithin7d) return cancel("connected_within_7d");
  if (i.voiceDnd) return cancel("voice_dnd");
  if (!i.optedIn) return cancel("wa_opted_out");
  if (i.inboundSinceEnrol) return cancel("wa_engaged");
  if (i.openTicket) return cancel("open_ticket");
  if (i.cartTotal < i.minCartValue) return cancel("below_min_cart_value");
  if (!i.allowlisted) return cancel("not_in_test_allowlist");
  if (!i.inWindow) return cancel("outside_call_window");
  return { action: "call" };
}

// COD: there is no run row to cancel, so a "no" is a SKIP for this tick; the
// order stays pending and the 24h needs_call sweep (wa-jobs-tick) still covers
// it. Marketing opt-out is deliberately NOT a guard: confirming an order the
// customer placed is transactional. voice_dnd (they said "don't call me") is.
export interface CodVoiceInput {
  enabled: boolean;
  inWindow: boolean;
  status: string | null;
  voiceDnd: boolean;
  allowlisted: boolean;
  attempts: number;
  maxAttempts: number;
  lastCallStatus: string | null;
  lastCallAtMs: number | null;
  nowMs: number;
  retryHours: number;
}

export type CodVerdict = { action: "call" } | { action: "skip"; reason: string };

export function codVoiceEligibility(i: CodVoiceInput): CodVerdict {
  const skip = (reason: string): CodVerdict => ({ action: "skip", reason });
  if (!i.enabled) return skip("cod_voice_disabled");
  if (i.status !== "pending") return skip("not_pending");
  if (i.voiceDnd) return skip("voice_dnd");
  if (!i.allowlisted) return skip("not_in_test_allowlist");
  if (i.attempts >= i.maxAttempts) return skip("attempt_cap_reached");
  if (i.lastCallStatus === "dialing") return skip("call_in_flight");
  if (i.lastCallAtMs !== null && i.nowMs - i.lastCallAtMs < i.retryHours * 3600_000) return skip("retry_spacing");
  if (!i.inWindow) return skip("outside_call_window");
  return { action: "call" };
}

/** Orders whose confirmation_sent_at is before this are due their first COD call. */
export function codCallDueBefore(nowMs: number, reminderHours: number, voiceDelayHours: number): string {
  return new Date(nowMs - (reminderHours + voiceDelayHours) * 3600_000).toISOString();
}
```

- [ ] **Step 4: Run tests**

Run: `deno test supabase/functions/_shared/voice-eligibility_test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add promunch-email-agent/supabase/functions/_shared/voice-eligibility*.ts
git commit -m "feat(voice): call-first cart rules and COD call rules"
```

---

### Task 3: Sarvam client (per-purpose agent + analytics)

**Files:**
- Modify: `promunch-email-agent/supabase/functions/_shared/sarvam.ts`
- Create: `promunch-email-agent/supabase/functions/_shared/sarvam_test.ts`

**Interfaces:**
- Produces:
  - `type VoicePurpose = "cart" | "cod_confirm"`
  - `sarvamConfig(purpose?: VoicePurpose): Promise<SarvamConfig | null>` (cod uses `SARVAM_COD_APP_ID` / `SARVAM_COD_APP_VERSION`)
  - `startOutboundCall({ purpose, phoneE164, agentVariables, language, webhookUrl, metadata })`
  - `normalizeAttempt(raw): NormalizedAttempt` (pure, exported for tests)
  - `listAttempts(purpose, sinceISO, untilISO, limit): Promise<NormalizedAttempt[]>`
  - `fetchTranscript(purpose, interactionId): Promise<Array<{role:"agent"|"user"; en_text:string}>>`
  - `NormalizedAttempt = { attemptId; interactionId: string|null; status: "connected"|"no_answer"|"busy"|"failed"|"unknown"; durationSeconds: number|null; failureReason: string|null; agentVariables: Record<string, unknown> }`

- [ ] **Step 1: Failing test**

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAttempt } from "./sarvam.ts";

Deno.test("normalizeAttempt maps Sarvam analytics rows", () => {
  const a = normalizeAttempt({
    attempt_id: "att-1", interaction_id: "NO_INTERACTION", connectivity_status: "No_Answer",
    duration_in_seconds: "0", failure_reason: "NO_FAILURE", agent_variables: { call_disposition: "unknown" },
  });
  assertEquals(a, {
    attemptId: "att-1", interactionId: null, status: "no_answer", durationSeconds: 0,
    failureReason: null, agentVariables: { call_disposition: "unknown" },
  });
});
Deno.test("normalizeAttempt: unfinished attempt is unknown", () => {
  assertEquals(normalizeAttempt({ attempt_id: "x", connectivity_status: "in_progress" }).status, "unknown");
});
```

- [ ] **Step 2: Run** `deno test supabase/functions/_shared/sarvam_test.ts` → FAIL (no export).

- [ ] **Step 3: Implement.** In `sarvam.ts`:

```ts
export type VoicePurpose = "cart" | "cod_confirm";

export async function sarvamConfig(purpose: VoicePurpose = "cart"): Promise<SarvamConfig | null> {
  const apiKey = await getAppSecret("SARVAM_API_KEY");
  const orgId = Deno.env.get("SARVAM_ORG_ID");
  const workspaceId = Deno.env.get("SARVAM_WORKSPACE_ID");
  // Each purpose is its own Sarvam agent (different prompt, variables and tool).
  const appId = Deno.env.get(purpose === "cod_confirm" ? "SARVAM_COD_APP_ID" : "SARVAM_APP_ID");
  const appVersion = Number(Deno.env.get(purpose === "cod_confirm" ? "SARVAM_COD_APP_VERSION" : "SARVAM_APP_VERSION") ?? "1");
  const connectionId = Deno.env.get("SARVAM_CONNECTION_ID");
  const agentPhone = Deno.env.get("SARVAM_AGENT_PHONE");
  if (!apiKey || !orgId || !workspaceId || !appId || !connectionId || !agentPhone) return null;
  return { apiKey, orgId, workspaceId, appId, appVersion, connectionId, agentPhone };
}
```

`startOutboundCall` gains `purpose: VoicePurpose` in its args object and calls `sarvamConfig(args.purpose)`; the error string becomes `` `sarvam not configured for ${args.purpose} (missing SARVAM_* secrets)` ``. `addToDndList` keeps `sarvamConfig()`.

Append the analytics client (ported from `src/lib/sarvam-voice.ts`, which stays as the Next-side copy):

```ts
// ---- Analytics (reconcile path) --------------------------------------------
// Sarvam's post-call webhook has not been reliably delivered to us (see
// VoiceView.tsx), so voice-tick polls the per-agent analytics API for calls
// stuck on 'dialing'. Same shapes as src/lib/sarvam-voice.ts.

const SENTINEL_RE = /^NO_[A-Z_]+$/;
const sentinel = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v);
  return s.length === 0 || SENTINEL_RE.test(s) ? null : s;
};
const TERMINAL = new Set(["connected", "no_answer", "busy", "failed"]);

export interface NormalizedAttempt {
  attemptId: string;
  interactionId: string | null;
  status: "connected" | "no_answer" | "busy" | "failed" | "unknown";
  durationSeconds: number | null;
  failureReason: string | null;
  agentVariables: Record<string, unknown>;
}

export function normalizeAttempt(raw: Record<string, unknown>): NormalizedAttempt {
  const s = String(raw?.connectivity_status ?? "").toLowerCase().trim();
  const d = raw?.duration_in_seconds;
  const dn = d == null || Number.isNaN(Number(d)) ? null : Number(d);
  return {
    attemptId: String(raw?.attempt_id ?? ""),
    interactionId: sentinel(raw?.interaction_id),
    status: (TERMINAL.has(s) ? s : "unknown") as NormalizedAttempt["status"],
    durationSeconds: dn,
    failureReason: sentinel(raw?.failure_reason),
    agentVariables: raw?.agent_variables && typeof raw.agent_variables === "object"
      ? raw.agent_variables as Record<string, unknown> : {},
  };
}

export async function listAttempts(
  purpose: VoicePurpose, sinceISO: string, untilISO: string, limit = 200,
): Promise<NormalizedAttempt[]> {
  const cfg = await sarvamConfig(purpose);
  if (!cfg) return [];
  const url = `${BASE}/analytics/v1/${cfg.orgId}/${cfg.workspaceId}/${cfg.appId}/attempts` +
    `?start_datetime=${encodeURIComponent(sinceISO)}&end_datetime=${encodeURIComponent(untilISO)}&limit=${limit}`;
  try {
    const r = await fetch(url, { headers: { "X-API-Key": cfg.apiKey } });
    if (!r.ok) return [];
    const json = await r.json().catch(() => null) as { items?: unknown[] } | null;
    return (Array.isArray(json?.items) ? json!.items! : []).map((x) => normalizeAttempt(x as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function fetchTranscript(
  purpose: VoicePurpose, interactionId: string,
): Promise<Array<{ role: "agent" | "user"; en_text: string }>> {
  const cfg = await sarvamConfig(purpose);
  if (!cfg) return [];
  try {
    const r = await fetch(
      `${BASE}/analytics/v1/${cfg.orgId}/${cfg.workspaceId}/${cfg.appId}/transcripts/${encodeURIComponent(interactionId)}`,
      { headers: { "X-API-Key": cfg.apiKey } },
    );
    if (!r.ok) return [];
    const json = await r.json().catch(() => null) as { messages?: Array<{ role?: string; content?: string }> } | null;
    return (json?.messages ?? []).map((m) => ({ role: m.role === "assistant" ? "agent" : "user", en_text: String(m.content ?? "") }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run** `deno test supabase/functions/_shared/sarvam_test.ts` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(voice): per-purpose Sarvam agent config and analytics client"`

---

### Task 4: COD gate helpers (voice confirm, shared escalation, voice cancel request)

**Files:**
- Modify: `promunch-email-agent/supabase/functions/_shared/cod-gate.ts`
- Modify: `promunch-email-agent/supabase/functions/wa-jobs-tick/index.ts:250-283`
- Test: `promunch-email-agent/supabase/functions/_shared/cod-gate_test.ts` (existing tests must stay green)

**Interfaces:**
- Produces:
  - `confirmGate(shopifyId, via: "button" | "manual" | "voice")`
  - `escalateNeedsCall(shopifyId: string | number, reason: string, label?: string): Promise<boolean>` (true = this caller escalated)
  - `requestCancelFromVoice(shopifyId: string | number): Promise<{ ok: boolean; outcome: "flagged" | "already" | "not_found"; already?: string }>`

- [ ] **Step 1:** Widen the `via` type to `"button" | "manual" | "voice"` in `claimTransition` and `confirmGate`. (`cancelGate` stays `"button" | "manual"`: voice never cancels.)

- [ ] **Step 2:** Add imports at the existing import block: `import { claimSend, markSendSent, releaseSend } from "./confirmations.ts";` (check `confirmations.ts` does not import `cod-gate.ts`; it must not, or move the import). Add a result-returning sender next to `waSend` and the two helpers after `pingOps`:

```ts
async function waSendOk(body: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({})) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

const refOf = (s: unknown) => String(s ?? "").trim().replace(/^#/, "");

// Park a pending COD order for a human and ping ops ONCE. Shared by the 24h
// sweep (wa-jobs-tick) and the voice path (voice-tick / finaliseVoiceCall), so
// both use the same claim key and ops never gets two pings for one order.
export async function escalateNeedsCall(
  shopifyId: string | number, reason: string, label = "COD confirm call",
): Promise<boolean> {
  const row = await orderRow(shopifyId);
  if (!row) return false;
  const ref = refOf(row.order_number);
  if (!ref || !(await claimSend(`cod_needs_call:${ref}`))) return false;
  await db().from("shopify_orders").update({ confirmation_status: "needs_call" })
    .eq("shopify_id", shopifyId).eq("confirmation_status", "pending");
  const to = (Deno.env.get("OPS_WA_ID") ?? "").replace(/^\+/, "").replace(/\D/g, "");
  let pinged = true;
  if (to) {
    pinged = await waSendOk({
      to, kind: "template", sent_by: "cod_gate_ops",
      template: {
        name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert", language: "en",
        vars: {
          "1": label, "2": "—", "3": row.customer_name ?? "—",
          "4": row.customer_phone ? `+${row.customer_phone}` : "—", "5": reason.slice(0, 300),
        },
      },
    });
  }
  // Internal message: retry-bias. Lock only when the ping went out.
  if (pinged) await markSendSent(`cod_needs_call:${ref}`); else await releaseSend(`cod_needs_call:${ref}`);
  return true;
}

// Customer said "cancel" on the COD voice call. The agent never cancels:
// park the order for ops, open an urgent ticket on the WhatsApp thread, and
// ping ops once (same claim as escalateNeedsCall).
export async function requestCancelFromVoice(
  shopifyId: string | number,
): Promise<{ ok: boolean; outcome: "flagged" | "already" | "not_found"; already?: string }> {
  const row = await orderRow(shopifyId);
  if (!row) return { ok: false, outcome: "not_found" };
  if (row.confirmation_status === "confirmed" || row.confirmation_status === "cancelled") {
    return { ok: true, outcome: "already", already: row.confirmation_status };
  }
  const ref = refOf(row.order_number);
  if (row.customer_phone) {
    await db().from("wa_threads").update({
      status: "human", ticket_status: "open", ticket_priority: "urgent", ticket_category: "order_issue",
      ticket_opened_at: new Date().toISOString(),
      escalation_reason: `COD voice call: customer asked to cancel ${ref}. Cancel it in Shopify, then mark it on the dashboard.`,
    }).eq("wa_id", row.customer_phone).then(() => {}, () => {});
  }
  await escalateNeedsCall(shopifyId,
    `Customer asked on the COD voice call to cancel ${ref}. Cancel it in Shopify, then mark it on the dashboard.`,
    "Cancel request (voice call)");
  await logConnector({
    connector: "shopify_wa", level: "info", event: "cod_voice_cancel_request",
    message: `Order ${row.order_number}: customer asked to cancel on the voice call. Parked for ops.`, ref: row.order_number,
  }).catch(() => {});
  return { ok: true, outcome: "flagged" };
}
```

- [ ] **Step 3:** In `wa-jobs-tick/index.ts` `sweepCodGate`, replace the whole `if (o.confirmation_sent_at < callBefore) { ... continue; }` block with:

```ts
    if (o.confirmation_sent_at < callBefore) {
      // ESCALATE — one ping ever (shared with the voice path), then park as needs_call
      if (await escalateNeedsCall(
        o.shopify_id,
        `Order ${o.order_number} (${codTotalLabel(o.total_price, o.currency)}) unconfirmed for ${flows.cod_needs_call_hours}h. Call to confirm, then flag it on the dashboard.`,
      )) escalated++;
      continue;
    }
```

and add `escalateNeedsCall` to its import from `../_shared/cod-gate.ts`. Remove imports that become unused (`markSendSent`/`releaseSend` only if nothing else in the file uses them; `claimSend` is still used by the reminder path).

- [ ] **Step 4: Verify**

Run: `cd promunch-email-agent && deno test supabase/functions/_shared/cod-gate_test.ts && deno check supabase/functions/wa-jobs-tick/index.ts supabase/functions/_shared/cod-gate.ts`
Expected: tests pass, no type errors.

- [ ] **Step 5: Commit** `git commit -m "refactor(cod): shared needs_call escalation; voice confirm and cancel-request helpers"`

---

### Task 5: Outcome logic (`voice-outcome.ts`)

**Files:**
- Create: `promunch-email-agent/supabase/functions/_shared/voice-outcome.ts`
- Create: `promunch-email-agent/supabase/functions/_shared/voice-outcome_test.ts`

**Interfaces:**
- Consumes: `escalateNeedsCall` (Task 4), `addToDndList` (sarvam.ts), `getFlowSettings`.
- Produces:
  - `REACHED_MIN_SECONDS = 20`
  - `clampOutcome(v: unknown): string` over `VOICE_OUTCOMES = ["will_buy","asked_link","not_interested","do_not_call","callback_later","confirmed","cancel_requested","unclear","unknown"]`
  - `decideOutcomeEffects(i: OutcomeInput): OutcomeEffects`
  - `finaliseVoiceCall(callId: string, r: CallResult): Promise<"finalised" | "dup" | "retry">`
  - `CallResult = { status: "connected"|"no_answer"|"busy"|"failed"; durationS: number|null; outcome: string; interactionId: string|null; failureReason: string|null; transcript: unknown; agentVars: Record<string, unknown>|null }`

- [ ] **Step 1: Failing tests**

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clampOutcome, decideOutcomeEffects, OutcomeInput } from "./voice-outcome.ts";

const base = (o: Partial<OutcomeInput> = {}): OutcomeInput => ({
  purpose: "cart", status: "connected", durationS: 45, outcome: "will_buy", linkSent: false,
  toolAction: null, attemptNo: 1, maxAttempts: 2, ...o,
});

Deno.test("cart reached cancels WA nudges", () => {
  assertEquals(decideOutcomeEffects(base()), { reached: true, setDnd: false, cancelCartRuns: true, codEscalate: null });
});
Deno.test("cart: a 5s pickup is not reached, unless the link went out", () => {
  assertEquals(decideOutcomeEffects(base({ durationS: 5 })).cancelCartRuns, false);
  assertEquals(decideOutcomeEffects(base({ durationS: 5, linkSent: true })).cancelCartRuns, true);
});
Deno.test("cart no answer leaves WA flow alone", () => {
  assertEquals(decideOutcomeEffects(base({ status: "no_answer", durationS: 0 })),
    { reached: false, setDnd: false, cancelCartRuns: false, codEscalate: null });
});
Deno.test("do_not_call sets dnd", () => {
  assertEquals(decideOutcomeEffects(base({ outcome: "do_not_call" })).setDnd, true);
});
Deno.test("cod: tool already acted -> nothing more", () => {
  assertEquals(decideOutcomeEffects(base({ purpose: "cod_confirm", toolAction: "confirm" })).codEscalate, null);
});
Deno.test("cod: reached without a decision escalates", () => {
  const e = decideOutcomeEffects(base({ purpose: "cod_confirm", outcome: "callback_later" }));
  assertEquals(e.codEscalate !== null, true);
  assertEquals(e.cancelCartRuns, false);
});
Deno.test("cod: unanswered escalates only on the last attempt", () => {
  assertEquals(decideOutcomeEffects(base({ purpose: "cod_confirm", status: "busy", attemptNo: 1 })).codEscalate, null);
  assertEquals(decideOutcomeEffects(base({ purpose: "cod_confirm", status: "busy", attemptNo: 2 })).codEscalate !== null, true);
});
Deno.test("clampOutcome", () => {
  assertEquals(clampOutcome("Confirmed"), "confirmed");
  assertEquals(clampOutcome("lol"), "unknown");
  assertEquals(clampOutcome(undefined), "unknown");
});
```

- [ ] **Step 2: Run** `deno test supabase/functions/_shared/voice-outcome_test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// What a finished voice call MEANS for the rest of the system. One place,
// used by both voice-webhook (Sarvam push) and voice-tick's reconcile pass
// (Sarvam analytics poll), so the two can never disagree.
// Design: docs/plans/2026-10-01-voice-agent-cart-cod-design.md §3.7

import { db } from "./supabase.ts";
import { addToDndList, type VoicePurpose } from "./sarvam.ts";
import { escalateNeedsCall } from "./cod-gate.ts";
import { getFlowSettings } from "./flow-settings.ts";
import { logConnector } from "./connector-log.ts";

export const REACHED_MIN_SECONDS = 20;

export const VOICE_OUTCOMES = [
  // cart agent
  "will_buy", "asked_link", "not_interested", "callback_later",
  // cod agent
  "confirmed", "cancel_requested", "unclear",
  // both
  "do_not_call", "unknown",
] as const;
const OUTCOME_SET = new Set<string>(VOICE_OUTCOMES);

export function clampOutcome(v: unknown): string {
  const s = String(v ?? "unknown").toLowerCase().trim();
  return OUTCOME_SET.has(s) ? s : "unknown";
}

export type CallStatus = "connected" | "no_answer" | "busy" | "failed";

export interface OutcomeInput {
  purpose: VoicePurpose;
  status: CallStatus;
  durationS: number | null;
  outcome: string;
  linkSent: boolean;
  toolAction: string | null;
  attemptNo: number;
  maxAttempts: number;
}

export interface OutcomeEffects {
  reached: boolean;
  setDnd: boolean;
  cancelCartRuns: boolean;
  /** Non-null = park the COD order for ops with this reason. */
  codEscalate: string | null;
}

export function decideOutcomeEffects(i: OutcomeInput): OutcomeEffects {
  const reached = i.status === "connected" && (i.linkSent || (i.durationS ?? 0) >= REACHED_MIN_SECONDS);
  const setDnd = i.outcome === "do_not_call";
  if (i.purpose === "cart") return { reached, setDnd, cancelCartRuns: reached, codEscalate: null };
  let codEscalate: string | null = null;
  if (!i.toolAction) {
    if (reached) codEscalate = `Spoke to the customer on the COD call, no decision (${i.outcome}). Call to confirm.`;
    else if (i.attemptNo >= i.maxAttempts) {
      codEscalate = `COD voice call not answered after ${i.attemptNo} attempt(s) (${i.status}). Call to confirm.`;
    }
  }
  return { reached, setDnd, cancelCartRuns: false, codEscalate };
}

export interface CallResult {
  status: CallStatus;
  durationS: number | null;
  outcome: string;
  interactionId: string | null;
  failureReason: string | null;
  transcript: unknown;
  agentVars: Record<string, unknown> | null;
}

type Row = {
  id: string; run_id: string | null; wa_id: string; order_ref: string | null; status: string;
  purpose: VoicePurpose; attempt_no: number; tool_action: string | null; link_sent_at: string | null;
  shopify_id: number | null;
};

export async function finaliseVoiceCall(callId: string, r: CallResult): Promise<"finalised" | "dup" | "retry"> {
  const sb = db();
  const { data } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, order_ref, status, purpose, attempt_no, tool_action, link_sent_at, shopify_id")
    .eq("id", callId).maybeSingle();
  const call = data as Row | null;
  if (!call || (call.status !== "dialing" && call.status !== "unknown")) return "dup";
  const now = new Date().toISOString();

  // do_not_call FIRST: if this write fails the row must stay retryable, or the
  // customer's request is lost for good (see api/whatsapp/voice-calls/sync).
  if (r.outcome === "do_not_call") {
    const { error } = await sb.from("wa_contacts").update({ voice_dnd: true, updated_at: now }).eq("wa_id", call.wa_id);
    if (error) {
      await logConnector({ connector: "shopify_wa", level: "error", event: "voice_dnd_write_failed", message: `${call.wa_id}: ${error.message}. Call ${call.id} left open for retry.`, ref: call.id }).catch(() => {});
      return "retry";
    }
  }

  const { data: won } = await sb.from("voice_calls").update({
    status: r.status, outcome: r.outcome, duration_s: r.durationS, failure_reason: r.failureReason,
    interaction_id: r.interactionId, transcript: r.transcript ?? null, agent_vars: r.agentVars, updated_at: now,
  }).eq("id", call.id).in("status", ["dialing", "unknown"]).select("id");
  if (!won?.length) return "dup";

  const flows = await getFlowSettings();
  const eff = decideOutcomeEffects({
    purpose: call.purpose, status: r.status, durationS: r.durationS, outcome: r.outcome,
    linkSent: !!call.link_sent_at, toolAction: call.tool_action, attemptNo: call.attempt_no,
    maxAttempts: flows.cod_voice_max_attempts,
  });

  if (eff.setDnd && !(await addToDndList(`+${call.wa_id}`).catch(() => false))) {
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_dnd_push_failed", message: `${call.wa_id}: voice_dnd set locally but Sarvam DND push failed. Add it in indus.sarvam.ai.`, ref: call.id }).catch(() => {});
  }

  if (call.purpose === "cart" && call.run_id) {
    if (eff.reached) {
      await sb.from("wa_journey_runs").update({ delivered_at: now, last_error: "voice: reached on call" })
        .eq("id", call.run_id).is("delivered_at", null).then(() => {}, () => {});
    } else {
      await sb.from("wa_journey_runs").update({ status: "expired", last_error: `voice: ${r.status}` })
        .eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    }
    if (eff.cancelCartRuns) {
      // The customer heard us (and usually has the link). The WhatsApp nudges
      // would now be a second and third message about the same cart.
      await sb.from("wa_journey_runs").update({ status: "cancelled", last_error: "voice: customer reached on call" })
        .eq("wa_id", call.wa_id).eq("journey_key", "abandoned_checkout").eq("status", "active")
        .then(() => {}, () => {});
    }
  }
  if (call.purpose === "cod_confirm" && eff.codEscalate && call.shopify_id) {
    await escalateNeedsCall(call.shopify_id, `Order ${call.order_ref}: ${eff.codEscalate}`);
  }

  await logConnector({
    connector: "shopify_wa", level: "info", event: "voice_call_result",
    message: `${call.purpose} ${call.order_ref}: ${r.status}${r.durationS ? ` ${r.durationS}s` : ""}, outcome ${r.outcome}${eff.reached ? ", reached" : ""}.`,
    ref: call.order_ref ?? call.id,
  }).catch(() => {});
  return "finalised";
}
```

- [ ] **Step 4: Run** `deno test supabase/functions/_shared/voice-outcome_test.ts && deno check supabase/functions/_shared/voice-outcome.ts` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(voice): shared call-outcome handling for cart and COD"`

---

### Task 6: Dial helper + tool auth

**Files:**
- Create: `promunch-email-agent/supabase/functions/_shared/voice-dial.ts`
- Create: `promunch-email-agent/supabase/functions/_shared/voice-tool-auth.ts`
- Modify: `promunch-email-agent/supabase/functions/voice-tool-wa-link/index.ts:21-50`

**Interfaces:**
- Produces:
  - `voiceAllowlisted(waId: string): boolean` (true when `VOICE_TEST_WA_IDS` unset or contains waId)
  - `placeVoiceCall(row: { purpose; wa_id; order_ref; run_id?: string|null; shopify_id?: number|null; attempt_no?: number }): Promise<{ ok: true; callId: string } | { ok: false; stage: "insert" | "start"; error: string; callId?: string }>`
  - `checkVoiceToolAuth(req: Request, fnName: string): Promise<Response | null>` (null = authorised)

- [ ] **Step 1: `voice-tool-auth.ts`** — move `timingSafeEqual` and the 401 branch out of `voice-tool-wa-link/index.ts` verbatim (keep its comment block), parameterised by `fnName` in the log message:

```ts
import { logConnector } from "./connector-log.ts";

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Sarvam HTTPS tools authenticate with a DEDICATED secret, VOICE_TOOL_SECRET
// (never requireInternal: a third party must not hold our internal credential).
// Fails closed. Logs the rejection shape, never the credential.
export async function checkVoiceToolAuth(req: Request, fnName: string): Promise<Response | null> {
  const secret = Deno.env.get("VOICE_TOOL_SECRET") ?? "";
  const got = req.headers.get("Authorization") ?? "";
  if (secret && timingSafeEqual(got, `Bearer ${secret}`)) return null;
  const scheme = got ? got.split(" ")[0] : "none";
  await logConnector({
    connector: "shopify_wa", level: "warn", event: "voice_tool_unauthorized",
    message: `${fnName} rejected a call: ${!secret ? "VOICE_TOOL_SECRET is not set" : `bad bearer (auth scheme: ${scheme})`}.`,
    throttleMinutes: 5,
  }).catch(() => {});
  return new Response(JSON.stringify({ ok: false, message: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
}
```

In `voice-tool-wa-link/index.ts` delete the local `timingSafeEqual` and the inline auth block; start the handler with `const denied = await checkVoiceToolAuth(req, "voice-tool-wa-link"); if (denied) return denied;`. Also add a purpose guard after loading the call: select `purpose` and reject `purpose !== "cart"` with the same 400 "Could not send the link." response.

- [ ] **Step 2: `voice-dial.ts`**

```ts
// Ledger-first dial: insert the voice_calls row (status 'dialing'), then ask
// voice-call-start to place it. The CALLER must already hold the claim
// (journey run active->completed, or shopify_orders.voice_attempts CAS).
import { db } from "./supabase.ts";
import type { VoicePurpose } from "./sarvam.ts";

export function voiceAllowlisted(waId: string): boolean {
  const allow = (Deno.env.get("VOICE_TEST_WA_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.length === 0 || allow.includes(waId);
}

export async function placeVoiceCall(row: {
  purpose: VoicePurpose; wa_id: string; order_ref: string | null;
  run_id?: string | null; shopify_id?: number | null; attempt_no?: number;
}): Promise<{ ok: true; callId: string } | { ok: false; stage: "insert" | "start"; error: string; callId?: string }> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const { data: call, error } = await db().from("voice_calls").insert({
    purpose: row.purpose, wa_id: row.wa_id, order_ref: row.order_ref, run_id: row.run_id ?? null,
    shopify_id: row.shopify_id ?? null, attempt_no: row.attempt_no ?? 1, webhook_token: token, status: "dialing",
  }).select("id").single();
  if (error || !call) return { ok: false, stage: "insert", error: error?.message ?? "insert failed" };
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-call-start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ call_id: call.id }),
  }).catch(() => null);
  const res = r ? await r.json().catch(() => ({ ok: false })) as { ok?: boolean; error?: string } : { ok: false, error: "fetch failed" };
  if (res.ok) return { ok: true, callId: call.id };
  // voice-call-start marks the row start_failed itself when Sarvam refuses;
  // a fetch failure leaves it 'dialing' with no attempt_id, so close it here.
  await db().from("voice_calls").update({ status: "start_failed", failure_reason: res.error ?? "start failed", updated_at: new Date().toISOString() })
    .eq("id", call.id).eq("status", "dialing").is("attempt_id", null).then(() => {}, () => {});
  return { ok: false, stage: "start", error: res.error ?? "start failed", callId: call.id };
}
```

- [ ] **Step 3: Verify** `deno check supabase/functions/voice-tool-wa-link/index.ts supabase/functions/_shared/voice-dial.ts`
- [ ] **Step 4: Commit** `git commit -m "refactor(voice): shared dial helper and tool auth"`

---

### Task 7: `voice-call-start` purpose-aware

**Files:** Modify `promunch-email-agent/supabase/functions/voice-call-start/index.ts`

**Interfaces:** Consumes `startOutboundCall({purpose,...})` (Task 3). COD agent variable contract (must match the Sarvam COD agent built in Task 15): `customer_name, order_ref, order_items, order_value, call_id, gender`.

- [ ] **Step 1:** Select `purpose, shopify_id` in the call lookup. Keep the cart branch exactly as is (journey-run context → variables). Add before it:

```ts
  let agentVariables: Record<string, string>;
  if (call.purpose === "cod_confirm") {
    const { data: o } = await sb.from("shopify_orders")
      .select("order_number, customer_name, total_price, raw").eq("shopify_id", call.shopify_id).maybeSingle();
    if (!o) {
      await sb.from("voice_calls").update({ status: "start_failed", failure_reason: "order not found", updated_at: new Date().toISOString() }).eq("id", call.id);
      return j({ ok: false, error: "order not found" }, 404);
    }
    const lines = Array.isArray(o.raw?.line_items) ? o.raw.line_items as Array<{ title?: string; name?: string; quantity?: number }> : [];
    // COD agent contract (Sarvam Build -> Variables). Same rule as the cart
    // agent: sending an undeclared variable is a hard 422, so keep in sync.
    agentVariables = {
      customer_name: String(o.customer_name ?? "").split(/\s+/)[0] || "there",
      order_ref: String(o.order_number ?? "").replace(/^#/, ""),
      order_items: lines.slice(0, 8).map((l) => `${Number(l.quantity ?? 1)}x ${l.title ?? l.name ?? "item"}`).join(", ") || "your PROMUNCH snacks",
      order_value: `Rs ${Math.round(Number(o.total_price ?? 0))}`,
      call_id: call.id,
      gender: "",
    };
  } else {
    // ... existing cart variable block (journey run context) assigned to agentVariables
  }
```

Pass `purpose: call.purpose ?? "cart"` to `startOutboundCall`, add `purpose` to `metadata`, and change log messages from `` `Cart ${call.order_ref}` `` to `` `${call.purpose === "cod_confirm" ? "COD order" : "Cart"} ${call.order_ref}` ``.

- [ ] **Step 2: Verify** `deno check supabase/functions/voice-call-start/index.ts`
- [ ] **Step 3: Commit** `git commit -m "feat(voice): voice-call-start supports the COD confirmation agent"`

---

### Task 8: `voice-tool-cod` (new) + `voice-webhook` refactor

**Files:**
- Create: `promunch-email-agent/supabase/functions/voice-tool-cod/index.ts`
- Modify: `promunch-email-agent/supabase/functions/voice-webhook/index.ts` (body after verification)
- Modify: `promunch-email-agent/supabase/config.toml`

- [ ] **Step 1: `voice-tool-cod/index.ts`**

```ts
// HTTPS tool target for the Sarvam COD agent ("cod_confirm").
// Body: { call_id, action: "confirm" | "cancel_request" }.
// The agent NEVER cancels an order: cancel_request parks it for ops.
// One action per call (voice_calls.tool_action set once by CAS). Replies are
// spoken by the agent, so: short, plain, no em dashes.
import { db } from "../_shared/supabase.ts";
import { checkVoiceToolAuth } from "../_shared/voice-tool-auth.ts";
import { confirmGate, requestCancelFromVoice } from "../_shared/cod-gate.ts";

Deno.serve(async (req) => {
  const denied = await checkVoiceToolAuth(req, "voice-tool-cod");
  if (denied) return denied;
  if (req.method !== "POST") return j({ ok: false, message: "POST only" }, 405);
  const body = await req.json().catch(() => null) as { call_id?: string; action?: string } | null;
  const action = body?.action === "confirm" || body?.action === "cancel_request" ? body.action : null;
  if (!body?.call_id || !action) return j({ ok: false, message: "Sorry, I could not update the order." }, 400);
  const sb = db();
  const { data: call } = await sb.from("voice_calls")
    .select("id, status, purpose, shopify_id, tool_action").eq("id", body.call_id).maybeSingle();
  if (!call || call.status !== "dialing" || call.purpose !== "cod_confirm" || !call.shopify_id) {
    return j({ ok: false, message: "Sorry, I could not update the order." }, 400);
  }
  const { data: won } = await sb.from("voice_calls").update({ tool_action: action, updated_at: new Date().toISOString() })
    .eq("id", call.id).is("tool_action", null).select("id");
  if (!won?.length) return j({ ok: true, message: "That is already noted for this order." });

  if (action === "confirm") {
    const r = await confirmGate(call.shopify_id, "voice");
    return j({ ok: true, message: r.outcome === "confirmed"
      ? "Done, your order is confirmed and will be packed soon."
      : `Your order is already ${r.already}.` });
  }
  const r = await requestCancelFromVoice(call.shopify_id);
  return j({ ok: r.ok, message: r.outcome === "already"
    ? `Your order is already ${r.already}.`
    : "Noted. Our team will cancel it and confirm with you on WhatsApp shortly." });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 2: `voice-webhook/index.ts`** — keep everything up to and including `const call = row!;` and the status mapping (`STATUSES`, `status`, `unmappedStatus`, `failureReason`). Select `purpose` is not needed here. Replace the local `OUTCOMES` set and `outcome` computation with `clampOutcome(p.final_agent_variables?.call_disposition ?? p.final_agent_variables?.outcome)` imported from `../_shared/voice-outcome.ts`. Replace everything from the `// Idempotent finalise` comment down to the final `voice_call_result` log with:

```ts
  const res = await finaliseVoiceCall(call.id, {
    status, durationS: p.duration ?? null, outcome, interactionId: p.interaction_id ?? null,
    failureReason, transcript: p.interaction_transcript ?? null, agentVars: p.final_agent_variables ?? null,
  });
  if (res === "retry") return j({ error: "retry" }, 500);
  return j({ ok: true, dup: res === "dup" });
```

Remove now-unused imports (`addToDndList`). The old cart retry-after-no-answer logic is intentionally gone (call-first = one dial).

- [ ] **Step 3: `config.toml`** — add after `[functions.voice-tool-wa-link]`:

```toml
[functions.voice-tool-cod]
verify_jwt = false                    # Sarvam HTTPS tool; auth = VOICE_TOOL_SECRET bearer (voice-tool-auth.ts)

[functions.voice-tick]
verify_jwt = false                    # pg_cron; real auth is requireInternal
```

Also fix the stale comment on `[functions.voice-tool-wa-link]` to say `VOICE_TOOL_SECRET bearer (voice-tool-auth.ts)`.

- [ ] **Step 4: Verify** `deno check supabase/functions/voice-tool-cod/index.ts supabase/functions/voice-webhook/index.ts && deno test supabase/functions/_shared/voice-webhook-verify_test.ts`
- [ ] **Step 5: Commit** `git commit -m "feat(voice): COD confirm tool; webhook uses shared outcome handling"`

---

### Task 9: `voice-tick` (new)

**Files:** Create `promunch-email-agent/supabase/functions/voice-tick/index.ts`

**Interfaces:** Consumes Tasks 2-6. Returns JSON `{ ok, cart: {...}, cod: {...}, reconcile: {...} }`.

- [ ] **Step 1: Implement**

```ts
// Cron (pg_cron, every minute): the ONLY place voice calls are dialled.
//   1. cart:      wa_journey_runs voice rows due now (enrolled by shopify-wa at +15 min)
//   2. cod:       pending COD orders past reminder + cod_voice_delay_hours
//   3. reconcile: calls stuck on 'dialing' -> Sarvam analytics -> finaliseVoiceCall
// Design: docs/plans/2026-10-01-voice-agent-cart-cod-design.md
import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { getFlowSettings, type FlowSettings } from "../_shared/flow-settings.ts";
import { cartVoiceEligibility, codCallDueBefore, codVoiceEligibility, inCallWindow } from "../_shared/voice-eligibility.ts";
import { placeVoiceCall, voiceAllowlisted } from "../_shared/voice-dial.ts";
import { fetchTranscript, listAttempts, type VoicePurpose } from "../_shared/sarvam.ts";
import { clampOutcome, finaliseVoiceCall } from "../_shared/voice-outcome.ts";
import { escalateNeedsCall } from "../_shared/cod-gate.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";

const BATCH = 20;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const flows = await getFlowSettings();
  const nowMs = Date.now();
  const safe = async <T>(name: string, f: () => Promise<T>) => {
    try { return await f(); } catch (e) {
      await logConnector({ connector: "shopify_wa", level: "error", event: "voice_tick_error", message: `voice-tick ${name}: ${errStr(e)}`, throttleMinutes: 15 }).catch(() => {});
      return { error: errStr(e) };
    }
  };
  const cart = await safe("cart", () => cartPass(flows, nowMs));
  const cod = await safe("cod", () => codPass(flows, nowMs));
  const reconcile = await safe("reconcile", () => reconcilePass(nowMs));
  return j({ ok: true, cart, cod, reconcile });
});

async function cartPass(flows: FlowSettings, nowMs: number) {
  const sb = db();
  const nowIso = new Date(nowMs).toISOString();
  const { data: due } = await sb.from("wa_journey_runs")
    .select("id, wa_id, order_ref, created_at, context")
    .eq("status", "active").eq("journey_key", "abandoned_checkout").eq("context->>channel", "voice")
    .lte("next_action_at", nowIso).order("next_action_at").limit(BATCH);
  let called = 0, cancelled = 0, deferred = 0, failed = 0;
  for (const run of due ?? []) {
    const ctx = (run.context ?? {}) as Record<string, unknown>;
    const [{ data: contact }, { data: th }, { data: calls }] = await Promise.all([
      sb.from("wa_contacts").select("opted_in, voice_dnd").eq("wa_id", run.wa_id).maybeSingle(),
      sb.from("wa_threads").select("last_inbound_at, ticket_status").eq("wa_id", run.wa_id).maybeSingle(),
      sb.from("voice_calls").select("order_ref, created_at, status, attempt_id").eq("wa_id", run.wa_id).eq("purpose", "cart"),
    ]);
    const cartCalls = (calls ?? []).filter((c) => c.order_ref === run.order_ref);
    const verdict = cartVoiceEligibility({
      enabled: flows.voice_call_enabled && flows.abandoned_cart_enabled,
      inWindow: inCallWindow(nowMs, flows.voice_call_start_hour, flows.voice_call_end_hour),
      cartTotal: Number(ctx.total ?? 0),
      minCartValue: flows.voice_min_cart_value,
      voiceDnd: contact?.voice_dnd === true,
      optedIn: contact?.opted_in !== false,
      inboundSinceEnrol: !!th?.last_inbound_at && Date.parse(th.last_inbound_at) > Date.parse(run.created_at),
      openTicket: th?.ticket_status === "open" || th?.ticket_status === "pending",
      allowlisted: voiceAllowlisted(run.wa_id),
      // A REAL dial = Sarvam accepted it (has attempt_id). start_failed never rang.
      cartDialled: cartCalls.some((c) => !!c.attempt_id && c.status !== "start_failed"),
      cartInFlight: cartCalls.some((c) => c.status === "dialing"),
      connectedWithin7d: (calls ?? []).some((c) => c.status === "connected" && Date.parse(c.created_at) >= nowMs - 7 * 86400_000),
    });
    if (verdict.action === "cancel") {
      await sb.from("wa_journey_runs").update({ status: "cancelled", last_error: `voice: ${verdict.reason}` }).eq("id", run.id).eq("status", "active");
      cancelled++; continue;
    }
    if (verdict.action === "defer") {
      await sb.from("wa_journey_runs").update({ next_action_at: new Date(nowMs + verdict.minutes * 60_000).toISOString(), last_error: `voice: ${verdict.reason}` }).eq("id", run.id).eq("status", "active");
      deferred++; continue;
    }
    // ATOMIC CLAIM: active -> completed. Crash after this loses the call, never doubles it.
    const { data: claimed } = await sb.from("wa_journey_runs").update({ status: "completed", last_error: null })
      .eq("id", run.id).eq("status", "active").select("id");
    if (!claimed?.length) continue;
    const res = await placeVoiceCall({ purpose: "cart", wa_id: run.wa_id, order_ref: run.order_ref, run_id: run.id });
    if (res.ok) { called++; continue; }
    // No retry for a 15-minute call: by the next attempt it is no longer "15
    // minutes after". The WhatsApp + email sequence carries the cart.
    await sb.from("wa_journey_runs").update({ status: "failed", last_error: `voice: ${res.stage} failed: ${res.error}` }).eq("id", run.id);
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_start_failed", message: `Cart ${run.order_ref}: ${res.error}`, ref: run.order_ref ?? run.id, throttleMinutes: 30 }).catch(() => {});
    failed++;
  }
  return { due: due?.length ?? 0, called, cancelled, deferred, failed };
}

async function codPass(flows: FlowSettings, nowMs: number) {
  if (!flows.cod_gate_enabled || !flows.cod_voice_enabled) return { skipped: "flag off" };
  const inWindow = inCallWindow(nowMs, flows.voice_call_start_hour, flows.voice_call_end_hour);
  if (!inWindow) return { skipped: "outside call window" };
  const sb = db();
  const { data: due } = await sb.from("shopify_orders")
    .select("shopify_id, order_number, customer_phone, confirmation_status, voice_attempts")
    .eq("confirmation_status", "pending")
    .lt("confirmation_sent_at", codCallDueBefore(nowMs, flows.cod_reminder_delay_hours, flows.cod_voice_delay_hours))
    .lt("voice_attempts", flows.cod_voice_max_attempts)
    .order("confirmation_sent_at").limit(BATCH);
  let called = 0, skipped = 0, failed = 0;
  for (const o of due ?? []) {
    const waId = String(o.customer_phone ?? "").replace(/\D/g, "");
    if (!waId) { skipped++; continue; }
    const [{ data: contact }, { data: last }] = await Promise.all([
      sb.from("wa_contacts").select("voice_dnd").eq("wa_id", waId).maybeSingle(),
      sb.from("voice_calls").select("status, created_at").eq("purpose", "cod_confirm").eq("shopify_id", o.shopify_id)
        .neq("status", "start_failed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const attempts = Number(o.voice_attempts ?? 0);
    const verdict = codVoiceEligibility({
      enabled: true, inWindow, status: o.confirmation_status, voiceDnd: contact?.voice_dnd === true,
      allowlisted: voiceAllowlisted(waId), attempts, maxAttempts: flows.cod_voice_max_attempts,
      lastCallStatus: last?.status ?? null, lastCallAtMs: last ? Date.parse(last.created_at) : null,
      nowMs, retryHours: flows.cod_voice_retry_hours,
    });
    if (verdict.action === "skip") { skipped++; continue; }
    // ATOMIC CLAIM on the order row: only one tick can move n -> n+1, and only while pending.
    const { data: won } = await sb.from("shopify_orders").update({ voice_attempts: attempts + 1 })
      .eq("shopify_id", o.shopify_id).eq("voice_attempts", attempts).eq("confirmation_status", "pending").select("shopify_id");
    if (!won?.length) continue;
    const res = await placeVoiceCall({
      purpose: "cod_confirm", wa_id: waId, order_ref: String(o.order_number).replace(/^#/, ""),
      shopify_id: o.shopify_id, attempt_no: attempts + 1,
    });
    if (res.ok) { called++; continue; }
    failed++;
    // The phone never rang: hand the attempt back (CAS), bounded by 3 start failures.
    await sb.from("shopify_orders").update({ voice_attempts: attempts })
      .eq("shopify_id", o.shopify_id).eq("voice_attempts", attempts + 1);
    const { count } = await sb.from("voice_calls").select("id", { count: "exact", head: true })
      .eq("purpose", "cod_confirm").eq("shopify_id", o.shopify_id).eq("status", "start_failed");
    if ((count ?? 0) >= 3) {
      await escalateNeedsCall(o.shopify_id, `Order ${o.order_number}: COD voice call could not be started 3 times (${res.error}). Call to confirm.`);
    }
  }
  return { due: due?.length ?? 0, called, skipped, failed };
}

async function reconcilePass(nowMs: number) {
  const sb = db();
  // Rows that never reached Sarvam (no attempt_id) after 30 min: nothing to reconcile.
  await sb.from("voice_calls").update({ status: "start_failed", failure_reason: "never reached Sarvam", updated_at: new Date(nowMs).toISOString() })
    .eq("status", "dialing").is("attempt_id", null).lt("created_at", new Date(nowMs - 30 * 60_000).toISOString());
  const { data: stuck } = await sb.from("voice_calls").select("id, purpose, attempt_id, created_at")
    .eq("status", "dialing").not("attempt_id", "is", null)
    .lt("created_at", new Date(nowMs - 3 * 60_000).toISOString())
    .gt("created_at", new Date(nowMs - 48 * 3600_000).toISOString())
    .order("created_at").limit(50);
  if (!stuck?.length) return { stuck: 0 };
  let finalised = 0;
  for (const purpose of ["cart", "cod_confirm"] as VoicePurpose[]) {
    const rows = stuck.filter((r) => r.purpose === purpose);
    if (!rows.length) continue;
    const since = new Date(Math.min(...rows.map((r) => Date.parse(r.created_at))) - 5 * 60_000).toISOString();
    const attempts = await listAttempts(purpose, since, new Date(nowMs).toISOString(), 200);
    const byId = new Map(attempts.map((a) => [a.attemptId, a]));
    for (const row of rows) {
      const a = byId.get(String(row.attempt_id));
      if (!a || a.status === "unknown") continue; // still ringing / not in analytics yet
      const transcript = a.interactionId ? await fetchTranscript(purpose, a.interactionId) : [];
      const r = await finaliseVoiceCall(row.id, {
        status: a.status, durationS: a.durationSeconds != null ? Math.round(a.durationSeconds) : null,
        outcome: clampOutcome(a.agentVariables?.call_disposition), interactionId: a.interactionId,
        failureReason: a.failureReason, transcript: transcript.length ? transcript : null, agentVars: a.agentVariables,
      });
      if (r === "finalised") finalised++;
    }
  }
  // Still unresolved after 2h: unknown (counts as not reached; a late webhook can still land).
  await sb.from("voice_calls").update({ status: "unknown", updated_at: new Date(nowMs).toISOString() })
    .eq("status", "dialing").lt("created_at", new Date(nowMs - 2 * 3600_000).toISOString());
  return { stuck: stuck.length, finalised };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
```

Note: a COD call flipped to `unknown` after 2h never escalates by itself; it stays `pending` and is picked up by the retry (if attempts remain; `unknown` is not `dialing`) or the 24h sweep. That is the intended fallback.

- [ ] **Step 2: Verify** `deno check supabase/functions/voice-tick/index.ts`. If PostgREST JSON-path filter `.eq("context->>channel", "voice")` fails type-check, keep it (supabase-js accepts the string column) — it is valid PostgREST syntax.
- [ ] **Step 3: Commit** `git commit -m "feat(voice): voice-tick dials cart and COD calls and reconciles results"`

---

### Task 10: Hand the voice row over from the WhatsApp side

**Files:**
- Modify: `promunch-email-agent/supabase/functions/wa-journey-tick/index.ts`
- Modify: `promunch-email-agent/supabase/functions/_shared/window-asks.ts:118-133`
- Modify: `promunch-email-agent/supabase/functions/shopify-wa/index.ts` (voice refresh ~L459-470, voice enrol ~L535-560, live-run select ~L425)

- [ ] **Step 2: wa-journey-tick**
  - Delete the import of `inCallWindow, nextWindowOpen, voiceEligibility`.
  - Delete the 6h stuck-dial sweep block (`await sb.from("voice_calls").update({ status: "unknown" ...` and its comment) — voice-tick owns it now.
  - Replace the `// ---- VOICE RESCUE CALL ----` block with nothing, and add at the very TOP of the `for (const run of due ?? [])` loop:

```ts
    // Voice rows belong to voice-tick (every minute). Never touch them here:
    // not even to expire or pause them, or the two ticks would race.
    if (run.context?.channel === "voice") { skipped++; continue; }
```
  - Delete the whole `handleVoiceRun` function.
  - After `const isCart = run.journey_key === "abandoned_checkout";` add:

```ts
    // A cart call may be ringing right now. Never land a WhatsApp nudge on top
    // of it; voice-tick's outcome decides whether the nudges still go.
    if (isCart) {
      const { data: live } = await sb.from("voice_calls").select("id").eq("wa_id", run.wa_id)
        .eq("purpose", "cart").eq("status", "dialing")
        .gt("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
      if (live?.length) {
        await sb.from("wa_journey_runs").update({
          next_action_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          last_error: "deferred: cart voice call in progress",
        }).eq("id", run.id).eq("status", "active");
        skipped++;
        continue;
      }
    }
```

- [ ] **Step 3: window-asks.ts** — in the `eligible = data.filter((r) => { ... })` callback, as the FIRST line:

```ts
    // The voice row is an abandoned_checkout run with a link, so without this
    // an inbound message would deliver it as a WhatsApp nudge and silently
    // consume the call. voice-tick owns it.
    if (runChannel(r.context) === "voice") return false;
```
and add next to `runVars` (same context parsing as `runVars`, which handles string-or-object jsonb):

```ts
function runChannel(ctx: unknown): string {
  const c = typeof ctx === "string" ? (() => { try { return JSON.parse(ctx); } catch { return {}; } })() : (ctx ?? {});
  return String((c as Record<string, unknown>).channel ?? "");
}
```
(If `runVars` already has a parse helper, reuse it instead of the inline parse.)

- [ ] **Step 4: shopify-wa**
  - Add `next_action_at` to the live-runs select: `.select("id, order_ref, context, next_action_at")`.
  - In the voice refresh branch (`if (ctx.template === VOICE_TEMPLATE) {`), replace the update with:

```ts
          // Abandoned = N minutes of checkout SILENCE. New checkout activity
          // pushes the call later (never earlier: that could only add a call).
          const later = new Date(Math.max(
            Date.parse(String(run.next_action_at)),
            Date.now() + flows.cart_voice_delay_minutes * 60_000,
          )).toISOString();
          const { error: vErr } = await sb.from("wa_journey_runs")
            .update({ context: ctx, order_ref: token, next_action_at: later })
            .eq("id", run.id).eq("status", "active");
```
  and update the comment above it: schedule IS touched for the voice row, only ever forward.
  - In the enrol block, change `next_action_at` to `new Date(Date.now() + flows.cart_voice_delay_minutes * 60_000).toISOString()` and rewrite the comment: "Voice call ~cart_voice_delay_minutes after the cart goes quiet (call-first, 2026-10-01). voice-tick dials it; if the call reaches the customer it cancels the WA steps below, otherwise they run as normal. Ships OFF."

- [ ] **Step 5: Verify**

```bash
cd promunch-email-agent
deno check supabase/functions/wa-journey-tick/index.ts supabase/functions/shopify-wa/index.ts supabase/functions/wa-ai-reply/index.ts supabase/functions/voice-tick/index.ts
deno test supabase/functions/_shared/
grep -n "voice" supabase/functions/wa-journey-tick/index.ts   # only the skip line + the dialing defer remain
```

- [ ] **Step 6: Commit** `git commit -m "feat(voice): cart call 15 min after checkout goes quiet; WA side hands voice rows to voice-tick"`

---

### Task 11: Dashboard settings (Flows tab)

**Files:**
- Modify: `src/app/api/whatsapp/flows/route.ts` (DEFAULTS ~L39, boolean keys ~L52, ranges ~L69)
- Modify: `src/app/api/whatsapp/flows/permissions.ts` (~L23)
- Modify: `src/components/whatsapp/flows/types.ts` (~L27)
- Modify: `src/components/whatsapp/flows/copy.ts`, `src/components/whatsapp/flows/OrderSection.tsx` (~L160-215 cart voice block; COD gate block)
- Test: `src/app/api/whatsapp/flows/permissions.test.ts`

- [ ] **Step 1: Failing test** — in `permissions.test.ts`, add a case asserting the 5 new keys are order-area keys (copy the shape of the existing `voice_call_enabled` assertion), e.g.:

```ts
it("treats the new voice settings as order-area settings", () => {
  for (const k of ["cart_voice_delay_minutes", "cod_voice_enabled", "cod_voice_delay_hours", "cod_voice_max_attempts", "cod_voice_retry_hours"]) {
    expect(ORDER_KEYS).toContain(k); // use the exported list name the file actually uses
  }
});
```
Run `npx vitest run src/app/api/whatsapp/flows/permissions.test.ts` → FAIL.

- [ ] **Step 2: Implement.**
  - `route.ts` DEFAULTS: add the 5 keys with the same defaults as `FLOW_DEFAULTS`. Add `"cod_voice_enabled"` to the boolean-keys list. Add ranges: `cart_voice_delay_minutes: { min: 5, max: 180 }`, `cod_voice_delay_hours: { min: 0.5, max: 24 }`, `cod_voice_max_attempts: { min: 1, max: 3 }`, `cod_voice_retry_hours: { min: 1, max: 12 }`.
  - `permissions.ts`: add the 5 keys next to the existing voice keys.
  - `types.ts`: add the 5 fields to the settings type.
  - `OrderSection.tsx` cart voice block: line → `"About 15 minutes after a customer leaves their cart, a friendly AI voice gives them one call"` (use the live value: `` `About ${d.cart_voice_delay_minutes} minutes after ...` ``); timeline wait step → `{ kind: "wait", title: \`${d.cart_voice_delay_minutes} min\`, detail: "after the cart goes quiet" }`; replace the `cart_voice_delay_hours` `DurationInput` with a number input (min 5, max 180, step 5, aria-label "Minutes before the call") bound to `cart_voice_delay_minutes`; add a static note: "If the call connects, the WhatsApp cart reminders are skipped. If not, they go as usual."
  - COD gate block: add a sub-block with a toggle bound to `cod_voice_enabled` (via `c.requestToggle`, same pattern as `voice_call_enabled`), line "If a COD customer ignores the Confirm buttons and the reminder, the AI voice calls to confirm. Cancel requests go to the team, never auto-cancelled.", and number inputs for `cod_voice_delay_hours` ("Hours after reminder"), `cod_voice_max_attempts` ("Max calls", 1-3), `cod_voice_retry_hours` ("Hours between calls"). Read-only mode shows the values like the existing fields.
  - `copy.ts`: add a `cod_voice_enabled` confirm-dialog entry mirroring `voice_call_enabled` (copy: "Turn on COD confirmation calls?" / "Customers who have not confirmed a COD order will get an AI phone call."), no em dashes.

- [ ] **Step 3: Verify** `npx vitest run src/app/api/whatsapp/flows && npx tsc --noEmit -p . 2>&1 | grep -v promunch-email-agent | head` → tests pass, no new TS errors in `src/`.
- [ ] **Step 4: Commit** `git commit -m "feat(voice): Flows tab settings for 15-min cart call and COD calls"`

---

### Task 12: Calls in the CRM (inbox thread, Voice tab, sync)

**Files:**
- Modify: `src/lib/sarvam-voice.ts` (outcome enum)
- Modify: `src/app/api/whatsapp/voice-calls/route.ts` (select `purpose`, optional `?purpose=` filter)
- Modify: `src/app/api/whatsapp/voice-calls/sync/route.ts` (sync COD agent too)
- Modify: `src/components/whatsapp/VoiceView.tsx` (purpose filter + COD outcome labels)
- Modify: `src/app/api/whatsapp/threads/[id]/route.ts` (return `calls`)
- Modify: the inbox conversation message list component (find with `grep -rln "messages.map" src/components/whatsapp src/app/dashboard | head`)

- [ ] **Step 1:** `src/lib/sarvam-voice.ts`: extend `VoiceOutcome` and `OUTCOMES` with `"confirmed" | "cancel_requested" | "unclear"`. Add an optional `appId` parameter to `listAttempts`, `fetchTranscript`, `fetchRecording` (default `cfg.appId`) so callers can query the COD agent (`process.env.SARVAM_COD_APP_ID`). Run `npx vitest run src/lib` (existing tests must pass; add one `clampOutcome("confirmed") === "confirmed"` assertion to the existing sarvam-voice test file if one exists).

- [ ] **Step 2:** sync route: loop over `[process.env.SARVAM_APP_ID, process.env.SARVAM_COD_APP_ID].filter(Boolean)` and concatenate attempts before matching (rest unchanged). Note: this route only writes the call row + dnd; the COD/cart side-effects come from voice-tick's reconcile, which is the primary path. Add that sentence to the file's header comment.

- [ ] **Step 3:** voice-calls route: include `purpose` in the select; if `searchParams.get("purpose")` is `cart` or `cod_confirm`, add `.eq("purpose", ...)`.

- [ ] **Step 4:** VoiceView: add a `purpose` field to `VoiceCall`, three chips "All / Cart / COD" (reuse `chip` style) filtering client-side, show "COD order #<order_ref>" vs "Cart" in each row, and outcome labels: `confirmed` "Confirmed order", `cancel_requested` "Asked to cancel", `unclear` "Unclear". Update the header comment (no longer "rescue call after WhatsApp fails").

- [ ] **Step 5:** threads/[id] GET: after messages, add

```ts
  // Voice calls with this customer, shown inline in the conversation.
  const { data: calls } = await supabaseAdmin
    .from("voice_calls")
    .select("id, purpose, order_ref, status, outcome, duration_s, link_sent_at, tool_action, created_at")
    .eq("wa_id", thread.wa_id)
    .order("created_at", { ascending: true })
    .limit(50);
```
and return `{ thread, messages: messages ?? [], calls: calls ?? [] }`.

- [ ] **Step 6:** In the inbox conversation component, merge `calls` into the rendered timeline by `created_at` and render each as a centred system row (same style as existing system/date separators): `📞 ${purpose === "cod_confirm" ? `COD call #${order_ref}` : "Cart call"} · ${statusLabel}${duration_s ? ` · ${Math.floor(duration_s/60)}m ${duration_s%60}s` : ""}${link_sent_at ? " · link sent" : ""}${tool_action === "confirm" ? " · order confirmed" : tool_action === "cancel_request" ? " · asked to cancel" : ""}`, where statusLabel maps connected "Answered", no_answer "No answer", busy "Busy", failed/start_failed "Failed", dialing "Calling…", unknown "Unknown". Type `calls` as optional so older cached responses still render.

- [ ] **Step 7: Verify** `npm run test && npm run lint -- src/components/whatsapp src/app/api/whatsapp src/lib/sarvam-voice.ts && npm run build`
- [ ] **Step 8: Commit** `git commit -m "feat(voice): calls shown in the inbox thread; Voice tab covers COD calls"`

---

### Task 13: Docs, cron topology, counts

**Files:**
- Modify: `promunch-email-agent/supabase/migrations/20260705100000_cron_jobs_canonical.sql` (add voice-tick line in alphabetical position: `PERFORM cron.schedule('voice-tick', '* * * * *', _cron_post(fns || 'voice-tick', 'service_role_key'));`)
- Modify: `docs/runbooks/CRON_TOPOLOGY.md` (add voice-tick row: every minute, dials cart + COD calls, reconciles Sarvam results)
- Modify: `docs/whatsapp/VOICE_AGENT_SETUP.md` (new "v2: call-first + COD" section: two agents, COD variables + `cod_confirm` tool spec, new secrets `SARVAM_COD_APP_ID`/`SARVAM_COD_APP_VERSION`, flags, live-test steps)
- Modify: `CLAUDE.md`, `AGENTS.md`, `docs/architecture/ARCHITECTURE.md` edge-fn counts (+2: voice-tick, voice-tool-cod; recount with `ls -d promunch-email-agent/supabase/functions/*/ | grep -v _shared | wc -l`), add `voice-tick` to the cron-worker list and `voice-tool-cod` to send chokepoints.
- Modify: `docs/README.md` (add plan row for `2026-10-01-voice-agent-cart-cod.md`).

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2: Commit** `git commit -m "docs(voice): cron topology, setup guide and counts for voice v2"`

---

### Task 14: Full verification gate

- [ ] **Step 1:**

```bash
cd promunch-email-agent
for f in voice-tick voice-tool-cod voice-call-start voice-webhook voice-tool-wa-link wa-journey-tick wa-jobs-tick wa-ai-reply shopify-wa; do deno check supabase/functions/$f/index.ts || echo "FAIL $f"; done
deno test supabase/functions/_shared/
cd .. && npm run build && npm run test && npm run lint
bash scripts/check-migrations.sh
```
Expected: no FAIL lines, all tests green, build passes, lint shows no new errors in touched files.

- [ ] **Step 2:** `git push origin HEAD:main` (rebase on `origin/main` first if it moved: `git fetch && git rebase origin/main`, re-run Step 1 if anything was rebased).

---

## Deploy phase (ONLY after explicit owner "yes, deploy")

### Task 15: Sarvam agents (via Sarvam MCP tools)

- [ ] Read `sarvam://playbooks/agents`. Update agent `Conversatio-f80ceadc-9535` ("Cart Recovery Assistant - PROMUNCH"): opening becomes a call minutes after the cart was left ("Hi {customer_name}, this is PROMUNCH. You were just checking out {cart_items}, did something go wrong?"); keep variables/tool/dispositions; no em dashes; commit a new version.
- [ ] Create the COD agent "COD Confirmation - PROMUNCH" (clone settings: voice, language, connection). Inputs: `customer_name, order_ref, order_items, order_value, call_id, gender`. Outputs: `call_disposition` ∈ {confirmed, cancel_requested, callback_later, unclear, do_not_call}, `call_summary`. HTTPS tool `cod_confirm`: POST `https://hlykspakpewuilttnydm.supabase.co/functions/v1/voice-tool-cod`, header `Authorization: Bearer <VOICE_TOOL_SECRET>`, body `{call_id, action}`. Prompt: confirm the COD order ({order_items}, {order_value}); on yes call the tool with `confirm`; on cancel call it with `cancel_request` and say the team will confirm on WhatsApp; never promise refunds or discounts; product facts only from the Master KB upload. Commit.
- [ ] Set secrets: `supabase secrets set SARVAM_COD_APP_ID=... SARVAM_COD_APP_VERSION=... SARVAM_APP_VERSION=<new cart version> --project-ref hlykspakpewuilttnydm`.

### Task 16: Ship + live test

- [ ] Apply `20261001120000_voice_cart_cod.sql` (`supabase db query --linked -f ...` or SQL editor); verify columns.
- [ ] Deploy in order: `voice-tick voice-tool-cod voice-call-start voice-webhook voice-tool-wa-link wa-jobs-tick` → `wa-journey-tick wa-ai-reply` → `shopify-wa`.
- [ ] Apply `20261001120100_voice_tick_cron.sql`; confirm `cron.job_run_details` shows voice-tick 200s.
- [ ] Vercel: deploy from a detached worktree of the pushed commit with `.vercel` copied in (shared checkout drifts), check `vercel ls promunch-crm`.
- [ ] Set `VOICE_TEST_WA_IDS` = owner's number. Flip `voice_call_enabled` → abandon a real cart on promunch.in with the owner phone → call at ~15 min → ask for link → link arrives once → WA nudges show cancelled. Repeat, do not answer → WA reminder at +1h arrives.
- [ ] Flip `cod_voice_enabled` with `cod_voice_delay_hours` temporarily 0.5 and `cod_reminder_delay_hours` low → place a real COD order → call → say yes → Shopify hold released, `confirmed_via='voice'`. Second order → say cancel → order in needs_call, ops ping, urgent ticket. Restore delays.
- [ ] Unset `VOICE_TEST_WA_IDS` only with owner go-ahead. Update memory + `docs/whatsapp/VOICE_AGENT_SETUP.md` state.
