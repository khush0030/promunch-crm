import { describe, it, expect } from "vitest";
import { categoryWord, urgencyPill, ticketStatusWord } from "./labels";

describe("categoryWord", () => {
  it("maps known lead categories to their business word", () => {
    expect(categoryWord("wholesale")).toBe("Wholesale");
    expect(categoryWord("customer_support")).toBe("Support");
    expect(categoryWord("order_tracking")).toBe("Order Tracking");
    expect(categoryWord("complaint")).toBe("Complaint");
    expect(categoryWord("partnership_inquiry")).toBe("Partnership");
    expect(categoryWord("job_application")).toBe("Job");
    expect(categoryWord("spam")).toBe("Spam");
    expect(categoryWord("general")).toBe("General");
  });

  it("falls back to General for unknown or null categories", () => {
    expect(categoryWord("x")).toBe("General");
    expect(categoryWord(null)).toBe("General");
  });
});

describe("urgencyPill", () => {
  it("flags critical as an urgent crit pill", () => {
    expect(urgencyPill("critical")).toEqual({ tone: "crit", text: "Urgent" });
  });

  it("flags high as an urgent warn pill", () => {
    expect(urgencyPill("high")).toEqual({ tone: "warn", text: "Urgent" });
  });

  it("returns null for low, medium, and null", () => {
    expect(urgencyPill("low")).toBeNull();
    expect(urgencyPill("medium")).toBeNull();
    expect(urgencyPill(null)).toBeNull();
  });
});

describe("ticketStatusWord", () => {
  const teamName = (email: string) => email.split("@")[0];

  it("open with an assignee names who has it", () => {
    expect(ticketStatusWord("open", "narendra@trypromunch.in", teamName)).toBe("With narendra");
  });

  it("pending with an assignee names who has it", () => {
    expect(ticketStatusWord("pending", "khush@trypromunch.in", teamName)).toBe("With khush");
  });

  it("open without an assignee is New", () => {
    expect(ticketStatusWord("open", null, teamName)).toBe("New");
  });

  it("pending without an assignee is waiting on the customer", () => {
    expect(ticketStatusWord("pending", null, teamName)).toBe("Waiting on customer");
  });

  it("resolved or closed is Resolved regardless of assignee", () => {
    expect(ticketStatusWord("resolved", null, teamName)).toBe("Resolved");
    expect(ticketStatusWord("closed", "khush@trypromunch.in", teamName)).toBe("Resolved");
  });

  it("anything else is blank", () => {
    expect(ticketStatusWord(null, null, teamName)).toBe("");
    expect(ticketStatusWord("snoozed", null, teamName)).toBe("");
  });
});
