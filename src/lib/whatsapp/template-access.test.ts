import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_OWNER_ONLY, TEAM_ALERTS_LOCKED, automaticEditWarning, automaticUse, canChangeTemplate, templateChangeRefusal,
} from "./template-access";

const utility = { name: "delivery_update_v2", category: "utility" };
const marketing = { name: "diwali_offer", category: "marketing" };
const internal = { name: "ops_ticket_alert", category: "utility" };

describe("canChangeTemplate", () => {
  it("marketing: anyone; automatic: admins; team alerts: nobody", () => {
    expect(canChangeTemplate("marketing", false)).toBe(true);
    expect(canChangeTemplate("customer_service", false)).toBe(false);
    expect(canChangeTemplate("customer_service", true)).toBe(true);
    expect(canChangeTemplate("internal", true)).toBe(false);
  });
});

describe("templateChangeRefusal (server gate)", () => {
  it("lets anyone change marketing templates", () => {
    expect(templateChangeRefusal([marketing], false)).toBeNull();
  });
  it("refuses automatic templates to non-admins with the owner message", () => {
    expect(templateChangeRefusal([utility], false)).toBe(AUTOMATIC_OWNER_ONLY);
    expect(templateChangeRefusal([utility], true)).toBeNull();
  });
  it("refuses team alerts to everyone", () => {
    expect(templateChangeRefusal([internal], true)).toBe(TEAM_ALERTS_LOCKED);
  });
  it("the stored row wins over an incoming body claiming marketing", () => {
    expect(templateChangeRefusal([utility, { name: utility.name, category: "marketing" }], false)).toBe(AUTOMATIC_OWNER_ONLY);
  });
  it("an incoming category change to utility needs an admin too", () => {
    expect(templateChangeRefusal([marketing, { name: marketing.name, category: "utility" }], false)).toBe(AUTOMATIC_OWNER_ONLY);
  });
  it("ignores a missing row", () => {
    expect(templateChangeRefusal([null, marketing], false)).toBeNull();
  });
});

describe("automaticUse", () => {
  const custom = [
    { name: "Delivered thanks", enabled: true, steps: [{ template: "delivery_update_v2" }] },
    { name: "Other", enabled: true, steps: [{ template: "x" }] },
  ];
  it("finds the order confirmation slots from Flows settings", () => {
    const settings = { confirmation_template_first: "welcome_order", confirmation_template_repeat: "welcome_back" };
    expect(automaticUse("welcome_order", settings, []).confirmation).toBe("first");
    expect(automaticUse("welcome_back", settings, []).confirmation).toBe("repeat");
    expect(automaticUse("delivery_update_v2", settings, custom)).toEqual({ confirmation: null, flows: ["Delivered thanks"] });
  });
  it("defaults the first-order slot to order_confirmation_v2 and an empty repeat to none", () => {
    expect(automaticUse("order_confirmation_v2", null, null).confirmation).toBe("first");
    expect(automaticUse("", { confirmation_template_repeat: "" }, []).confirmation).toBeNull();
  });
});

describe("automaticEditWarning", () => {
  it("order confirmation edit: strong warning and type-the-name", () => {
    const w = automaticEditWarning("welcome_order", { confirmation: "first", flows: [] }, "edit");
    expect(w.tone).toBe("danger");
    expect(w.confirmName).toBe("welcome_order");
    expect(w.lines.join(" ")).toMatch(/order_confirmation_v2/);
  });
  it("returning-customer confirmation edit: strong warning, falls back to first-order copy", () => {
    const w = automaticEditWarning("welcome_back", { confirmation: "repeat", flows: [] }, "edit");
    expect(w.confirmName).toBe("welcome_back");
    expect(w.lines.join(" ")).toMatch(/first-order confirmation/);
  });
  it("other automatic edit: warning without typing, names the flows", () => {
    const w = automaticEditWarning("delivery_update_v2", { confirmation: null, flows: ["Delivered thanks"] }, "edit");
    expect(w.tone).toBe("warn");
    expect(w.confirmName).toBeNull();
    expect(w.lines).toContain("Used by: Delivered thanks.");
  });
  it("unknown usage (Flows unreadable): assume the worst", () => {
    const w = automaticEditWarning("delivery_update_v2", { confirmation: null, flows: [] }, "edit", false);
    expect(w.confirmName).toBe("delivery_update_v2");
  });
  it("duplicate: informational, live message untouched", () => {
    const w = automaticEditWarning("welcome_order", { confirmation: "first", flows: [] }, "copy");
    expect(w.tone).toBe("info");
    expect(w.confirmName).toBeNull();
  });
  it("copy has no em dashes", () => {
    for (const mode of ["edit", "copy"] as const) {
      for (const confirmation of ["first", "repeat", null] as const) {
        const w = automaticEditWarning("n", { confirmation, flows: [] }, mode);
        expect(`${w.title} ${w.lines.join(" ")}`).not.toMatch(/—/);
      }
    }
  });
});
