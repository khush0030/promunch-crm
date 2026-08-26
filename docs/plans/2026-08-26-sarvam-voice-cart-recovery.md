# Sarvam Voice Cart Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After WhatsApp cart recovery fails, place one Sarvam AI voice call that reminds the customer of their cart and, on request, sends the checkout link on WhatsApp mid-call.

**Architecture:** A third `wa_journey_runs` row (`context.channel="voice"`, `context.template="voice_cart_call"`) rides the existing `abandoned_checkout` journey. `wa-journey-tick` branches on it, applies a pure eligibility helper, claims atomically, writes a `voice_calls` ledger row, and calls Sarvam Instant Outbound via `voice-call-start`. Sarvam posts the result to `voice-webhook`; the agent's HTTPS tool hits `voice-tool-wa-link`, which sends a UTILITY template through `wa-send`.

**Tech Stack:** Deno edge functions (Supabase), Postgres migration (hand-applied), Next.js 16 App Router routes + React client, Sarvam Voice Agents REST (`X-API-Key`), Meta WhatsApp Cloud API via existing `wa-send`.

Spec: [2026-08-26-sarvam-voice-cart-recovery-design.md](2026-08-26-sarvam-voice-cart-recovery-design.md).

## Global Constraints

- Never message or call a customer twice: atomic claim before every send/dial (`claimSend`, `active→completed` UPDATE).
- Ships OFF: `wa_flow_settings.voice_call_enabled` default `false`.
- Copy: brand is `PROMUNCH` (caps), tagline `Your Munchy Pal`, no em dashes in customer-facing text, never mention Oltaflock.
- Migrations are pasted into the Supabase SQL editor by hand; report "committed" and "deployed" separately.
- Edge secrets via `Deno.env` / `getAppSecret`; Next.js never calls Sarvam directly.
- Commit straight to `main`; nothing auto-deploys.
- Numbers: `wa_id` is digits with `91` prefix; Sarvam wants `+` + `wa_id`.
- Verification before done: `npm run build`, `npm run test`, `npm run lint`, `deno check` each touched function, `deno test` for `_shared` tests.

---

### Task 1: Settings plumbing (migration, shared defaults, API route, UI type)

**Files:**
- Create: `promunch-email-agent/supabase/migrations/20260826200000_voice_cart_recovery.sql`
- Modify: `promunch-email-agent/supabase/functions/_shared/flow-settings.ts` (interface + FLOW_DEFAULTS)
- Modify: `src/app/api/whatsapp/flows/route.ts` (DEFAULTS, BOOL_KEYS, NUM_LIMITS, PATCH validation)
- Modify: `src/components/whatsapp/FlowsView.tsx:23-40` (FlowSettings type)
- Test: `src/app/api/whatsapp/flows/validate.test.ts` (new)

**Interfaces:**
- Produces: `FlowSettings` gains `voice_call_enabled: boolean; cart_voice_delay_hours: number; voice_min_cart_value: number; voice_call_start_hour: number; voice_call_end_hour: number; voice_language: string`. Table `voice_calls`, column `wa_contacts.voice_dnd`.

- [ ] **Step 1: Write the migration**

```sql
-- Sarvam voice-agent rescue call for abandoned carts (design: docs/plans/2026-08-26-sarvam-voice-cart-recovery-design.md).
-- Apply by hand in the Supabase SQL editor.

create table if not exists voice_calls (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid references wa_journey_runs(id) on delete set null,
  wa_id          text not null,
  order_ref      text,
  attempt_id     text,
  interaction_id text,
  webhook_token  text not null,
  status         text not null default 'dialing'
                 check (status in ('dialing','connected','no_answer','busy','failed','start_failed','unknown')),
  outcome        text,
  duration_s     int,
  failure_reason text,
  transcript     jsonb,
  agent_vars     jsonb,
  link_sent_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists voice_calls_wa_created_idx on voice_calls (wa_id, created_at desc);
create index if not exists voice_calls_order_ref_idx on voice_calls (order_ref);
create index if not exists voice_calls_dialing_idx on voice_calls (created_at) where status = 'dialing';
alter table voice_calls enable row level security;
grant select, insert, update on voice_calls to service_role;

alter table wa_contacts add column if not exists voice_dnd boolean not null default false;

alter table wa_flow_settings
  add column if not exists voice_call_enabled     boolean not null default false,
  add column if not exists cart_voice_delay_hours numeric not null default 6,
  add column if not exists voice_min_cart_value   numeric not null default 0,
  add column if not exists voice_call_start_hour  int     not null default 10,
  add column if not exists voice_call_end_hour    int     not null default 20,
  add column if not exists voice_language         text    not null default 'Hindi';

-- Retention: transcripts are the bulky part; keep the row, drop the text after 180d.
create or replace function public.purge_voice_transcripts() returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare n bigint := 0;
begin
  update voice_calls set transcript = null
   where transcript is not null and created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('voice-transcript-purge', '20 3 * * *', $$select public.purge_voice_transcripts()$$);
```

- [ ] **Step 2: Extend `FlowSettings` + `FLOW_DEFAULTS` in `_shared/flow-settings.ts`**

Add after `tagline_checkout_footer: boolean;`:

```ts
  // Sarvam voice rescue call (fires only after WhatsApp cart recovery fails).
  voice_call_enabled: boolean;
  cart_voice_delay_hours: number;   // hours after cart step 2 before the call is due
  voice_min_cart_value: number;     // INR; 0 = call every cart
  voice_call_start_hour: number;    // IST, inclusive
  voice_call_end_hour: number;      // IST, exclusive
  voice_language: string;           // Sarvam initial_language_name enum
```

Add to `FLOW_DEFAULTS` after `tagline_checkout_footer: true,`:

```ts
  voice_call_enabled: false,
  cart_voice_delay_hours: 6,
  voice_min_cart_value: 0,
  voice_call_start_hour: 10,
  voice_call_end_hour: 20,
  voice_language: "Hindi",
```

- [ ] **Step 3: Write the failing validation test**

`src/app/api/whatsapp/flows/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateVoiceHours, VOICE_LANGUAGES } from "./validate";

describe("voice flow validation", () => {
  it("rejects start >= end", () => {
    expect(validateVoiceHours(20, 10)).toMatch(/start hour/);
    expect(validateVoiceHours(10, 10)).toMatch(/start hour/);
  });
  it("accepts a sane window", () => {
    expect(validateVoiceHours(10, 20)).toBeNull();
  });
  it("lists Hindi and English as Sarvam languages", () => {
    expect(VOICE_LANGUAGES).toContain("Hindi");
    expect(VOICE_LANGUAGES).toContain("English");
  });
});
```

- [ ] **Step 4: Run it, expect failure**

Run: `npx vitest run src/app/api/whatsapp/flows/validate.test.ts`
Expected: FAIL, `Cannot find module './validate'`.

- [ ] **Step 5: Create `src/app/api/whatsapp/flows/validate.ts`**

```ts
// Sarvam Voice Agents initial_language_name enum (docs.sarvam.ai instant-outbound).
export const VOICE_LANGUAGES = [
  "Hindi", "English", "Bengali", "Gujarati", "Kannada", "Malayalam", "Tamil",
  "Telugu", "Punjabi", "Marathi", "Odia", "Assamese",
] as const;

/** Returns an error string or null. Hours are IST, start inclusive, end exclusive. */
export function validateVoiceHours(start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "call hours must be whole hours";
  if (start < 0 || start > 23 || end < 1 || end > 24) return "call hours must be within 0-24";
  if (start >= end) return "call start hour must be before the end hour";
  return null;
}
```

- [ ] **Step 6: Wire the route**

In `src/app/api/whatsapp/flows/route.ts`:

Add import: `import { validateVoiceHours, VOICE_LANGUAGES } from "./validate";`

