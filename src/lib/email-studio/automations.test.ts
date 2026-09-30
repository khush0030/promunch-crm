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
