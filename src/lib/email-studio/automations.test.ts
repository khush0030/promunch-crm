import { describe, expect, it } from "vitest";
import { delayLabel, describeFlowRules } from "./automations";

describe("delayLabel", () => {
  it("reads minutes, hours and days", () => {
    expect(delayLabel(0)).toBe("right away");
    expect(delayLabel(0.25)).toBe("15 min");
    expect(delayLabel(1.75)).toBe("1.8 h");
    expect(delayLabel(16)).toBe("16 h");
    expect(delayLabel(168)).toBe("7 days");
    expect(delayLabel(600)).toBe("25 days");
  });
});

describe("describeFlowRules", () => {
  it("spells out the order flow filters", () => {
    expect(describeFlowRules("order_placed", { first_order_only: true })).toEqual(["Order placed", "First order only"]);
    expect(describeFlowRules("order_placed", { once_per_contact_days: 60 })).toContain("At most once every 60 days per person");
    expect(describeFlowRules("order_placed", { exit_on_reorder: true })).toContain("Stops if they order again");
  });
  it("adds the cart stop rules", () => {
    expect(describeFlowRules("checkout_abandoned", { deadline_hours: 30 })).toEqual([
      "Checkout started but not paid",
      "Stops after 30 h",
      "Stops when they buy",
    ]);
  });
});

import { splitDelay, joinDelay, sanitizeFlow, flowIssues, bodyText, type EditableFlow } from "./automations";

describe("delay units", () => {
  it("shows the friendliest unit and round-trips", () => {
    expect(splitDelay(0.25)).toEqual({ value: 15, unit: "minutes" });
    expect(splitDelay(600)).toEqual({ value: 25, unit: "days" });
    expect(splitDelay(1.75)).toEqual({ value: 1.75, unit: "hours" });
    expect(splitDelay(30)).toEqual({ value: 30, unit: "hours" });
    expect(joinDelay(15, "minutes")).toBe(0.25);
    expect(joinDelay(7, "days")).toBe(168);
    expect(joinDelay(-3, "hours")).toBe(0);
  });
});

describe("sanitizeFlow", () => {
  const base = { name: "X", trigger_type: "order_placed", steps: [{ delay_hours: 1, subject: "Hi", body_html: "<p>Hi</p>" }] };
  it("keeps only known config keys and cleans them", () => {
    const f = sanitizeFlow({ ...base, trigger_config: { first_order_only: true, exit_on_reorder: false, once_per_contact_days: "60", evil: 1, coupon_code: " save10 " } });
    expect(typeof f).toBe("object");
    expect((f as EditableFlow).trigger_config).toEqual({ first_order_only: true, once_per_contact_days: 60, coupon_code: "SAVE10" });
  });
  it("rejects bad input", () => {
    expect(sanitizeFlow({ ...base, name: " " })).toMatch(/name/);
    expect(sanitizeFlow({ ...base, trigger_type: "nope" })).toMatch(/trigger/);
    expect(sanitizeFlow({ ...base, steps: [{ delay_hours: -1, subject: "a", body_html: "b" }] })).toMatch(/wait/);
  });
});

describe("flowIssues", () => {
  const flow = (over: Partial<EditableFlow["steps"][number]> = {}, trigger = "order_placed"): EditableFlow => ({
    name: "X", description: "", trigger_type: trigger, trigger_config: {},
    steps: [{ type: "email", delay_hours: 1, subject: "Hi {{first_name}}", preview_text: "p", body_html: "<p>Hello from PROMUNCH</p>", ...over }],
  });
  const blocks = (f: EditableFlow) => flowIssues(f).filter((i) => i.level === "block").map((i) => i.message);
  it("passes clean copy", () => expect(blocks(flow())).toEqual([]));
  it("blocks em dashes, lowercase brand and unfilled tags", () => {
    expect(blocks(flow({ body_html: "<p>Snacks — good</p>" })).join()).toMatch(/dash/);
    expect(blocks(flow({ body_html: "<p>Love promunch</p>" })).join()).toMatch(/PROMUNCH/);
    expect(blocks(flow({ body_html: '<a href="{{checkout_url}}">Go</a>' })).join()).toMatch(/checkout_url/);
    expect(blocks(flow({ body_html: '<a href="{{checkout_url}}">Go</a>' }, "checkout_abandoned"))).toEqual([]);
  });
  it("needs a coupon when the copy uses one", () => {
    expect(blocks(flow({ body_html: "<p>Use {{coupon_code}}</p>" })).join()).toMatch(/coupon/);
    expect(blocks(flow({ body_html: "<p>Use {{coupon_code}}</p>", coupon_code: "X10" }))).toEqual([]);
  });
  it("ignores URLs when reading body text", () => {
    expect(bodyText('<a href="https://promunch.in/x">Shop</a>')).toBe("Shop");
  });
});