Add to `DEFAULTS` (after `tagline_checkout_footer: true,`):
```ts
  voice_call_enabled: false,
  cart_voice_delay_hours: 6,
  voice_min_cart_value: 0,
  voice_call_start_hour: 10,
  voice_call_end_hour: 20,
  voice_language: "Hindi",
```
Add `"voice_call_enabled"` to `BOOL_KEYS`.
Add to `NUM_LIMITS`:
```ts
  cart_voice_delay_hours: { min: 1, max: 72 },
  voice_min_cart_value: { min: 0, max: 100000 },
  voice_call_start_hour: { min: 0, max: 23 },
  voice_call_end_hour: { min: 1, max: 24 },
```
In `PATCH`, after the `cart_coupon_code` block:
```ts
  if (body.voice_language !== undefined) {
    const lang = String(body.voice_language);
    if (!(VOICE_LANGUAGES as readonly string[]).includes(lang)) {
      return NextResponse.json({ error: "voice_language must be a Sarvam language" }, { status: 400 });
    }
    patch.voice_language = lang;
  }
```
In the cross-field section, after the `cod_needs_call_hours` check:
```ts
  const hoursErr = validateVoiceHours(merged.voice_call_start_hour, merged.voice_call_end_hour);
  if (hoursErr) return NextResponse.json({ error: hoursErr }, { status: 400 });
```

- [ ] **Step 7: Extend the `FlowSettings` type in `FlowsView.tsx`** (after `tagline_checkout_footer: boolean;`):

```ts
  voice_call_enabled: boolean;
  cart_voice_delay_hours: number;
  voice_min_cart_value: number;
  voice_call_start_hour: number;
  voice_call_end_hour: number;
  voice_language: string;
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/app/api/whatsapp/flows/validate.test.ts && cd promunch-email-agent && deno check supabase/functions/_shared/flow-settings.ts && cd ..`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add promunch-email-agent/supabase/migrations/20260826200000_voice_cart_recovery.sql promunch-email-agent/supabase/functions/_shared/flow-settings.ts src/app/api/whatsapp/flows src/components/whatsapp/FlowsView.tsx
git commit -m "feat(voice): voice_calls ledger, voice_dnd, and voice flow settings plumbing"
```

---

### Task 2: Pure eligibility helper `_shared/voice-eligibility.ts`

**Files:**
- Create: `promunch-email-agent/supabase/functions/_shared/voice-eligibility.ts`
- Test: `promunch-email-agent/supabase/functions/_shared/voice-eligibility_test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const VOICE_TEMPLATE = "voice_cart_call";
  export function istHour(nowMs: number): number;                       // 0-23 in Asia/Kolkata
  export function inCallWindow(nowMs: number, startHour: number, endHour: number): boolean;
  export function nextWindowOpen(nowMs: number, startHour: number): Date; // next IST startHour strictly after now
  export interface VoiceEligibilityInput {
    enabled: boolean; cartTotal: number; minCartValue: number;
    voiceDnd: boolean; optedIn: boolean;
    inboundSinceEnrol: boolean;               // customer messaged us after WA step 1 was created
    waDelivered: boolean;                     // any WA cart row has delivered_at
    waStoodDown: boolean;                     // any WA cart row has tpl_stood_down / cap attempts >= 2
    waPending: boolean;                       // any WA cart row still active and not stood down
    recentCallWithin7d: boolean; callForThisCart: boolean;
  }
  export type VoiceVerdict =
    | { action: "call" }
    | { action: "cancel"; reason: string }
    | { action: "defer"; hours: number; reason: string };
  export function voiceEligibility(i: VoiceEligibilityInput): VoiceVerdict;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// Run: deno test supabase/functions/_shared/voice-eligibility_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inCallWindow, istHour, nextWindowOpen, voiceEligibility, VoiceEligibilityInput } from "./voice-eligibility.ts";

// 2026-08-26T04:30:00Z = 10:00 IST
const T_1000_IST = Date.parse("2026-08-26T04:30:00Z");
const T_1959_IST = Date.parse("2026-08-26T14:29:00Z");
const T_2000_IST = Date.parse("2026-08-26T14:30:00Z");
const T_0230_IST = Date.parse("2026-08-25T21:00:00Z"); // 02:30 IST on Aug 26

Deno.test("istHour converts UTC to IST", () => {
  assertEquals(istHour(T_1000_IST), 10);
  assertEquals(istHour(T_0230_IST), 2);
});

Deno.test("window is start-inclusive, end-exclusive", () => {
  assertEquals(inCallWindow(T_1000_IST, 10, 20), true);
  assertEquals(inCallWindow(T_1959_IST, 10, 20), true);
  assertEquals(inCallWindow(T_2000_IST, 10, 20), false);
  assertEquals(inCallWindow(T_0230_IST, 10, 20), false);
});

Deno.test("nextWindowOpen is the next IST start hour strictly after now", () => {
  assertEquals(nextWindowOpen(T_0230_IST, 10).toISOString(), "2026-08-26T04:30:00.000Z");
  assertEquals(nextWindowOpen(T_2000_IST, 10).toISOString(), "2026-08-27T04:30:00.000Z");
  assertEquals(nextWindowOpen(T_1000_IST, 10).toISOString(), "2026-08-27T04:30:00.000Z");
});

const base: VoiceEligibilityInput = {
  enabled: true, cartTotal: 748, minCartValue: 0, voiceDnd: false, optedIn: true,
  inboundSinceEnrol: false, waDelivered: true, waStoodDown: false, waPending: false,
  recentCallWithin7d: false, callForThisCart: false,
};

Deno.test("eligibility verdicts", () => {
  assertEquals(voiceEligibility(base), { action: "call" });
  assertEquals(voiceEligibility({ ...base, enabled: false }).action, "defer");
  assertEquals(voiceEligibility({ ...base, cartTotal: 100, minCartValue: 599 }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, voiceDnd: true }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, optedIn: false }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, inboundSinceEnrol: true }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, callForThisCart: true }).action, "cancel");
  assertEquals(voiceEligibility({ ...base, recentCallWithin7d: true }).action, "cancel");
  // WA still pending and not stood down: wait for WA to finish first.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: true }), { action: "defer", hours: 1, reason: "wa_pending" });
  // WA blocked by cap: call now.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: true, waStoodDown: true }), { action: "call" });
  // Nothing delivered, nothing pending (WA rows failed/expired): call.
  assertEquals(voiceEligibility({ ...base, waDelivered: false, waPending: false }), { action: "call" });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd promunch-email-agent && deno test supabase/functions/_shared/voice-eligibility_test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// Pure decision logic for the Sarvam voice rescue call. No I/O, so it is unit
// tested in isolation; wa-journey-tick gathers the inputs and acts on the verdict.
//
// Ordering matters: the "cancel" checks are cheap and final, the "defer" checks
// leave the run alive. A voice row is only ever dialled ONCE per cart and at
// most once per customer per 7 days, regardless of what the caller passes.

export const VOICE_TEMPLATE = "voice_cart_call";

const IST_OFFSET_MS = 5.5 * 3600_000;

export function istHour(nowMs: number): number {
  return new Date(nowMs + IST_OFFSET_MS).getUTCHours();
}

export function inCallWindow(nowMs: number, startHour: number, endHour: number): boolean {
  const h = istHour(nowMs);
  return h >= startHour && h < endHour;
}

/** Next IST `startHour` strictly after `nowMs`, as a UTC Date. */
export function nextWindowOpen(nowMs: number, startHour: number): Date {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  let openIst = day + startHour * 3600_000;
  if (openIst <= nowMs + IST_OFFSET_MS) openIst += 86400_000;
  return new Date(openIst - IST_OFFSET_MS);
}

export interface VoiceEligibilityInput {
  enabled: boolean;
  cartTotal: number;
  minCartValue: number;
  voiceDnd: boolean;
  optedIn: boolean;
  inboundSinceEnrol: boolean;
  waDelivered: boolean;
  waStoodDown: boolean;
  waPending: boolean;
  recentCallWithin7d: boolean;
  callForThisCart: boolean;
}

export type VoiceVerdict =
  | { action: "call" }
  | { action: "cancel"; reason: string }
  | { action: "defer"; hours: number; reason: string };

