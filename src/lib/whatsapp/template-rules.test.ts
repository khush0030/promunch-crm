import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FOOTER_MAX,
  STOP_NOTICE,
  TEMPLATE_LANGUAGES,
  checkVariables,
  finalFooter,
  issuesFor,
  nextVersionName,
  samplesArray,
  slugifyTemplateName,
  validateMediaFile,
  validateTemplate,
  type TemplateDraft,
} from "./template-rules";

const good: TemplateDraft = {
  name: "diwali_offer_2026",
  language: "en",
  category: "marketing",
  body: "Hi {{1}}, your Diwali box is waiting. Use code {{2}} at checkout today.",
  body_samples: { "1": "Aarav", "2": "DIWALI10" },
  footer: "Your Munchy Pal",
  buttons: [{ type: "URL", text: "Shop now", url: "https://promunch.in/collections/all" }],
};

const errs = (d: TemplateDraft) => validateTemplate(d).errors;
const fields = (d: TemplateDraft) => errs(d).map((e) => e.field);

describe("twin file", () => {
  it("edge _shared/template-rules.ts is byte-identical to template-rules-core.ts", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const a = readFileSync(`${here}template-rules-core.ts`, "utf8");
    const b = readFileSync(`${here}../../../promunch-email-agent/supabase/functions/_shared/template-rules.ts`, "utf8");
    expect(b).toBe(a);
  });
});

describe("validateTemplate: happy path", () => {
  it("accepts a well formed marketing template", () => {
    expect(validateTemplate(good)).toEqual({ errors: [], warnings: [] });
  });
  it("accepts array samples as well as keyed samples", () => {
    expect(errs({ ...good, body_samples: ["Aarav", "DIWALI10"] })).toEqual([]);
  });
});

describe("name", () => {
  it.each(["Diwali", "diwali-offer", "diwali offer", "", "diwali!"])("rejects %j", (name) => {
    expect(fields({ ...good, name })).toContain("name");
  });
  it("accepts lowercase, digits, underscores", () => {
    expect(fields({ ...good, name: "a_1_b" })).not.toContain("name");
  });
  it("rejects > 512 chars", () => {
    expect(fields({ ...good, name: "a".repeat(513) })).toContain("name");
  });
});

describe("language + category", () => {
  it("requires a curated language", () => {
    expect(fields({ ...good, language: "english" })).toContain("language");
    expect(fields({ ...good, language: "" })).toContain("language");
  });
  it("includes the required Indian languages", () => {
    const codes = TEMPLATE_LANGUAGES.map((l) => l.code);
    for (const c of ["en", "en_US", "en_GB", "hi", "mr", "gu", "ta", "te", "kn", "ml", "bn", "pa"]) expect(codes).toContain(c);
    expect(TEMPLATE_LANGUAGES.every((l) => l.label.length > 0)).toBe(true);
  });
  it("blocks authentication", () => {
    expect(fields({ ...good, category: "authentication" })).toContain("category");
  });
  it("warns when a utility template sounds promotional", () => {
    const r = validateTemplate({ ...good, category: "utility", body: "Hi {{1}}, get 20% off on your next order with code {{2}} today." });
    expect(issuesFor(r.warnings, "category")).toHaveLength(1);
  });
  it("does not warn for a plain utility update", () => {
    const r = validateTemplate({ ...good, category: "utility", footer: "", buttons: [], body: "Hi {{1}}, your order {{2}} has shipped and is on its way." });
    expect(issuesFor(r.warnings, "category")).toHaveLength(0);
  });
});

