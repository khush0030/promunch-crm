import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/secrets", () => ({ getSecret: async () => null }));

import { companyDomain, cleanCopy, fallbackOpener, firstName, parseBulkInquiry, questionsFor } from "./schema";
import { renderBulkInquiryEmail } from "./email";
import { acceptOpenerSentence, buildOpener } from "./opener";
import { bulkFormScript } from "./embed-script";

const valid = {
  submissionKey: "abc12345def",
  name: "  riya sharma ",
  company: "Navan India",
  email: "Riya@Navan.com",
  phone: "+91 98765 43210",
  city: "Bengaluru",
  useCase: "gifting",
  quantityBand: "100-500",
  products: ["edamame", "hampers", "bogus"],
  neededBy: "2026-10-28",
  notes: "Diwali gifting, ~200 people",
};

describe("parseBulkInquiry", () => {
  it("normalises a valid submission", () => {
    const r = parseBulkInquiry(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email).toBe("riya@navan.com");
    expect(r.value.name).toBe("riya sharma");
    expect(r.value.phone).toBe("+919876543210");
    expect(r.value.products).toEqual(["edamame", "hampers"]);
    expect(r.value.neededBy).toBe("2026-10-28");
  });

  it("prefixes 91 to a bare 10-digit Indian number", () => {
    const r = parseBulkInquiry({ ...valid, phone: "9876543210" });
    expect(r.ok && r.value.phone).toBe("+919876543210");
  });

  it("reports every missing required field", () => {
    const r = parseBulkInquiry({ submissionKey: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(
      ["city", "company", "email", "name", "phone", "quantityBand", "submissionKey", "useCase"].sort(),
    );
  });

  it("rejects an unknown use case and a bad date", () => {
    const r = parseBulkInquiry({ ...valid, useCase: "spam", neededBy: "next week" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.useCase).toBeTruthy();
    expect(r.errors.neededBy).toBeTruthy();
  });
});

describe("questions + copy helpers", () => {
  it("asks quantity first when it is unknown", () => {
    expect(questionsFor("gifting", true)[0]).toBe("Rough quantity (units or hampers)");
    expect(questionsFor("gifting", true)).toHaveLength(6);
    expect(questionsFor("other", true)).toHaveLength(5);
  });

  it("asks 2 type questions then the 3 common ones", () => {
    const q = questionsFor("gifting");
    expect(q).toHaveLength(5);
    expect(q[0]).toMatch(/branding/i);
    expect(q.slice(2)).toEqual(["Budget per unit, if you have one", "Delivery pincode", "GSTIN, if you need a GST invoice"]);
  });

  it("cleans dashes and brand casing", () => {
    expect(cleanCopy("Love it — promunch fans")).toBe("Love it, PROMUNCH fans");
  });

  it("names and domains", () => {
    expect(firstName("riya sharma")).toBe("Riya");
    expect(companyDomain("a@navan.com")).toBe("navan.com");
    expect(companyDomain("a@gmail.com")).toBeNull();
  });

  it("fallback opener has no em dash and ends with the pricing line", () => {
    for (const uc of ["gifting", "pantry", "events", "resale", "other"] as const) {
      const s = fallbackOpener(uc, "Navan");
      expect(s).not.toMatch(/[—–]/);
      expect(s).toMatch(/Here is what we need to send you pricing\.$/);
    }
  });
});

describe("acceptOpenerSentence", () => {
  it("accepts a short warm line", () => {
    expect(acceptOpenerSentence("Diwali gifting for the Navan team, love it.")).toBe("Diwali gifting for the Navan team, love it.");
  });
  it("rejects product facts, numbers, questions and over-long lines", () => {
    expect(acceptOpenerSentence("Our snacks pack 42g of protein.")).toBeNull();
    expect(acceptOpenerSentence("We offer free delivery for your team.")).toBeNull();
    expect(acceptOpenerSentence("Shall we talk about your order today?")).toBeNull();
    expect(acceptOpenerSentence("word ".repeat(30))).toBeNull();
    expect(acceptOpenerSentence(null)).toBeNull();
  });
  it("falls back when no API key is configured", async () => {
    const r = await buildOpener({ useCase: "pantry", company: "Navan", city: "Pune", notes: null, quantityBand: "unsure" });
    expect(r.source).toBe("fallback");
  });
});

describe("renderBulkInquiryEmail", () => {
  const parsed = parseBulkInquiry(valid);
  if (!parsed.ok) throw new Error("fixture invalid");
  const mail = renderBulkInquiryEmail({
    inquiry: parsed.value,
    refNo: 1042,
    opener: "Diwali gifting for the Navan team, love it. Here is what we need to send you pricing.",
    whatsappDisplay: "+91 99813 10247",
  });

  it("uses the gifting subject and greets by first name", () => {
    expect(mail.subject).toBe("Your PROMUNCH gifting quote");
    expect(mail.html).toContain("Thanks, Riya. Your quote is on its way.");
  });
  it("shows the recap tags, all five questions and the reply/WhatsApp CTAs", () => {
    expect(mail.html).toContain("100 to 500 units");
    expect(mail.html).toContain("By 28 Oct");
    for (const q of questionsFor("gifting")) expect(mail.html).toContain(q);
    expect(mail.html).toContain("mailto:hello@promunch.in");
    expect(mail.html).toContain("https://wa.me/919981310247");
    expect(mail.html).toContain("B-1042");
  });
  it("never contains em dashes or an AI label", () => {
    expect(mail.html + mail.text).not.toMatch(/—/);
    expect(mail.html.toLowerCase()).not.toContain("ai-written");
  });
  it("escapes user-supplied text", () => {
    const evil = renderBulkInquiryEmail({
      inquiry: { ...parsed.value, name: "<script>x</script>", city: "<b>Pune</b>" },
      refNo: 1, opener: "Hi.", whatsappDisplay: "+91 1",
    });
    expect(evil.html).not.toContain("<script>x");
    expect(evil.html).not.toContain("<b>Pune</b>");
  });
});

describe("bulkFormScript", () => {
  const js = bulkFormScript("https://crm.example/api/public/bulk-inquiry");
  it("is valid JavaScript with the API url injected", () => {
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain("https://crm.example/api/public/bulk-inquiry");
  });
  it("has no em dashes in customer copy", () => {
    expect(js).not.toMatch(/—/);
  });
});