export function voiceEligibility(i: VoiceEligibilityInput): VoiceVerdict {
  if (!i.enabled) return { action: "defer", hours: 6, reason: "voice_disabled" };
  if (i.callForThisCart) return { action: "cancel", reason: "already_called_this_cart" };
  if (i.recentCallWithin7d) return { action: "cancel", reason: "called_within_7d" };
  if (i.voiceDnd) return { action: "cancel", reason: "voice_dnd" };
  if (!i.optedIn) return { action: "cancel", reason: "wa_opted_out" };
  if (i.inboundSinceEnrol) return { action: "cancel", reason: "wa_engaged" };
  if (i.cartTotal < i.minCartValue) return { action: "cancel", reason: "below_min_cart_value" };
  if (i.waPending && !i.waStoodDown) return { action: "defer", hours: 1, reason: "wa_pending" };
  return { action: "call" };
}
```

- [ ] **Step 4: Run tests**

Run: `cd promunch-email-agent && deno test supabase/functions/_shared/voice-eligibility_test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add promunch-email-agent/supabase/functions/_shared/voice-eligibility.ts promunch-email-agent/supabase/functions/_shared/voice-eligibility_test.ts
git commit -m "feat(voice): pure eligibility + IST call-window helpers with tests"
```

---

### Task 3: Sarvam client `_shared/sarvam.ts`

**Files:**
- Create: `promunch-email-agent/supabase/functions/_shared/sarvam.ts`

**Interfaces:**
- Consumes: `getAppSecret` from `./app-secrets.ts`.
- Produces:
  ```ts
  export interface SarvamConfig { apiKey: string; orgId: string; workspaceId: string; appId: string; appVersion: number; connectionId: string; agentPhone: string }
  export async function sarvamConfig(): Promise<SarvamConfig | null>;   // null when any piece is missing
  export async function startOutboundCall(args: { phoneE164: string; agentVariables: Record<string, string>; language: string; webhookUrl: string; metadata: Record<string, string> }): Promise<{ ok: true; attemptId: string } | { ok: false; error: string }>;
  export async function addToDndList(phoneE164: string): Promise<boolean>;
  ```

- [ ] **Step 1: Implement**

```ts
// Sarvam Voice Agents (indus.sarvam.ai) REST client. Docs:
//   https://docs.sarvam.ai/api-reference/instant-outbound/create
//   https://docs.sarvam.ai/conversations/deploy/campaigns/dnd
// API key is owner-rotatable via app_secrets (Settings -> API keys); the ids
// are function secrets because they change only when the agent is rebuilt.

import { getAppSecret } from "./app-secrets.ts";

const BASE = "https://apps.sarvam.ai/api";

export interface SarvamConfig {
  apiKey: string; orgId: string; workspaceId: string; appId: string;
  appVersion: number; connectionId: string; agentPhone: string;
}

export async function sarvamConfig(): Promise<SarvamConfig | null> {
  const apiKey = await getAppSecret("SARVAM_API_KEY");
  const orgId = Deno.env.get("SARVAM_ORG_ID");
  const workspaceId = Deno.env.get("SARVAM_WORKSPACE_ID");
  const appId = Deno.env.get("SARVAM_APP_ID");
  const appVersion = Number(Deno.env.get("SARVAM_APP_VERSION") ?? "1");
  const connectionId = Deno.env.get("SARVAM_CONNECTION_ID");
  const agentPhone = Deno.env.get("SARVAM_AGENT_PHONE");
  if (!apiKey || !orgId || !workspaceId || !appId || !connectionId || !agentPhone) return null;
  return { apiKey, orgId, workspaceId, appId, appVersion, connectionId, agentPhone };
}

export async function startOutboundCall(args: {
  phoneE164: string;
  agentVariables: Record<string, string>;
  language: string;
  webhookUrl: string;
  metadata: Record<string, string>;
}): Promise<{ ok: true; attemptId: string } | { ok: false; error: string }> {
  const cfg = await sarvamConfig();
  if (!cfg) return { ok: false, error: "sarvam not configured (missing SARVAM_* secrets)" };
  const url = `${BASE}/outbounds/v1/orgs/${cfg.orgId}/workspaces/${cfg.workspaceId}/outbounds`;
  const body = {
    app_config: {
      app_id: cfg.appId,
      app_version: cfg.appVersion,
      connection_config: { connection_id: cfg.connectionId, agent_phone_number: cfg.agentPhone },
      agent_variables: args.agentVariables,
      app_type: "agent",
      app_overrides: { initial_language_name: args.language },
    },
    user_config: { user_phone_number: args.phoneE164 },
    webhook_config: { url: args.webhookUrl, metadata: args.metadata },
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "X-API-Key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `sarvam HTTP ${r.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as { attempt_id?: string };
    if (!json.attempt_id) return { ok: false, error: `sarvam: no attempt_id in ${text.slice(0, 200)}` };
    return { ok: true, attemptId: json.attempt_id };
  } catch (e) {
    return { ok: false, error: `sarvam fetch failed: ${String(e)}` };
  }
}