describe("placeholders", () => {
  it("flags gaps", () => {
    const e = errs({ ...good, body: "Hi {{1}}, your code is {{3}} for today only.", body_samples: { 1: "A", 3: "B" } });
    expect(e.some((i) => i.field === "body" && /Missing: \{\{2\}\}/.test(i.message))).toBe(true);
  });
  it("flags {{0}}", () => {
    expect(checkVariables("Hi {{0}} there friend", "body", "message").length).toBeGreaterThan(0);
  });
  it("flags a placeholder at the start", () => {
    const e = errs({ ...good, body: "{{1}}, your Diwali box is waiting with code {{2}} today.", body_samples: ["a", "b"] });
    expect(e.some((i) => /cannot start/.test(i.message))).toBe(true);
  });
  it("flags a placeholder at the end", () => {
    const e = errs({ ...good, body: "Hi {{1}}, your Diwali box is waiting. Use code {{2}}", body_samples: ["a", "b"] });
    expect(e.some((i) => /cannot end/.test(i.message))).toBe(true);
  });
  it("allows punctuation after the last placeholder", () => {
    const e = errs({ ...good, body: "Hi {{1}}, your Diwali box is waiting. Use code {{2}}.", body_samples: ["a", "b"] });
    expect(e.some((i) => /cannot end/.test(i.message))).toBe(false);
  });
  it("flags adjacent placeholders", () => {
    const e = errs({ ...good, body: "Hi there {{1}} {{2}} your Diwali box is waiting for you.", body_samples: ["a", "b"] });
    expect(e.some((i) => /right next to each other/.test(i.message))).toBe(true);
  });
  it("flags malformed placeholders", () => {
    const e = errs({ ...good, body: "Hi {{name}}, your Diwali box is waiting for you today." });
    expect(e.some((i) => /not a valid placeholder/.test(i.message))).toBe(true);
    const e2 = errs({ ...good, body: "Hi { {1} }, your box is waiting for you today." });
    expect(e2.some((i) => i.field === "body")).toBe(true);
    const e3 = errs({ ...good, body: "Hi {{ 1 }}, your box is waiting for you today." });
    expect(e3.some((i) => /Remove the spaces/.test(i.fix ?? ""))).toBe(true);
  });
  it("errors when there are too many placeholders for the text", () => {
    const e = errs({ ...good, body: "Hi {{1}} and {{2}} ok {{3}} yes.", body_samples: ["a", "b", "c"] });
    expect(e.some((i) => /too many placeholders/.test(i.message))).toBe(true);
  });
  it("warns when placeholder density is borderline", () => {
    const r = validateTemplate({ ...good, body: "Hi {{1}}, code {{2}} works now.", body_samples: ["a", "b"] });
    expect(r.errors.some((i) => /too many placeholders/.test(i.message))).toBe(false);
    expect(issuesFor(r.warnings, "body").length).toBeGreaterThan(0);
  });
  it("requires a sample for every body placeholder", () => {
    expect(fields({ ...good, body_samples: { "1": "Aarav" } })).toContain("body_samples");
    expect(fields({ ...good, body_samples: { "1": "Aarav", "2": "  " } })).toContain("body_samples");
  });
  it("warns about newlines in samples", () => {
    const r = validateTemplate({ ...good, body_samples: { "1": "Aa\nrav", "2": "X" } });
    expect(issuesFor(r.warnings, "body_samples")).toHaveLength(1);
  });
});

describe("body", () => {
  it("requires a body", () => {
    expect(fields({ ...good, body: " " })).toContain("body");
  });
  it("limits to 1024 chars", () => {
    expect(fields({ ...good, body: "word ".repeat(210), body_samples: {} })).toContain("body");
  });
  it("warns on em dashes and lowercase brand", () => {
    const r = validateTemplate({ ...good, body: "Hi {{1}} — promunch has code {{2}} for you today." });
    expect(r.warnings.some((w) => /long dash/.test(w.message))).toBe(true);
    expect(r.warnings.some((w) => /PROMUNCH/.test(w.message))).toBe(true);
  });
  it("does not flag promunch.in links as a brand issue", () => {
    const r = validateTemplate({ ...good, body: "Hi {{1}}, visit https://promunch.in to use code {{2}} today." });
    expect(r.warnings.some((w) => /capitals/.test(w.message))).toBe(false);
  });
});

describe("header", () => {
  const h = (header_text: string, header_samples?: Record<string, string>) =>
    errs({ ...good, header_type: "TEXT", header_text, header_samples });
  it("text header: no emoji", () => {
    expect(h("A new launch \u{1F331}").some((i) => /emoji/.test(i.message))).toBe(true);
  });
  it("text header: no newline", () => {
    expect(h("A new\nlaunch").some((i) => /line breaks/.test(i.message))).toBe(true);
  });
  it("text header: max 60", () => {
    expect(h("x".repeat(61)).some((i) => i.field === "header")).toBe(true);
  });
  it("text header: max one variable, needs sample", () => {
    expect(h("Hi {{1}} and {{2}} ok", { 1: "a", 2: "b" }).some((i) => /at most 1/.test(i.message))).toBe(true);
    expect(h("Hello {{1}} friend").some((i) => i.field === "header_samples")).toBe(true);
    expect(h("Hello {{1}} friend", { "1": "Aarav" })).toEqual([]);
  });
  it("media header requires an uploaded file", () => {
    expect(fields({ ...good, header_type: "IMAGE", header_media_url: null })).toContain("header");
    expect(fields({ ...good, header_type: "IMAGE", header_media_url: "https://x.supabase.co/a.png" })).not.toContain("header");
  });
  it("checks picked media size/type", () => {
    const e = errs({ ...good, header_type: "IMAGE", header_media_url: "https://x/a.png", header_media: { mime: "image/png", size: 6 * 1024 * 1024 } });
    expect(e.some((i) => i.field === "header" && /limit/.test(i.message))).toBe(true);
  });
});

