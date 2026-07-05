// User-created WhatsApp flows (wa_custom_flows, built in the dashboard's
// Flows tab). A custom flow = Shopify trigger -> ordered steps, each
// (delay_hours, template, var mapping). Enrolment inserts wa_journey_runs
// rows with journey_key 'custom:<flow id>'; wa-journey-tick delivers them
// through the same claimed, template-approved send path as the built-ins.
//
// No-spam invariant (CLAUDE.md §0): enrolment takes an atomic claimSend per
// (flow, entity) before inserting any rows — a customer can never be enrolled
// in the same flow twice for the same order/checkout. Anything uncertain
// (missing table, bad steps) biases to NOT enrolling.

import { db } from "./supabase.ts";
import { claimSend, markSendSent } from "./confirmations.ts";

export type CustomFlowStep = {
  delay_hours: number;
  template: string;
  language?: string;
  vars?: Record<string, string>;
};

export type CustomFlow = {
  id: string;
  name: string;
  enabled: boolean;
  trigger_event: "order_placed" | "order_fulfilled" | "checkout_abandoned";
  steps: CustomFlowStep[];
};

export const CUSTOM_KEY_PREFIX = "custom:";

export async function loadCustomFlows(trigger?: string): Promise<CustomFlow[]> {
  try {
    let q = db().from("wa_custom_flows").select("*");
    if (trigger) q = q.eq("trigger_event", trigger);
    const { data } = await q;
    return (data ?? []).filter((f) => Array.isArray(f.steps)) as CustomFlow[];
  } catch {
    return []; // table not migrated yet / transient error — no custom flows
  }
}

// Replace {name} / {order_ref} / {checkout_url} tokens in a step's var values.
export function resolveVars(
  vars: Record<string, string> | undefined,
  ctx: { name: string; order_ref: string; checkout_url?: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    out[k] = String(v)
      .replaceAll("{name}", ctx.name)
      .replaceAll("{order_ref}", ctx.order_ref)
      .replaceAll("{checkout_url}", ctx.checkout_url ?? "");
  }
  return out;
}

// Enrol one customer into every ENABLED custom flow for this trigger.
// entityRef = order name (#1234) or checkout token — the dedup key.
export async function enrolCustomFlows(
  trigger: CustomFlow["trigger_event"],
  args: { waId: string; name: string; entityRef: string; checkoutUrl?: string },
): Promise<void> {
  const flows = await loadCustomFlows(trigger);
  if (!flows.length) return;
  const sb = db();
  for (const flow of flows) {
    if (!flow.enabled || !flow.steps.length) continue;
    // exactly-once per (flow, entity), same primitive the built-ins use
    const key = `customflow_${flow.id}:${args.entityRef}`;
    if (!(await claimSend(key))) continue;
    const rows = flow.steps
      .filter((s) => s && s.template && Number(s.delay_hours) >= 0)
      .map((s) => ({
        journey_key: `${CUSTOM_KEY_PREFIX}${flow.id}`,
        wa_id: args.waId,
        next_action_at: new Date(Date.now() + Number(s.delay_hours) * 3600_000).toISOString(),
        order_ref: args.entityRef,
        context: {
          custom_flow_id: flow.id,
          trigger,
          template: s.template,
          language: s.language ?? "en",
          vars: resolveVars(s.vars, {
            name: args.name,
            order_ref: args.entityRef,
            checkout_url: args.checkoutUrl,
          }),
        },
      }));
    if (rows.length) {
      const { error } = await sb.from("wa_journey_runs").insert(rows);
      if (error) continue; // claim stays unlocked-but-claimed; bias to silence
    }
    await markSendSent(key);
  }
}
