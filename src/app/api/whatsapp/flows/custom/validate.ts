// Shared validation for user-defined WhatsApp flows (create + update).

export const TRIGGERS = ["order_placed", "order_fulfilled", "checkout_abandoned"] as const;
export type TriggerEvent = (typeof TRIGGERS)[number];

export type CustomFlowStep = {
  delay_hours: number;
  template: string;
  language: string;
  vars: Record<string, string>;
};

export type CustomFlowInput = {
  name: string;
  enabled: boolean;
  trigger_event: TriggerEvent;
  steps: CustomFlowStep[];
};

const MAX_STEPS = 5;
const MAX_DELAY_HOURS = 24 * 90; // 90 days

export function validateCustomFlow(body: unknown):
  | { flow: CustomFlowInput }
  | { error: string } {
  if (!body || typeof body !== "object") return { error: "bad json" };
  const b = body as Record<string, unknown>;

  const name = String(b.name ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "name must be 2–80 characters" };

  const trigger = String(b.trigger_event ?? "");
  if (!TRIGGERS.includes(trigger as TriggerEvent)) {
    return { error: `trigger_event must be one of: ${TRIGGERS.join(", ")}` };
  }

  if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > MAX_STEPS) {
    return { error: `steps must be an array of 1–${MAX_STEPS} messages` };
  }
  const steps: CustomFlowStep[] = [];
  let prevDelay = -1;
  for (const [i, raw] of (b.steps as unknown[]).entries()) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const delay = Number(s.delay_hours);
    if (!Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_HOURS) {
      return { error: `step ${i + 1}: delay must be 0–${MAX_DELAY_HOURS} hours` };
    }
    if (delay <= prevDelay) {
      return { error: `step ${i + 1}: each step must come after the previous one (delays are measured from the trigger)` };
    }
    prevDelay = delay;
    const template = String(s.template ?? "").trim();
    if (!/^[a-z0-9_]{1,512}$/.test(template)) return { error: `step ${i + 1}: pick a template` };
    const language = String(s.language ?? "en").trim() || "en";
    const varsIn = (s.vars && typeof s.vars === "object" ? s.vars : {}) as Record<string, unknown>;
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(varsIn)) {
      if (!/^\d{1,2}$/.test(k)) continue;
      const val = String(v ?? "").trim();
      if (val.length > 500) return { error: `step ${i + 1}: variable {{${k}}} value too long` };
      vars[k] = val;
    }
    steps.push({ delay_hours: delay, template, language, vars });
  }

  return {
    flow: {
      name,
      enabled: b.enabled === undefined ? true : Boolean(b.enabled),
      trigger_event: trigger as TriggerEvent,
      steps,
    },
  };
}
