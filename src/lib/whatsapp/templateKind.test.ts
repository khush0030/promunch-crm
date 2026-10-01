import { describe, expect, it } from "vitest";
import { friendlyTemplateName, renderBlanks, templateKind } from "./templateKind";
import { GLOSSARY, GLOSSARY_KEYS } from "@/components/guide/glossary";

describe("templateKind", () => {
  it.each([
    "ops_ticket_alert",
    "order_cancel_ops",
    "hello_world",
    "order_confirmation",
    "order_confirmation_returning",
    "order_confirmation_v3",
    "order_verify_cod",
    "shipping_update",
    "shipping_update_v2",
    "cart_link_requested",
    "OPS_Daily",
  ])("%s is internal regardless of category", (name) => {
    expect(templateKind({ name, category: "MARKETING" })).toBe("internal");
    expect(templateKind({ name, category: "UTILITY" })).toBe("internal");
  });

  it("utility templates that are not internal are customer service", () => {
    expect(templateKind({ name: "review_request", category: "UTILITY" })).toBe("customer_service");
    expect(templateKind({ name: "otp_login", category: "authentication" })).toBe("customer_service");
  });

  it("marketing and offer categories are marketing", () => {
    expect(templateKind({ name: "edamame_launch", category: "MARKETING" })).toBe("marketing");
    expect(templateKind({ name: "diwali_sale", category: "marketing" })).toBe("marketing");
    expect(templateKind({ name: "flash_deal", category: "offer" })).toBe("marketing");
  });

  it("unknown or missing category falls back to marketing (stricter rules)", () => {
    expect(templateKind({ name: "mystery" })).toBe("marketing");
    expect(templateKind({ name: "mystery", category: null })).toBe("marketing");
  });

  it("does not treat look-alike names as internal", () => {
    expect(templateKind({ name: "shipping_update_promo", category: "MARKETING" })).toBe("marketing");
    expect(templateKind({ name: "hello_world_sale", category: "MARKETING" })).toBe("marketing");
  });
});

describe("friendlyTemplateName", () => {
  it("humanises snake case", () => {
    expect(friendlyTemplateName("abandoned_cart_reminder")).toBe("Abandoned cart reminder");
  });
  it("turns a trailing _vN into (version N)", () => {
    expect(friendlyTemplateName("edamame_launch_v2")).toBe("Edamame launch (version 2)");
    expect(friendlyTemplateName("promo_V10")).toBe("Promo (version 10)");
  });
  it("keeps PROMUNCH in caps", () => {
    expect(friendlyTemplateName("welcome_to_promunch")).toBe("Welcome to PROMUNCH");
  });
  it("handles odd input", () => {
    expect(friendlyTemplateName("")).toBe("");
    expect(friendlyTemplateName("  restock__alert ")).toBe("Restock alert");
  });
});

describe("renderBlanks", () => {
  it("splits text and numbered blanks with labels", () => {
    expect(renderBlanks("Hi {{1}}, your order {{2}} is ready.", { "1": "First name" })).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "chip", key: "1", label: "First name", raw: "{{1}}" },
      { kind: "text", text: ", your order " },
      { kind: "chip", key: "2", label: "Blank 2", raw: "{{2}}" },
      { kind: "text", text: " is ready." },
    ]);
  });
  it("supports named blanks and spaces inside braces", () => {
    expect(renderBlanks("{{ first_name }}!")).toEqual([
      { kind: "chip", key: "first_name", label: "First name", raw: "{{ first_name }}" },
      { kind: "text", text: "!" },
    ]);
  });
  it("returns one text segment when there are no blanks, none for empty", () => {
    expect(renderBlanks("Plain text")).toEqual([{ kind: "text", text: "Plain text" }]);
    expect(renderBlanks("")).toEqual([]);
  });
  it("leaves malformed braces as text", () => {
    expect(renderBlanks("{{}} and {1}")).toEqual([{ kind: "text", text: "{{}} and {1}" }]);
  });
});

describe("GLOSSARY copy", () => {
  it("has the required keys", () => {
    for (const k of [
      "template", "marketing", "utility", "approval", "opted_in", "window_24h", "marketing_cap", "held_back",
      "daily_budget", "meta_tier", "quiet_hours", "fair_use", "automation", "trigger", "wait", "blank_variable",
      "stop_footer", "rfm_segment", "warm_audience", "engaged_audience", "delivered", "read", "reply", "click",
      "attributed_order", "test_send", "header_media", "quality_rating", "retarget",
    ]) {
      expect(GLOSSARY_KEYS).toContain(k);
    }
  });
  it.each(GLOSSARY_KEYS)("%s has a term and plain text, no em dashes, PROMUNCH in caps", (k) => {
    const g = GLOSSARY[k];
    expect(g.term.trim()).not.toBe("");
    expect(g.plain.trim()).not.toBe("");
    const all = [g.term, g.plain, g.customerEffect ?? ""].join(" ");
    expect(all).not.toMatch(/—/);
    for (const brand of all.match(/promunch/gi) ?? []) expect(brand).toBe("PROMUNCH");
  });
});

describe("isAutomationTemplate", () => {
  it("flags cart, review and restock templates, including versions", async () => {
    const { isAutomationTemplate } = await import("./templateKind");
    for (const n of ["abandoned_cart_reminder", "abandoned_cart_recovery", "abandoned_checkout", "review_request", "replenishment_reminder_v2"]) {
      expect(isAutomationTemplate(n)).toBe(true);
    }
    for (const n of ["edamame_launch", "promunch_image_update_v1", "festive_offer"]) {
      expect(isAutomationTemplate(n)).toBe(false);
    }
  });
});
