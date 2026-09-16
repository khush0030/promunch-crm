import { describe, it, expect } from "vitest";
import { categoryWord, urgencyPill, ticketStatusWord } from "./labels";

describe("categoryWord", () => {
  it("maps customer_support to Support", () => {
    expect(categoryWord("customer_support")).toBe("Support");
  });

  it("maps order_tracking to Order status", () => {
    expect(categoryWord("order_tracking")).toBe("Order status");
  });

  it("maps complaint to Complaint", () => {
    expect(categoryWord("complaint")).toBe("Complaint");
  });

  it("maps partnership_inquiry to Partnership", () => {
    expect(categoryWord("partnership_inquiry")).toBe("Partnership");
  });

  it("maps wholesale to Wholesale", () => {
    expect(categoryWord("wholesale")).toBe("Wholesale");
  });

  it("maps job_application to Job application", () => {
    expect(categoryWord("job_application")).toBe("Job application");
  });

  it("maps spam to Spam", () => {
    expect(categoryWord("spam")).toBe("Spam");
  });

  it("maps general to General", () => {
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

  it("flags high as a warn Soon pill", () => {
    expect(urgencyPill("high")).toEqual({ tone: "warn", text: "Soon" });
  });

  it("returns null for medium", () => {
    expect(urgencyPill("medium")).toBeNull();
  });

  it("returns null for low", () => {
    expect(urgencyPill("low")).toBeNull();
  });

  it("returns null for null and unknown values", () => {
    expect(urgencyPill(null)).toBeNull();
    expect(urgencyPill("unknown")).toBeNull();
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