describe("footer + STOP", () => {
  it("adds the STOP notice to marketing footers", () => {
    expect(finalFooter("marketing", "Your Munchy Pal")).toBe(`Your Munchy Pal · ${STOP_NOTICE}`);
    expect(finalFooter("offer", "")).toBe(STOP_NOTICE);
    expect(finalFooter("MARKETING", null)).toBe(STOP_NOTICE);
  });
  it("leaves utility footers alone", () => {
    expect(finalFooter("utility", "Your Munchy Pal")).toBe("Your Munchy Pal");
    expect(finalFooter("utility", "  ")).toBeNull();
    expect(finalFooter("UTILITY", "")).toBeNull();
  });
  it("detects STOP only as a whole uppercase word", () => {
    expect(finalFooter("marketing", "Reply STOP to opt out")).toBe("Reply STOP to opt out");
    expect(finalFooter("marketing", "Non-stop munching")).toBe(`Non-stop munching · ${STOP_NOTICE}`);
    expect(finalFooter("marketing", "STOPWATCH deals")).toBe(`STOPWATCH deals · ${STOP_NOTICE}`);
  });
  it("never truncates: too long is an error instead", () => {
    const footer = "PROMUNCH snacks for every mood and moment";
    const ff = finalFooter("marketing", footer)!;
    expect(ff.length).toBeGreaterThan(FOOTER_MAX);
    expect(ff.endsWith(STOP_NOTICE)).toBe(true);
    const e = errs({ ...good, footer });
    expect(e.some((i) => i.field === "footer" && /Shorten your footer to 32/.test(i.fix ?? ""))).toBe(true);
  });
  it("utility footer over 60 is an error", () => {
    expect(fields({ ...good, category: "utility", footer: "x".repeat(61) })).toContain("footer");
  });
  it("footer: no emoji, no variables", () => {
    expect(fields({ ...good, footer: "Munch on \u{1F49A}" })).toContain("footer");
    expect(fields({ ...good, footer: "Hi {{1}}" })).toContain("footer");
  });
});

