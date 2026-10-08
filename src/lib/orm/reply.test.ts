import { describe, expect, it } from "vitest";
import { buildReplyUserPrompt, capLength, cleanReply, REPLY_MAX_CHARS, REPLY_SYSTEM_PROMPT } from "./reply";

describe("cleanReply brand rules", () => {
  it("PROMUNCH in capitals, but never inside emails or domains", () => {
    expect(cleanReply("Thanks for trying Promunch! Email hello@promunch.in or visit promunch.in.")).toBe(
      "Thanks for trying PROMUNCH! Email hello@promunch.in or visit promunch.in.",
    );
    expect(cleanReply("pro munch and Pro-Munch")).toBe("PROMUNCH and PROMUNCH");
    expect(cleanReply("see https://www.promunch.in/pages/x")).toBe("see https://www.promunch.in/pages/x");
  });
  it("em and en dashes become commas, ranges become 'to'", () => {
    expect(cleanReply("So sorry — that should not happen – please DM us")).toBe(
      "So sorry, that should not happen, please DM us",
    );
    expect(cleanReply("Delivery takes 3–5 days")).toBe("Delivery takes 3 to 5 days");
    expect(cleanReply("Great—thanks")).toBe("Great, thanks");
    expect(cleanReply("Loved it -- thanks")).toBe("Loved it, thanks");
    expect(cleanReply("high-protein snack")).toBe("high-protein snack");
  });
  it("strips wrapping quotes and tidies punctuation", () => {
    expect(cleanReply('"Thank you so much!"')).toBe("Thank you so much!");
    expect(cleanReply("Thanks , we will check —.")).toBe("Thanks, we will check.");
  });
  it(`caps at ${REPLY_MAX_CHARS} characters on a sentence end`, () => {
    const long = "We are really sorry about this. ".repeat(30);
    const out = cleanReply(long);
    expect(out.length).toBeLessThanOrEqual(REPLY_MAX_CHARS);
    expect(out.endsWith(".")).toBe(true);
  });
  it("capLength falls back to a word boundary", () => {
    expect(capLength("aaaa bbbb cccc dddd", 12)).toBe("aaaa bbbb.");
    expect(capLength("short", 12)).toBe("short");
  });
});

describe("prompt", () => {
  it("system prompt carries every brand rule", () => {
    for (const s of ["PROMUNCH", "em dashes", "medical", "hello@promunch.in", "Never argue", String(REPLY_MAX_CHARS)]) {
      expect(REPLY_SYSTEM_PROMPT).toContain(s);
    }
    expect(REPLY_SYSTEM_PROMPT).not.toMatch(/[—–]/);
  });
  it("user prompt has the platform tone, the post and the KB", () => {
    const u = buildReplyUserPrompt(
      {
        source: "reddit",
        author_name: null,
        author_handle: "u/snacker",
        title: "Anyone tried PROMUNCH?",
        body: "Is the edamame actually crunchy?",
        rating: null,
        summary: null,
        intent: "question",
        product: "Roasted Edamame",
        is_owned: false,
      },
      "## Products\nRoasted Edamame",
    );
    expect(u).toContain("Reddit comment");
    expect(u).toContain("u/snacker");
    expect(u).toContain("TYPE: question");
    expect(u).toContain("Is the edamame actually crunchy?");
    expect(u).toContain("## Products");
    expect(u).not.toContain("RATING");
  });
});
