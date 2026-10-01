import { it, expect } from "vitest";
import { FLOW_TEMPLATES } from "../email/flow-templates";
import { flowIssues, sanitizeFlow, type EditableFlow } from "./automations";

// Every shipped flow template must survive an Email Studio editor save
// unchanged in meaning and pass its copy + wiring checks, or an admin could
// not save or switch it on (and a save would strip engine fields).
it("all flow templates pass the automation editor checks", () => {
  const issues: string[] = [];
  for (const t of FLOW_TEMPLATES) {
    const f = sanitizeFlow({ name: t.name, description: t.description, trigger_type: t.trigger_type, trigger_config: t.trigger_config, steps: t.steps });
    if (typeof f === "string") { issues.push(`${t.key}: ${f}`); continue; }
    for (const i of flowIssues(f as EditableFlow)) issues.push(`${t.key} ${i.level}: ${i.message}`);
    expect((f as EditableFlow).steps.map((s) => s.coupon ?? null)).toEqual(t.steps.map((s) => s.coupon ? expect.objectContaining({ percent_off: s.coupon.percent_off }) : null));
    expect((f as EditableFlow).steps.map((s) => s.skip_if_wa_journey ?? null)).toEqual(t.steps.map((s) => s.skip_if_wa_journey ?? null));
  }
  expect(issues).toEqual([]);
});