// Best effort. Sarvam documents the DND list as a dashboard feature; the
// endpoint below is the scheduling service's list. If it 404s we still keep our
// own voice_dnd flag, which is what actually gates dialling.
export async function addToDndList(phoneE164: string): Promise<boolean> {
  const cfg = await sarvamConfig();
  if (!cfg) return false;
  try {
    const r = await fetch(`${BASE}/scheduling/v1/orgs/${cfg.orgId}/workspaces/${cfg.workspaceId}/dnd`, {
      method: "POST",
      headers: { "X-API-Key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ phone_numbers: [phoneE164] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd promunch-email-agent && deno check supabase/functions/_shared/sarvam.ts`
Expected: no errors.

```bash
git add promunch-email-agent/supabase/functions/_shared/sarvam.ts
git commit -m "feat(voice): Sarvam instant-outbound + DND client"
```

---

### Task 4: Edge function `voice-call-start`

**Files:**
- Create: `promunch-email-agent/supabase/functions/voice-call-start/index.ts`
- Modify: `promunch-email-agent/supabase/config.toml` (add entry)

**Interfaces:**
- Consumes: `startOutboundCall` (Task 3), `voice_calls` row already inserted by the tick (Task 8) in `dialing` state.
- Produces: HTTP `POST {call_id}` → `{ok:true, attempt_id}` or `{ok:false, error}`. On failure it sets `voice_calls.status='start_failed'` and `failure_reason`.

- [ ] **Step 1: Implement**

```ts
// Internal: place ONE Sarvam outbound call for an already-claimed voice_calls
// row. The tick owns the claim (journey run active->completed + voice_calls
// insert); this function only talks to Sarvam and records the attempt id.
// Never called for a row that is not 'dialing' with attempt_id null.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { startOutboundCall } from "../_shared/sarvam.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const body = await req.json().catch(() => null) as { call_id?: string } | null;
  if (!body?.call_id) return j({ error: "call_id required" }, 400);
  const sb = db();

  const { data: call } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, order_ref, status, attempt_id, webhook_token, agent_vars")
    .eq("id", body.call_id).maybeSingle();
  if (!call) return j({ ok: false, error: "call not found" }, 404);
  if (call.status !== "dialing" || call.attempt_id) return j({ ok: false, error: "call already started" }, 409);

  const { data: run } = await sb.from("wa_journey_runs").select("context").eq("id", call.run_id).maybeSingle();
  const ctx = (run?.context ?? {}) as Record<string, unknown>;
  const vars = (ctx.vars ?? {}) as Record<string, string>;
  const items = Array.isArray(ctx.items) ? ctx.items as Array<{ title: string; qty: number }> : [];
  const language = (await getFlowSettings()).voice_language || "Hindi";

  const agentVariables: Record<string, string> = {
    customer_name: vars["1"] || "there",
    cart_items: items.length ? items.map((i) => `${i.qty}x ${i.title}`).join(", ") : "your PROMUNCH snacks",
    cart_total: ctx.total ? `Rs ${Number(ctx.total).toFixed(0)}` : "",
    coupon_code: String(ctx.coupon ?? ""),
    checkout_url: vars["2"] ?? "",
    call_id: call.id,
    phone: `+${call.wa_id}`,
  };

  const res = await startOutboundCall({
    phoneE164: `+${call.wa_id}`,
    agentVariables,
    language,
    webhookUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-webhook`,
    metadata: { call_id: call.id, run_id: String(call.run_id ?? ""), wa_id: call.wa_id, token: call.webhook_token },
  });

  if (!res.ok) {
    await sb.from("voice_calls").update({ status: "start_failed", failure_reason: res.error, agent_vars: agentVariables, updated_at: new Date().toISOString() })
      .eq("id", call.id);
    await logConnector({ connector: "shopify_wa", level: "error", event: "voice_start_failed", message: `Cart ${call.order_ref}: ${res.error}`, ref: call.order_ref ?? call.id }).catch(() => {});
    return j({ ok: false, error: res.error }, 502);
  }
  await sb.from("voice_calls").update({ attempt_id: res.attemptId, agent_vars: agentVariables, updated_at: new Date().toISOString() }).eq("id", call.id);
  await logConnector({ connector: "shopify_wa", level: "info", event: "voice_call_placed", message: `Cart ${call.order_ref}: Sarvam attempt ${res.attemptId} to ${call.wa_id}.`, ref: call.order_ref ?? call.id }).catch(() => {});
  return j({ ok: true, attempt_id: res.attemptId });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 2: config.toml** — append:

```toml
[functions.voice-call-start]
verify_jwt = false                    # function-to-function from wa-journey-tick; real auth is requireInternal
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd promunch-email-agent && deno check supabase/functions/voice-call-start/index.ts`

```bash
git add promunch-email-agent/supabase/functions/voice-call-start promunch-email-agent/supabase/config.toml
git commit -m "feat(voice): voice-call-start edge function"
```

---

### Task 5: Edge function `voice-webhook`

**Files:**
- Create: `promunch-email-agent/supabase/functions/voice-webhook/index.ts`
- Create: `promunch-email-agent/supabase/functions/_shared/voice-webhook-verify.ts`
- Test: `promunch-email-agent/supabase/functions/_shared/voice-webhook-verify_test.ts`
- Modify: `promunch-email-agent/supabase/config.toml`

**Interfaces:**
- Produces: `verifyVoiceWebhook(payload, row): { ok: true } | { ok: false; reason: string }` (pure). Webhook updates `voice_calls`, journey run `delivered_at`, `wa_contacts.voice_dnd`, and schedules one retry on no-answer.

- [ ] **Step 1: Failing test for the verifier**

```ts
// Run: deno test supabase/functions/_shared/voice-webhook-verify_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyVoiceWebhook } from "./voice-webhook-verify.ts";

const row = { status: "dialing", attempt_id: "att_1", webhook_token: "tok_abc" };

Deno.test("accepts matching token + attempt on a dialing row", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_abc" }, row), { ok: true });
});
Deno.test("rejects wrong token", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_xyz" }, row).ok, false);
});
Deno.test("rejects wrong attempt", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_2", token: "tok_abc" }, row).ok, false);
});
Deno.test("rejects replay on finished row", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_abc" }, { ...row, status: "connected" }), { ok: false, reason: "already_finished" });
});
Deno.test("rejects missing row", () => {
  assertEquals(verifyVoiceWebhook({ attempt_id: "att_1", token: "tok_abc" }, null).ok, false);
});
```

- [ ] **Step 2: Run, expect failure** — `cd promunch-email-agent && deno test supabase/functions/_shared/voice-webhook-verify_test.ts` → module not found.

- [ ] **Step 3: Implement verifier**

```ts
// Sarvam documents no signature on the post-call webhook, so authenticity is
// our own: the payload must echo the per-call random token we handed Sarvam in
// webhook_config.metadata AND name the attempt_id we stored, and the row must
// still be waiting. Constant-time compare so the token cannot be guessed byte
// by byte.

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export interface VoiceCallRowLite { status: string; attempt_id: string | null; webhook_token: string }

export function verifyVoiceWebhook(
  p: { attempt_id?: string; token?: string },
  row: VoiceCallRowLite | null,
): { ok: true } | { ok: false; reason: string } {
  if (!row) return { ok: false, reason: "no_such_call" };
  if (!p.token || !timingSafeEqual(p.token, row.webhook_token)) return { ok: false, reason: "bad_token" };
  if (!p.attempt_id || !row.attempt_id || p.attempt_id !== row.attempt_id) return { ok: false, reason: "attempt_mismatch" };
  if (row.status !== "dialing") return { ok: false, reason: "already_finished" };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests** → 5 passed.

- [ ] **Step 5: Implement the webhook**

```ts
// Public receiver for Sarvam's post-call webhook (verify_jwt=false). Auth is
// verifyVoiceWebhook (per-call token + attempt id). Payload shape:
//   https://docs.sarvam.ai/api-reference/instant-outbound/webhook-payload
// Always returns 200 once verified so Sarvam does not retry a processed call.

import { db } from "../_shared/supabase.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { verifyVoiceWebhook } from "../_shared/voice-webhook-verify.ts";
import { addToDndList } from "../_shared/sarvam.ts";

interface SarvamWebhook {
  attempt_id?: string;
  status?: "connected" | "no_answer" | "busy" | "failed";
  duration?: number | null;
  interaction_id?: string;
  failure_reason?: string | null;
  final_agent_variables?: Record<string, unknown>;
  interaction_transcript?: Array<{ role: string; en_text: string }>;
  webhook_config?: { url?: string; metadata?: Record<string, string> };
}

const OUTCOMES = new Set(["will_buy", "asked_link", "not_interested", "do_not_call", "callback_later", "unknown"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const p = await req.json().catch(() => null) as SarvamWebhook | null;
  if (!p) return j({ error: "bad json" }, 400);
  const meta = p.webhook_config?.metadata ?? {};
  const sb = db();

  const { data: row } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, order_ref, status, attempt_id, webhook_token")
    .eq("id", meta.call_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  const v = verifyVoiceWebhook({ attempt_id: p.attempt_id, token: meta.token }, row);
  if (!v.ok) {
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_webhook_rejected", message: `voice-webhook rejected: ${v.reason}`, ref: meta.call_id ?? null, throttleMinutes: 10 }).catch(() => {});
    // already_finished is a benign duplicate delivery: acknowledge it.
    return v.reason === "already_finished" ? j({ ok: true, dup: true }) : j({ error: v.reason }, 401);
  }
  const call = row!;
  const status = p.status ?? "failed";
  const rawOutcome = String(p.final_agent_variables?.outcome ?? "unknown").toLowerCase();
  const outcome = OUTCOMES.has(rawOutcome) ? rawOutcome : "unknown";
  const now = new Date().toISOString();

  // Idempotent finalise: only the dialing row transitions.
  const { data: finalised } = await sb.from("voice_calls").update({
    status, outcome, duration_s: p.duration ?? null, failure_reason: p.failure_reason ?? null,
    interaction_id: p.interaction_id ?? null, transcript: p.interaction_transcript ?? null,
    agent_vars: p.final_agent_variables ?? null, updated_at: now,
  }).eq("id", call.id).eq("status", "dialing").select("id");
  if (!finalised?.length) return j({ ok: true, dup: true });

  if (status === "connected" && call.run_id) {
    // Honest attribution: the customer heard us. If an order follows, the cart
    // counts as recovered (cart-recovery route requires converted && delivered).
    await sb.from("wa_journey_runs").update({ delivered_at: now, last_error: null })
      .eq("id", call.run_id).is("delivered_at", null).then(() => {}, () => {});
  }
  if (outcome === "do_not_call") {
    await sb.from("wa_contacts").update({ voice_dnd: true, updated_at: now }).eq("wa_id", call.wa_id).then(() => {}, () => {});
    await addToDndList(`+${call.wa_id}`);
  }
  if ((status === "no_answer" || status === "busy") && call.run_id) {
    // ONE retry, 2h later, inside the window (the tick re-checks the window).
    const { data: run } = await sb.from("wa_journey_runs").select("context, deadline_at").eq("id", call.run_id).maybeSingle();
    const ctx = (run?.context ?? {}) as Record<string, unknown>;
    const attempts = Number(ctx.voice_attempts ?? 0);
    if (attempts < 1 && (!run?.deadline_at || run.deadline_at > now)) {
      await sb.from("wa_journey_runs").update({
        status: "active",
        next_action_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
        last_error: `voice ${status}, one retry scheduled`,
        context: { ...ctx, voice_attempts: attempts + 1 },
      }).eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    } else {
      await sb.from("wa_journey_runs").update({ status: "expired", last_error: `voice ${status} twice` })
        .eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    }
  }
  if (status === "failed" && call.run_id) {
    await sb.from("wa_journey_runs").update({ status: "failed", last_error: `voice failed: ${p.failure_reason ?? "unknown"}` })
      .eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_call_failed", message: `Cart ${call.order_ref}: ${p.failure_reason ?? "unknown"}`, ref: call.order_ref ?? call.id }).catch(() => {});
  }
  await logConnector({ connector: "shopify_wa", level: "info", event: "voice_call_result", message: `Cart ${call.order_ref}: ${status}${p.duration ? ` ${p.duration}s` : ""}, outcome ${outcome}.`, ref: call.order_ref ?? call.id }).catch(() => {});
  return j({ ok: true });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 6: config.toml** — append:

```toml
[functions.voice-webhook]
verify_jwt = false                    # Sarvam post-call webhook; auth = per-call token in metadata (voice-webhook-verify.ts)
```

- [ ] **Step 7: Typecheck + commit**

Run: `cd promunch-email-agent && deno check supabase/functions/voice-webhook/index.ts`

```bash
git add promunch-email-agent/supabase/functions/voice-webhook promunch-email-agent/supabase/functions/_shared/voice-webhook-verify.ts promunch-email-agent/supabase/functions/_shared/voice-webhook-verify_test.ts promunch-email-agent/supabase/config.toml
git commit -m "feat(voice): voice-webhook receiver with per-call token verification"
```

---

### Task 6: `voice-tool-wa-link` + `cart_link_requested` template

**Files:**
- Create: `promunch-email-agent/supabase/functions/voice-tool-wa-link/index.ts`
- Modify: `promunch-email-agent/supabase/functions/wa-template-create/index.ts` (add template def after `shipping_update_v2` entry)
- Modify: `promunch-email-agent/supabase/config.toml`

**Interfaces:**
- Consumes: `claimSend/markSendSent/releaseSend` (`_shared/confirmations.ts`), `sessionOpen` (`_shared/window-asks.ts`), `wa-send` HTTP contract.
- Produces: `POST {call_id, phone}` with `Authorization: Bearer INTERNAL_FN_SECRET` → `{ok, message}`.

- [ ] **Step 1: Add the template definition** in `wa-template-create/index.ts`, inside the template array next to the other UTILITY entries:

```ts
  {
    // Sent mid-call by the Sarvam voice agent when the customer asks for their
    // cart link. UTILITY: the customer requested it seconds ago on the phone.
    // 1=name 2=full https checkout URL (body param, not a button, so the
    // partner recovery URL survives untouched).
    name: "cart_link_requested",
    language: "en",
    category: "UTILITY",
    body:
      "Hi {{1}}, here is the PROMUNCH checkout link you asked for on our call:\n{{2}}\n\n" +
      "Your cart is saved, just tap to finish.",
    bodyExample: ["Aarav", "https://promunch.in/12345/checkouts/abc123/recover"],
    footer: "Your Munchy Pal",
  },
```

- [ ] **Step 2: Implement the tool endpoint**

```ts
// HTTPS tool target for the Sarvam agent ("send_whatsapp_link"). Configured in
// indus.sarvam.ai with bearer auth = INTERNAL_FN_SECRET, so requireInternal
// gates it exactly like wa-send. One link per call, ever (claimSend), and the
// call must still be live so a stale/replayed tool call cannot message anyone.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { claimSend, markSendSent, releaseSend } from "../_shared/confirmations.ts";
import { sessionOpen } from "../_shared/window-asks.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ ok: false, message: "POST only" }, 405);
  const body = await req.json().catch(() => null) as { call_id?: string; phone?: string } | null;
  if (!body?.call_id) return j({ ok: false, message: "Could not send the link." }, 400);
  const sb = db();

  const { data: call } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, status, link_sent_at, created_at").eq("id", body.call_id).maybeSingle();
  if (!call || call.status !== "dialing") return j({ ok: false, message: "Could not send the link." }, 400);
  const phoneDigits = String(body.phone ?? "").replace(/\D/g, "");
  if (phoneDigits && phoneDigits !== call.wa_id) return j({ ok: false, message: "Could not send the link." }, 400);
  if (call.link_sent_at) return j({ ok: true, message: "The link is already on your WhatsApp." });

  const { data: run } = await sb.from("wa_journey_runs").select("context").eq("id", call.run_id).maybeSingle();
  const vars = ((run?.context as Record<string, unknown> | null)?.vars ?? {}) as Record<string, string>;
  const url = vars["2"];
  const name = vars["1"] || "there";
  if (!url) return j({ ok: false, message: "Could not find the cart link." }, 400);

  const key = `voice_link:${call.id}`;
  if (!(await claimSend(key))) return j({ ok: true, message: "The link is on its way to your WhatsApp." });

  const { data: th } = await sb.from("wa_threads").select("last_inbound_at").eq("wa_id", call.wa_id).maybeSingle();
  const free = sessionOpen(th?.last_inbound_at, Date.now());
  const payload = free
    ? { to: call.wa_id, kind: "text", text: `Hi ${name}, here is your PROMUNCH checkout link from our call:\n${url}\n\nYour cart is saved, just tap to finish. Your Munchy Pal`, sent_by: "voice:cart_link", journey_run_id: call.run_id }
    : { to: call.wa_id, kind: "template", template: { name: "cart_link_requested", language: "en", vars: { "1": name, "2": url } }, sent_by: "voice:cart_link", journey_run_id: call.run_id };

  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const res = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) as { ok?: boolean; error?: string };
  if (!res.ok) {
    await releaseSend(key);
    return j({ ok: false, message: "Could not send the link right now. You can also find it in your WhatsApp chat with PROMUNCH." }, 502);
  }
  await markSendSent(key);
  await sb.from("voice_calls").update({ link_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", call.id);
  return j({ ok: true, message: "Done, the checkout link is on your WhatsApp now." });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 3: config.toml** — append:

```toml
[functions.voice-tool-wa-link]
verify_jwt = false                    # Sarvam HTTPS tool; auth = bearer INTERNAL_FN_SECRET via requireInternal
```

- [ ] **Step 4: Typecheck + commit**

Run: `cd promunch-email-agent && deno check supabase/functions/voice-tool-wa-link/index.ts supabase/functions/wa-template-create/index.ts`

```bash
git add promunch-email-agent/supabase/functions/voice-tool-wa-link promunch-email-agent/supabase/functions/wa-template-create/index.ts promunch-email-agent/supabase/config.toml
git commit -m "feat(voice): mid-call WhatsApp link tool + cart_link_requested UTILITY template"
```

---

### Task 7: Enrol the voice step in `shopify-wa`

**Files:**
- Modify: `promunch-email-agent/supabase/functions/shopify-wa/index.ts` (steps array ~:372 and rows insert ~:479; refresh loop ~:440)

**Interfaces:**
- Consumes: `VOICE_TEMPLATE` from `_shared/voice-eligibility.ts`; `flows.voice_call_enabled`, `flows.cart_voice_delay_hours`.
- Produces: a third `wa_journey_runs` row with `context = { template: "voice_cart_call", channel: "voice", language: "en", vars: {1: name, 2: reminderUrl}, items, total, coupon }`.

- [ ] **Step 1: Import** at top of `shopify-wa/index.ts`:

```ts
import { VOICE_TEMPLATE } from "../_shared/voice-eligibility.ts";
```

- [ ] **Step 2: Capture items + total for the agent.** `handleCheckout` already reads `line_items` (:243-249) into a local list and `total_price` (:258). Ensure two locals exist right after those reads (adapt names to what is there):

```ts
  const voiceItems = (checkout.line_items ?? []).slice(0, 8)
    .map((li: { title?: string; quantity?: number }) => ({ title: String(li.title ?? "item"), qty: Number(li.quantity ?? 1) }));
  const voiceTotal = Number(checkout.total_price ?? 0);
```

- [ ] **Step 3: Replace the `rows` builder** (currently `const rows = steps.map(...)`) with:

```ts
    const rows = steps.map((s) => ({
      journey_key: "abandoned_checkout",
      wa_id: waId,
      next_action_at: new Date(Date.now() + s.h * 3600_000).toISOString(),
      deadline_at: deadlineAt,
      context: { template: s.template, language: "en", components: s.components, vars: { "1": name, "2": s.url } },
      order_ref: token,
    }));
    // Voice rescue step: due after WA step 2 + delay; wa-journey-tick only dials
    // it once WA has demonstrably failed (see _shared/voice-eligibility.ts).
    if (flows.voice_call_enabled) {
      rows.push({
        journey_key: "abandoned_checkout",
        wa_id: waId,
        next_action_at: new Date(Date.now() + (flows.cart_step2_delay_hours + flows.cart_voice_delay_hours) * 3600_000).toISOString(),
        deadline_at: deadlineAt,
        context: {
          template: VOICE_TEMPLATE, channel: "voice", language: "en", components: undefined,
          vars: { "1": name, "2": reminderUrl },
          items: voiceItems, total: voiceTotal, coupon: code,
        } as unknown as (typeof rows)[number]["context"],
        order_ref: token,
      });
    }
```

- [ ] **Step 4: Refresh-in-place for the voice row.** In the `for (const run of live)` loop, before `const step = byTemplate.get(...)`, add:

```ts
        if (ctx.template === VOICE_TEMPLATE) {
          const oldVars = (ctx.vars ?? {}) as Record<string, string>;
          const displayName = name === "there" ? (oldVars["1"] || name) : name;
          ctx.vars = { ...oldVars, "1": displayName, "2": reminderUrl };
          ctx.items = voiceItems; ctx.total = voiceTotal; ctx.coupon = code;
          const { error: vErr } = await sb.from("wa_journey_runs")
            .update({ context: ctx, order_ref: token }).eq("id", run.id).eq("status", "active");
          if (!vErr) refreshed++;
          continue;
        }
```

- [ ] **Step 5: Typecheck + commit**

Run: `cd promunch-email-agent && deno check supabase/functions/shopify-wa/index.ts`

```bash
git add promunch-email-agent/supabase/functions/shopify-wa/index.ts
git commit -m "feat(voice): enrol voice rescue step with abandoned carts"
```

---

### Task 8: Dispatch in `wa-journey-tick`

**Files:**
- Modify: `promunch-email-agent/supabase/functions/wa-journey-tick/index.ts` (imports; new branch inserted right after the opted-out block, before `const windowEligible`; dialing sweep before the loop)

**Interfaces:**
- Consumes: `voiceEligibility`, `inCallWindow`, `nextWindowOpen`, `VOICE_TEMPLATE` (Task 2); `voice-call-start` (Task 4).

- [ ] **Step 1: Imports**

```ts
import { VOICE_TEMPLATE, inCallWindow, nextWindowOpen, voiceEligibility } from "../_shared/voice-eligibility.ts";
```

- [ ] **Step 2: Sweep stuck dials** — after `const optedOutWa` loop, before `let sent = 0`:

```ts
  // A dial whose webhook never came back (Sarvam outage, crash between insert
  // and start) must not sit 'dialing' forever: it would block the per-cart and
  // 7-day guards. Mark unknown after 2h; never redial from here (§0).
  await sb.from("voice_calls").update({ status: "unknown", updated_at: now })
    .eq("status", "dialing").lt("created_at", new Date(Date.now() - 2 * 3600_000).toISOString())
    .then(() => {}, () => {});
```

- [ ] **Step 3: Voice branch** — insert after the `optedOutWa.has(run.wa_id)` block and before `const windowEligible = ...`:

```ts
    // ---- VOICE RESCUE CALL ----
    if (run.context?.channel === "voice") {
      const r = await handleVoiceRun(sb, run, flows, now);
      if (r === "sent") sent++; else if (r === "failed") failed++; else skipped++;
      continue;
    }
```

- [ ] **Step 4: Add `handleVoiceRun`** near `callWaSend` at the bottom:

```ts
// Decide, claim, dial. Returns "sent" (call placed), "failed", or "skipped".
async function handleVoiceRun(
  sb: ReturnType<typeof db>,
  run: { id: string; wa_id: string; order_ref: string | null; created_at: string; context?: Record<string, unknown> },
  flows: Awaited<ReturnType<typeof getFlowSettings>>,
  now: string,
): Promise<"sent" | "failed" | "skipped"> {
  const nowMs = Date.parse(now);
  const defer = async (ms: number, why: string) => {
    await sb.from("wa_journey_runs").update({ next_action_at: new Date(nowMs + ms).toISOString(), last_error: why }).eq("id", run.id).then(() => {}, () => {});
    return "skipped" as const;
  };

  // Gather inputs (all reads; nothing is written until the claim below).
  const [{ data: contact }, { data: waRows }, { data: th }, { data: calls }] = await Promise.all([
    sb.from("wa_contacts").select("opted_in, voice_dnd").eq("wa_id", run.wa_id).maybeSingle(),
    sb.from("wa_journey_runs").select("status, delivered_at, context, created_at")
      .eq("wa_id", run.wa_id).eq("journey_key", "abandoned_checkout").neq("id", run.id)
      .gte("created_at", new Date(Date.parse(run.created_at) - 60_000).toISOString()),
    sb.from("wa_threads").select("last_inbound_at").eq("wa_id", run.wa_id).maybeSingle(),
    sb.from("voice_calls").select("order_ref, created_at, status").eq("wa_id", run.wa_id)
      .gte("created_at", new Date(nowMs - 7 * 86400_000).toISOString()),
  ]);
  const rows = (waRows ?? []).filter((r) => (r.context as Record<string, unknown> | null)?.channel !== "voice");
  const stood = (r: { context: unknown }) => {
    const c = (r.context ?? {}) as Record<string, unknown>;
    return c.tpl_stood_down === true || Number(c.tpl_cap_attempts ?? 0) >= TPL_CAP_ATTEMPTS_MAX;
  };
  const verdict = voiceEligibility({
    enabled: flows.voice_call_enabled,
    cartTotal: Number(run.context?.total ?? 0),
    minCartValue: flows.voice_min_cart_value,
    voiceDnd: contact?.voice_dnd === true,
    optedIn: contact?.opted_in !== false,
    inboundSinceEnrol: !!th?.last_inbound_at && Date.parse(th.last_inbound_at) > Date.parse(run.created_at),
    waDelivered: rows.some((r) => !!r.delivered_at),
    waStoodDown: rows.some(stood),
    waPending: rows.some((r) => r.status === "active"),
    recentCallWithin7d: (calls ?? []).some((c) => c.status !== "start_failed"),
    callForThisCart: (calls ?? []).some((c) => c.order_ref === run.order_ref && c.status !== "start_failed"),
  });
  if (verdict.action === "cancel") {
    await mark(run.id, "cancelled", `voice: ${verdict.reason}`);
    return "skipped";
  }
  if (verdict.action === "defer") return defer(verdict.hours * 3600_000, `voice: ${verdict.reason}`);
  if (!inCallWindow(nowMs, flows.voice_call_start_hour, flows.voice_call_end_hour)) {
    const open = nextWindowOpen(nowMs, flows.voice_call_start_hour).getTime();
    return defer(open - nowMs, "voice: outside call window");
  }

  // Sarvam not configured: hold rather than burn the run.
  if (!Deno.env.get("SARVAM_APP_ID")) return defer(6 * 3600_000, "voice: SARVAM_* secrets not set");
  // Rollout allowlist (spec §9): while VOICE_TEST_WA_IDS is set, only those
  // numbers are dialled; everyone else waits. Unset it after the live test.
  const allow = (Deno.env.get("VOICE_TEST_WA_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(run.wa_id)) return defer(6 * 3600_000, "voice: not in VOICE_TEST_WA_IDS allowlist");

  // ATOMIC CLAIM: active -> completed, exactly one tick wins. Crash after this
  // point loses the call, never duplicates it.
  const { data: claimed } = await sb.from("wa_journey_runs")
    .update({ status: "completed", last_error: null }).eq("id", run.id).eq("status", "active").select("id");
  if (!claimed?.length) return "skipped";

  const token = crypto.randomUUID().replace(/-/g, "");
  const { data: call, error: insErr } = await sb.from("voice_calls")
    .insert({ run_id: run.id, wa_id: run.wa_id, order_ref: run.order_ref, webhook_token: token, status: "dialing" })
    .select("id").single();
  if (insErr || !call) {
    await sb.from("wa_journey_runs").update({ status: "active", next_action_at: new Date(nowMs + 3600_000).toISOString(), last_error: `voice: ledger insert failed ${insErr?.message ?? ""}` }).eq("id", run.id);
    return "failed";
  }

  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-call-start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ call_id: call.id }),
  }).catch(() => null);
  const res = r ? await r.json().catch(() => ({ ok: false })) as { ok?: boolean; error?: string } : { ok: false, error: "fetch failed" };
  if (res.ok) return "sent";

  // Start failed: hand the run back with a bounded retry (3 strikes).
  const strikes = Number(run.context?.voice_start_failures ?? 0) + 1;
  if (strikes >= 3) {
    await mark(run.id, "failed", `voice: start failed ${strikes}x — ${res.error ?? "unknown"}`);
  } else {
    await sb.from("wa_journey_runs").update({
      status: "active", next_action_at: new Date(nowMs + 3600_000).toISOString(),
      last_error: `voice: start failed (${strikes}/3) — ${res.error ?? "unknown"}`,
      context: { ...(run.context ?? {}), voice_start_failures: strikes },
    }).eq("id", run.id);
  }
  return "failed";
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `cd promunch-email-agent && deno check supabase/functions/wa-journey-tick/index.ts`

```bash
git add promunch-email-agent/supabase/functions/wa-journey-tick/index.ts
git commit -m "feat(voice): dial the voice rescue step from wa-journey-tick"
```

---

### Task 9: Dashboard (Flows card, cart-recovery stats, call log)

**Files:**
- Modify: `src/components/whatsapp/FlowsView.tsx` (new card after abandoned-cart card ~:468)
- Modify: `src/app/api/whatsapp/cart-recovery/route.ts`
- Create: `src/app/api/whatsapp/voice-calls/route.ts`
- Modify: `src/components/whatsapp/InboxView.tsx` (CustomerPanel: calls section after orders)

- [ ] **Step 1: Flows card.** Add `Phone` to the lucide import list, then after the abandoned-cart `</FlowCard>`:

```tsx
        {/* 3b — voice rescue call */}
        <FlowCard title="Voice rescue call (Sarvam)" icon={Phone}
          enabled={draft.voice_call_enabled} dimmed={!draft.voice_call_enabled}
          onToggle={(v) => set("voice_call_enabled", v)}>
          <Timeline>
            <Node icon={MessageSquareText} title="WhatsApp recovery failed" sub="no reply, or Meta marketing cap" tone="neutral" />
            <Arrow />
            <Wait>
              after
              <NumField value={draft.cart_voice_delay_hours} min={1} max={72} unit="h"
                onChange={(n) => set("cart_voice_delay_hours", n)} />
              past the coupon message
            </Wait>
            <Arrow />
            <Node icon={Phone} title="AI voice call" sub={<>
              {draft.voice_language} first · {String(draft.voice_call_start_hour).padStart(2, "0")}:00 to {String(draft.voice_call_end_hour).padStart(2, "0")}:00 IST
            </>} tone="green" />
          </Timeline>
          <Footnote>
            Calls only carts worth at least ₹
            <NumField value={draft.voice_min_cart_value} min={0} max={100000} step={50} unit="" width={70}
              onChange={(n) => set("voice_min_cart_value", n)} />, between{" "}
            <NumField value={draft.voice_call_start_hour} min={0} max={23} unit="h" width={48}
              onChange={(n) => set("voice_call_start_hour", n)} /> and{" "}
            <NumField value={draft.voice_call_end_hour} min={1} max={24} unit="h" width={48}
              onChange={(n) => set("voice_call_end_hour", n)} /> IST. Language:{" "}
            <select value={draft.voice_language} aria-label="Voice language"
              onChange={(e) => set("voice_language", e.target.value)}
              style={{ ...inputStyle, width: 120, padding: "3px 6px", fontSize: 12 }}>
              {["Hindi", "English", "Gujarati", "Marathi", "Tamil", "Telugu", "Kannada", "Malayalam", "Bengali", "Punjabi", "Odia"].map((l) => <option key={l}>{l}</option>)}
            </select>.
            One call per cart, at most one per customer per week, never to anyone who said do not call.
            If they ask, the agent sends the checkout link on WhatsApp during the call.
          </Footnote>
          <StatChips rows={[
            { label: "calls placed", value: voice.placed ?? 0, color: "var(--pm-green)" },
            { label: "connected", value: voice.connected ?? 0, color: "var(--pm-green)" },
            { label: "link sent", value: voice.linkSent ?? 0, color: "var(--pm-gold)" },
            { label: "recovered after call", value: voice.recovered ?? 0, color: "var(--pm-green)" },
          ]} />
        </FlowCard>
```

Where `set` is the existing draft setter; make sure its key type accepts the new keys (it is `keyof FlowSettings`, so Task 1's type extension covers it). Add near `const cart = stats.abandoned_checkout ?? {};`:

```tsx
  const voice = cartRecovery?.voice ?? {};
```

and load `cartRecovery` via the existing `apiFetch` pattern used for `/api/whatsapp/flows` (a `useQuery({ queryKey: ["cart-recovery"], queryFn: () => apiFetch("/api/whatsapp/cart-recovery").then(r => r.stats) })`).

- [ ] **Step 2: cart-recovery route** — before the final `return NextResponse.json`, add:

```ts
  // Voice rescue arm.
  const voice = { placed: 0, connected: 0, linkSent: 0, recovered: 0 };
  const { data: calls } = await supabaseAdmin
    .from("voice_calls").select("order_ref, status, link_sent_at").gte("created_at", since);
  const recoveredCarts = new Set([...carts.entries()].filter(([, c]) => c.converted && c.delivered).map(([k]) => k));
  for (const c of calls ?? []) {
    if (c.status !== "start_failed") voice.placed++;
    if (c.status === "connected") voice.connected++;
    if (c.link_sent_at) voice.linkSent++;
    if (c.status === "connected" && c.order_ref && recoveredCarts.has(c.order_ref)) voice.recovered++;
  }
```
and add `voice,` inside `stats: { ... }`.

- [ ] **Step 3: voice-calls route** `src/app/api/whatsapp/voice-calls/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Call log for one WhatsApp number (Customer panel) or the latest 50 overall.
export async function GET(req: NextRequest) {
  const waId = req.nextUrl.searchParams.get("wa_id");
  let q = supabaseAdmin.from("voice_calls")
    .select("id, wa_id, order_ref, status, outcome, duration_s, failure_reason, transcript, link_sent_at, created_at")
    .order("created_at", { ascending: false }).limit(50);
  if (waId) q = q.eq("wa_id", waId.replace(/\D/g, ""));
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: data ?? [] });
}
```

- [ ] **Step 4: CustomerPanel call log.** In `InboxView.tsx` `CustomerPanel`, add a query:

```tsx
  const { data: callData } = useQuery({
    queryKey: ["voice-calls", thread.wa_id],
    queryFn: () => apiFetch<{ calls: VoiceCall[] }>(`/api/whatsapp/voice-calls?wa_id=${thread.wa_id}`),
    enabled: visible,
  });
  const calls = callData?.calls ?? [];
```
with the type near the panel's other types:
```tsx
type VoiceCall = { id: string; status: string; outcome: string | null; duration_s: number | null; link_sent_at: string | null; created_at: string; transcript: Array<{ role: string; en_text: string }> | null };
```
Render after the orders block:
```tsx
      {calls.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pm-hint)", textTransform: "uppercase", letterSpacing: 0.4, margin: "14px 0 6px", display: "flex", alignItems: "center", gap: 5 }}>
            <Phone size={12} /> Voice calls ({calls.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {calls.map((c) => (
              <details key={c.id} style={{ border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10 }}>
                <summary style={{ fontSize: 12, cursor: "pointer" }}>
                  <strong>{c.status}</strong>{c.outcome ? ` · ${c.outcome.replace(/_/g, " ")}` : ""}{c.duration_s ? ` · ${c.duration_s}s` : ""}{c.link_sent_at ? " · link sent" : ""}
                  <span style={{ color: "var(--pm-hint)", marginLeft: 6 }}>{new Date(c.created_at).toLocaleString("en-IN")}</span>
                </summary>
                {c.transcript?.length ? (
                  <div style={{ fontSize: 11.5, marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {c.transcript.map((t, i) => <div key={i}><strong>{t.role === "agent" ? "PROMUNCH" : "Customer"}:</strong> {t.en_text}</div>)}
                  </div>
                ) : <div style={{ fontSize: 11.5, color: "var(--pm-hint)", marginTop: 6 }}>No transcript.</div>}
              </details>
            ))}
          </div>
        </>
      )}
```
Import `Phone` from lucide-react in that file.

- [ ] **Step 5: Build + lint + tests**

Run: `npm run build && npm run lint && npm run test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/whatsapp/FlowsView.tsx src/components/whatsapp/InboxView.tsx src/app/api/whatsapp/cart-recovery/route.ts src/app/api/whatsapp/voice-calls
git commit -m "feat(voice): Flows card, funnel stats and call log for the voice rescue step"
```

---

### Task 10: Docs, Sarvam setup guide, cron topology, deploy checklist

**Files:**
- Create: `docs/whatsapp/VOICE_AGENT_SETUP.md`
- Modify: `docs/README.md` (whatsapp section row), `docs/runbooks/CRON_TOPOLOGY.md` (note `voice-transcript-purge`), `CLAUDE.md` + `AGENTS.md` + `docs/architecture/ARCHITECTURE.md` edge-function count 51 → 54 and add `voice-*` to the roles list.

- [ ] **Step 1: Write `docs/whatsapp/VOICE_AGENT_SETUP.md`** containing, in this order:

1. **Prereqs**: KYC + rent number in indus.sarvam.ai (Deploy → Phone Numbers → Add Connection → Rent from Sarvam). Copy `org_id`, `workspace_id` (dashboard URL / Settings), `app_id`, `app_version`, `connection_id`, `agent_phone_number`.
2. **Function secrets** (from `promunch-email-agent/`):
   ```bash
   supabase secrets set SARVAM_ORG_ID=... SARVAM_WORKSPACE_ID=... SARVAM_APP_ID=... SARVAM_APP_VERSION=1 SARVAM_CONNECTION_ID=... SARVAM_AGENT_PHONE=+91...
   # SARVAM_API_KEY already set (also editable in Settings -> API keys once added to app_secrets providers)
   ```
3. **Agent variables** (Variables tab): Inputs `customer_name, cart_items, cart_total, coupon_code, checkout_url, call_id, phone` (string, default empty). Output `outcome`: Enum `will_buy, asked_link, not_interested, do_not_call, callback_later, unknown`, extraction prompt: "Classify the customer's final intent. do_not_call if they asked not to be called again. asked_link if they asked for the link on WhatsApp. will_buy if they said they will complete the order. callback_later if they asked to be called another time. not_interested if they declined. Otherwise unknown."
4. **System prompt** (paste verbatim):
   ```
   You are Maya from PROMUNCH, a friendly Indian snack brand making high-protein roasted soya snacks. You are calling @customer_name because they left @cart_items (total @cart_total) in their cart on promunch.in. Speak naturally in the customer's language (start in Hindi with easy English words, switch fully to English if they do). Keep the call under 3 minutes.
   Goal: help them finish the order. Offer to send the checkout link on WhatsApp; if they say yes, call the send_whatsapp_link tool and confirm "sent, please check WhatsApp". Mention coupon @coupon_code only if they hesitate on price.
   Facts you may state: PROMUNCH Crunchies are roasted soya; chips and sticks are fried; free shipping on orders of Rs 599 or more, otherwise Rs 99; cash on delivery adds Rs 50; prepaid orders get 5 percent off. If asked anything else, say you will have the team message them on WhatsApp.
   If the customer says not to call again, apologise, promise no more calls, and end the call. If they are busy, offer to call later and end politely. Never argue, never mention being an AI unless asked, never use the word Oltaflock. Sign off with "Your Munchy Pal".
   ```
5. **HTTPS tool** `send_whatsapp_link`: `POST https://<project-ref>.supabase.co/functions/v1/voice-tool-wa-link`, header `Authorization: Bearer <INTERNAL_FN_SECRET>` (auth type bearer), body `{"call_id":"@call_id","phone":"@phone"}`, timeout 20 s, fallback message "I could not send it right now, our team will message you on WhatsApp", description "Send the customer their saved cart checkout link on WhatsApp. Use when the customer agrees to receive the link."
6. **Template**: `supabase functions deploy wa-template-create` then submit `cart_link_requested` from Templates tab; wait for APPROVED.
7. **Deploy order** (spec §9) and **live test**: set `voice_call_enabled=true`, min cart 0, abandon a real cart from the owner's phone with WA disabled path (or wait for WA stand-down), expect call within window, ask for link, receive WhatsApp, confirm `voice_calls` row + Customer panel log.
8. **DND/TRAI note**: our flag + Sarvam list only; promotional outbound in India formally needs DLT/140 series. Keep min cart value and hours conservative.

- [ ] **Step 2: Update indexes/counts**: add row under `## whatsapp/` in `docs/README.md`; in `CRON_TOPOLOGY.md` add `voice-transcript-purge  20 3 * * *  purge_voice_transcripts()`; bump "51 Supabase Edge Functions" to 54 in `CLAUDE.md`, `AGENTS.md`, `docs/architecture/ARCHITECTURE.md`, and add `voice-call-start`, `voice-webhook`, `voice-tool-wa-link` to the roles list (`voice-webhook` under webhook receivers, the other two under send chokepoints/internal).

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md AGENTS.md
git commit -m "docs(voice): Sarvam voice agent setup guide, cron topology, counts"
```

---

## Deploy checklist (after all tasks; report committed vs deployed separately)

1. Paste `20260826200000_voice_cart_recovery.sql` in the Supabase SQL editor; run `bash scripts/check-migrations.sh`.
2. `supabase secrets set SARVAM_ORG_ID=... SARVAM_WORKSPACE_ID=... SARVAM_APP_ID=... SARVAM_APP_VERSION=... SARVAM_CONNECTION_ID=... SARVAM_AGENT_PHONE=...`
3. `supabase functions deploy voice-call-start voice-webhook voice-tool-wa-link wa-journey-tick shopify-wa wa-template-create`
4. Submit `cart_link_requested` to Meta; wait for approval.
5. `vercel --prod`.
6. Configure the Sarvam tool + variables + prompt per the setup doc.
7. Live test with the owner's number (spec §9), then toggle `voice_call_enabled` in Flows.
