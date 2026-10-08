import { describe, expect, it } from "vitest";
import {
  buildJudgemeReplyRequest,
  claimConflictMessage,
  judgemeError,
  judgemeReviewId,
  prepareReplyText,
  replyExternalId,
} from "./judgeme-reply";

describe("Judge.me reply helpers", () => {
  it("review id comes from external_id", () => {
    expect(judgemeReviewId("123456")).toBe(123456);
    expect(judgemeReviewId(" 42 ")).toBe(42);
    expect([judgemeReviewId("abc"), judgemeReviewId("0"), judgemeReviewId(null), judgemeReviewId("12.5")]).toEqual([null, null, null, null]);
  });

  it("applies brand rules and checks length", () => {
    expect(prepareReplyText("Thanks from promunch — enjoy!")).toEqual({ ok: true, text: "Thanks from PROMUNCH, enjoy!" });
    expect(prepareReplyText("   ")).toMatchObject({ ok: false });
    expect(prepareReplyText(5)).toMatchObject({ ok: false });
    expect(prepareReplyText("a".repeat(2001))).toMatchObject({ ok: false });
  });

  it("builds the documented request (token in header, shop in query, no reviewer email)", () => {
    const r = buildJudgemeReplyRequest({ shop: "a1e4f4-2.myshopify.com", token: "tok", reviewId: 77, content: "Thank you!" });
    expect(r.url).toBe("https://api.judge.me/api/v1/replies?shop_domain=a1e4f4-2.myshopify.com");
    expect(r.init.method).toBe("POST");
    expect(r.init.headers["X-Api-Token"]).toBe("tok");
    expect(JSON.parse(r.init.body)).toEqual({ review_id: 77, send_reply_email: false, reply: { content: "Thank you!" } });
  });

  it("reads a reply id when Judge.me sends one", () => {
    expect(replyExternalId({ reply: { id: 9 } })).toBe("9");
    expect(replyExternalId({ id: "x1" })).toBe("x1");
    expect(replyExternalId({})).toBeNull();
    expect(replyExternalId(null)).toBeNull();
  });

  it("plain-English errors", () => {
    expect(judgemeError(401, null)).toMatch(/API token/);
    expect(judgemeError(422, { error: "Review not found" })).toBe("Judge.me did not post the reply (HTTP 422: Review not found).");
    expect(claimConflictMessage("posted")).toMatch(/already posted/);
    expect(claimConflictMessage("failed")).toMatch(/Try again/);
    expect(claimConflictMessage("claimed")).toMatch(/right now/);
  });
});