describe("buttons", () => {
  const withButtons = (buttons: TemplateDraft["buttons"]) => errs({ ...good, buttons });
  it("url must be https", () => {
    expect(withButtons([{ type: "URL", text: "Shop", url: "http://promunch.in" }]).some((i) => /https/.test(i.message))).toBe(true);
    expect(withButtons([{ type: "URL", text: "Shop", url: "promunch" }]).some((i) => /valid web address/.test(i.message))).toBe(true);
    expect(withButtons([{ type: "URL", text: "Shop", url: "" }]).length).toBeGreaterThan(0);
  });
  it("dynamic url: {{1}} only at the end, needs a matching example", () => {
    expect(withButtons([{ type: "URL", text: "Shop", url: "https://promunch.in/{{1}}/x" }]).some((i) => /very end/.test(i.message))).toBe(true);
    expect(withButtons([{ type: "URL", text: "Shop", url: "https://promunch.in/{{2}}", example: "https://promunch.in/a" }]).some((i) => /very end/.test(i.message))).toBe(true);
    expect(withButtons([{ type: "URL", text: "Shop", url: "https://promunch.in/{{1}}" }]).some((i) => /example of a full link/.test(i.message))).toBe(true);
    expect(withButtons([{ type: "URL", text: "Shop", url: "https://promunch.in/{{1}}", example: "https://other.com/a" }]).some((i) => /must start with/.test(i.message))).toBe(true);
    expect(withButtons([{ type: "URL", text: "Shop", url: "https://promunch.in/{{1}}", example: "https://promunch.in/cart/abc" }])).toEqual([]);
    expect(withButtons([{ type: "URL", text: "Shop", url: "https://promunch.in/{{1}}", example: ["https://promunch.in/cart/abc"] }])).toEqual([]);
  });
  it("max 2 url, 1 phone, 10 total", () => {
    const u = (t: string) => ({ type: "URL", text: t, url: "https://promunch.in" });
    expect(withButtons([u("a"), u("b"), u("c")]).some((i) => /2 link/.test(i.message))).toBe(true);
    const p = (t: string) => ({ type: "PHONE_NUMBER", text: t, phone_number: "+919876543210" });
    expect(withButtons([p("a"), p("b")]).some((i) => /1 call/.test(i.message))).toBe(true);
    const q = (t: string) => ({ type: "QUICK_REPLY", text: t });
    expect(withButtons(Array.from({ length: 11 }, (_, i) => q(`q${i}`))).some((i) => /at most 10/.test(i.message))).toBe(true);
    expect(withButtons(Array.from({ length: 10 }, (_, i) => q(`q${i}`)))).toEqual([]);
  });
  it("phone must be E.164", () => {
    expect(withButtons([{ type: "PHONE_NUMBER", text: "Call", phone_number: "9876543210" }]).length).toBe(1);
    expect(withButtons([{ type: "PHONE_NUMBER", text: "Call", phone_number: "+91 98765 43210" }])).toEqual([]);
  });
  it("labels: required, <=25, no emoji, unique", () => {
    expect(withButtons([{ type: "QUICK_REPLY", text: "" }]).length).toBe(1);
    expect(withButtons([{ type: "QUICK_REPLY", text: "x".repeat(26) }]).length).toBe(1);
    expect(withButtons([{ type: "QUICK_REPLY", text: "Yes \u{1F44D}" }]).some((i) => /emoji/.test(i.message))).toBe(true);
    expect(withButtons([{ type: "QUICK_REPLY", text: "Yes" }, { type: "QUICK_REPLY", text: "yes" }]).some((i) => /both labelled/.test(i.message))).toBe(true);
  });
  it("quick replies must be grouped", () => {
    const e = withButtons([
      { type: "QUICK_REPLY", text: "A" },
      { type: "URL", text: "B", url: "https://promunch.in" },
      { type: "QUICK_REPLY", text: "C" },
    ]);
    expect(e.some((i) => /next to each other/.test(i.message))).toBe(true);
    expect(withButtons([
      { type: "QUICK_REPLY", text: "A" },
      { type: "QUICK_REPLY", text: "C" },
      { type: "URL", text: "B", url: "https://promunch.in" },
    ])).toEqual([]);
  });
  it("issuesFor matches button sub-fields", () => {
    const e = withButtons([{ type: "QUICK_REPLY", text: "" }]);
    expect(issuesFor(e, "buttons")).toHaveLength(1);
    expect(issuesFor(e, "buttons.0")).toHaveLength(1);
  });
});

describe("media files", () => {
  it("accepts in-limit files", () => {
    expect(validateMediaFile("image", { type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateMediaFile("video", { type: "video/3gpp", size: 1000 })).toBeNull();
    expect(validateMediaFile("document", { type: "application/pdf", size: 99 * 1024 * 1024 })).toBeNull();
  });
  it("rejects wrong type / too big / empty", () => {
    expect(validateMediaFile("image", { type: "image/gif", size: 10 })).toMatch(/JPG or PNG/);
    expect(validateMediaFile("image", { type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/limit is 5\.0 MB/);
    expect(validateMediaFile("video", { type: "video/mp4", size: 17 * 1024 * 1024 })).toMatch(/limit is 16 MB/);
    expect(validateMediaFile("document", { type: "application/pdf", size: 0 })).toMatch(/empty/);
  });
});

describe("helpers", () => {
  it("slugifies friendly titles", () => {
    expect(slugifyTemplateName("Diwali Offer 2026!")).toBe("diwali_offer_2026");
    expect(slugifyTemplateName("  Café -- Launch  ")).toBe("cafe_launch");
  });
  it("finds the next free version name", () => {
    expect(nextVersionName("diwali", [])).toBe("diwali_v2");
    expect(nextVersionName("diwali", ["diwali_v2", "diwali_v3"])).toBe("diwali_v4");
    expect(nextVersionName("diwali_v2", ["diwali_v3"])).toBe("diwali_v4");
  });
  it("orders samples by variable number", () => {
    expect(samplesArray("a {{2}} b {{1}}", { "1": "x", "2": "y" })).toEqual(["x", "y"]);
    expect(samplesArray("no vars", { "1": "x" })).toEqual([]);
  });
});
