import { describe, expect, it } from "vitest";
import {
  type DraftMessage,
  bestUnit, blankKeys, fillBody, fillSample, flowTemplateOptions, friendlyDuration, fromUnit, gapsError,
  gapsToOffsets, missingBlanks, normalizeTestNumber, offsetsToGaps, RECIPES, stepsPayload, toUnit, tokensFor,
} from "./logic";

describe("durations", () => {
  it("picks a friendly unit", () => {
    expect(bestUnit(48)).toBe("days");
    expect(bestUnit(6)).toBe("hours");
    expect(bestUnit(0.5, ["minutes", "hours"])).toBe("minutes");
    expect(bestUnit(36)).toBe("hours");
  });
  it("round-trips units", () => {
    expect(toUnit(72, "days")).toBe(3);
    expect(fromUnit(3, "days")).toBe(72);
    expect(fromUnit(30, "minutes")).toBe(0.5);
  });
  it("reads durations in plain words", () => {
    expect(friendlyDuration(0)).toBe("right away");
    expect(friendlyDuration(0.25)).toBe("15 minutes");
    expect(friendlyDuration(1)).toBe("1 hour");
    expect(friendlyDuration(6)).toBe("6 hours");
    expect(friendlyDuration(24)).toBe("1 day");
    expect(friendlyDuration(120)).toBe("5 days");
  });
});

describe("custom flow waits", () => {
  it("converts between waits-after-previous and offsets-from-trigger", () => {
    expect(offsetsToGaps([24, 72, 96])).toEqual([24, 48, 24]);
    expect(gapsToOffsets([24, 48, 24])).toEqual([24, 72, 96]);
  });
  it("rejects a zero wait after the first message and too-long flows", () => {
    expect(gapsError([0, 24])).toBeNull();
    expect(gapsError([24, 0])).toMatch(/Message 2/);
    expect(gapsError([24 * 91])).toMatch(/90 days/);
  });
});

describe("blanks", () => {
  it("finds numbered blanks once, in order", () => {
    expect(blankKeys("Hi {{1}}, try {{2}}. Bye {{1}}")).toEqual(["1", "2"]);
    expect(blankKeys(null)).toEqual([]);
  });
  it("fills bodies and sample tokens", () => {
    expect(fillBody("Hi {{1}} {{2}}", { "1": "Priya" })).toBe("Hi Priya [Blank 2]");
    expect(fillSample("Hey {name}, order {order_ref}")).toBe("Hey Priya, order #1234");
  });
  it("only offers the cart link for cart automations", () => {
    expect(tokensFor("checkout_abandoned").map((t) => t.token)).toContain("{checkout_url}");
    expect(tokensFor("order_placed").map((t) => t.token)).not.toContain("{checkout_url}");
    expect(tokensFor("checkout_abandoned").map((t) => t.token)).not.toContain("{order_ref}");
  });
  it("lists empty blanks and builds the engine payload", () => {
    const bodies: Record<string, string> = { promo: "Hi {{1}}, {{2}}" };
    const msgs: DraftMessage[] = [
      { gapHours: 24, template: "promo", language: "en", vars: { "1": "{name}", "2": "" } },
      { gapHours: 48, template: "promo", language: "en", vars: { "1": "{name}", "2": " new flavour ", "9": "x" } },
    ];
    expect(missingBlanks(msgs, (n) => bodies[n])).toEqual(["Message 1, blank 2"]);
    const steps = stepsPayload(msgs, (n) => bodies[n], () => "en_US");
    expect(steps.map((x) => x.delay_hours)).toEqual([24, 72]);
    expect(steps[1].vars).toEqual({ "1": "{name}", "2": "new flavour" });
    expect(steps[0].language).toBe("en_US");
  });
});

describe("templates for automations", () => {
  it("offers only approved marketing templates", () => {
    const rows = [
      { name: "diwali_offer", language: "en", status: "approved", category: "marketing" },
      { name: "diwali_offer_2", language: "en", status: "pending", category: "marketing" },
      { name: "order_confirmation_v2", language: "en", status: "approved", category: "utility" },
      { name: "delivery_help", language: "en", status: "approved", category: "utility" },
    ];
    expect(flowTemplateOptions(rows).map((r) => r.name)).toEqual(["diwali_offer"]);
  });
});

describe("recipes", () => {
  it("maps every recipe to a supported trigger, a built-in, or coming soon", () => {
    const kinds = Object.fromEntries(RECIPES.map((r) => [r.key, r.availability.kind]));
    expect(kinds).toEqual({
      welcome: "soon", abandoned_cart: "builtin", review: "builtin", restock: "builtin", winback: "soon", cross_sell: "custom",
    });
  });
  it("has no em dashes in recipe copy", () => {
    expect(JSON.stringify(RECIPES)).not.toContain("\u2014");
  });
});

describe("normalizeTestNumber", () => {
  it("adds the India code to a bare mobile", () => {
    expect(normalizeTestNumber("98765 43210")).toBe("919876543210");
    expect(normalizeTestNumber("+91 98765-43210")).toBe("919876543210");
    expect(normalizeTestNumber("12345")).toBeNull();
  });
});
