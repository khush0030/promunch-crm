import { describe, expect, it } from "vitest";
import {
  applyTitle, blanksNeedRenumber, buttonsForApi, draftFingerprint, draftFromRow, editableFooter, emptyDraft,
  guessBlankLabels, insertBlank, renumberBlanks, saveDraftBody, submitBody, uniqueName, type TemplateRowLike,
} from "./template-draft";
import { groupTemplates, matchesStatus, qualityInfo, statusInfo, videoPosterSrc } from "./template-display";

const row: TemplateRowLike = {
  id: "t1",
  name: "diwali_offer",
  language: "en",
  category: "marketing",
  status: "approved",
  body: "Hi {{1}}, your code is {{2}} today only.",
  footer: "Your Munchy Pal · Reply STOP to unsubscribe",
  header_type: "IMAGE",
  header_media_url: "https://x/y.jpg",
  buttons: [{ type: "URL", text: "Shop", url: "https://promunch.in/{{1}}", example: ["https://promunch.in/abc"] }],
  variables: [{ name: "1", sample: "Aarav" }, { name: "2", sample: "DIWALI", label: "Code" }],
  meta_template_id: "m1",
};

describe("draftFromRow", () => {
  it("opens a Meta template in edit mode, strips the auto STOP footer, keeps samples and labels", () => {
    const d = draftFromRow(row);
    expect(d.mode).toBe("edit");
    expect(d.id).toBe("t1");
    expect(d.footer).toBe("Your Munchy Pal");
    expect(d.bodySamples).toEqual({ "1": "Aarav", "2": "DIWALI" });
    expect(d.blankLabels).toEqual({ "1": "First name", "2": "Code" });
    expect(d.buttons[0]).toEqual({ type: "URL", text: "Shop", url: "https://promunch.in/{{1}}", example: "https://promunch.in/abc" });
  });

  it("duplicates as a new draft without an id", () => {
    const d = draftFromRow(row, "diwali_offer_v2");
    expect(d.mode).toBe("new");
    expect(d.id).toBeUndefined();
    expect(d.name).toBe("diwali_offer_v2");
  });

  it("opens a never-submitted row as a local draft", () => {
    expect(draftFromRow({ ...row, meta_template_id: null, status: "draft" }).mode).toBe("draft");
  });
});

describe("helpers", () => {
  it("editableFooter leaves utility footers alone", () => {
    expect(editableFooter("utility", "Reply STOP to unsubscribe")).toBe("Reply STOP to unsubscribe");
    expect(editableFooter("marketing", "Reply STOP to unsubscribe")).toBe("");
  });

  it("guessBlankLabels spots a greeting", () => {
    expect(guessBlankLabels("Hello {{1}}! Order {{2}} shipped.")).toEqual({ "1": "First name", "2": "Blank 2" });
  });

  it("insertBlank adds Hi before a first-name blank in an empty message", () => {
    expect(insertBlank("", 0, "first_name")).toEqual({ body: "Hi {{1}}, ", n: 1, cursor: 10 });
  });

  it("insertBlank numbers the next blank and pads with spaces", () => {
    const r = insertBlank("Hi {{1}}, try this now.", 18, "custom");
    expect(r.n).toBe(2);
    expect(r.body).toBe("Hi {{1}}, try this {{2}} now.");
  });

  it("renumberBlanks closes gaps and carries samples and labels", () => {
    const r = renumberBlanks("Hi {{1}}, see {{3}} today.", { "1": "A", "3": "C" }, { "3": "Product" });
    expect(r.body).toBe("Hi {{1}}, see {{2}} today.");
    expect(r.samples).toEqual({ "1": "A", "2": "C" });
    expect(r.labels).toEqual({ "2": "Product" });
    expect(blanksNeedRenumber("Hi {{1}}, see {{3}}.")).toBe(true);
    expect(blanksNeedRenumber("Hi {{1}}, see {{2}}.")).toBe(false);
  });

  it("uniqueName and applyTitle build a free Meta name", () => {
    expect(uniqueName("diwali", ["diwali"])).toBe("diwali_v2");
    const d = applyTitle(emptyDraft(), "Diwali Offer!", ["diwali_offer"]);
    expect(d.name).toBe("diwali_offer_v2");
    expect(applyTitle({ ...d, nameTouched: true }, "Other", []).name).toBe("diwali_offer_v2");
  });

  it("buttonsForApi drops the example on fixed links", () => {
    expect(buttonsForApi([{ type: "URL", text: " Shop ", url: "https://promunch.in", example: "x" }])).toEqual([
      { type: "URL", text: "Shop", url: "https://promunch.in" },
    ]);
  });

  it("request bodies carry samples in order", () => {
    const d = draftFromRow(row);
    expect(submitBody(d)).toMatchObject({ mode: "edit", body_samples: ["Aarav", "DIWALI"], header_format: "IMAGE", header_media_url: "https://x/y.jpg" });
    expect(saveDraftBody(d).variables).toEqual([{ name: "1", sample: "Aarav", label: "First name" }, { name: "2", sample: "DIWALI", label: "Code" }]);
  });

  it("draftFingerprint ignores upload details", () => {
    const d = emptyDraft();
    expect(draftFingerprint(d)).toBe(draftFingerprint({ ...d, header_media: { mime: "image/png", size: 3 } }));
  });
});

describe("display", () => {
  it("statusInfo speaks plain English", () => {
    expect(statusInfo("pending").label).toBe("Waiting for Meta");
    expect(statusInfo("rejected").label).toBe("Needs changes");
    expect(statusInfo("disabled").label).toBe("Paused by Meta");
    expect(matchesStatus("paused", "disabled")).toBe(true);
    expect(qualityInfo("green")?.tone).toBe("good");
    expect(qualityInfo(null)).toBeNull();
  });

  it("groupTemplates splits campaigns, automatic messages and team alerts", () => {
    const g = groupTemplates([
      { name: "edamame_launch", category: "marketing" },
      { name: "shipping_update", category: "utility" },
      { name: "review_ask", category: "utility" },
      { name: "ops_ticket_alert", category: "utility" },
    ]);
    expect(g.marketing.map((t) => t.name)).toEqual(["edamame_launch"]);
    expect(g.customer_service.map((t) => t.name)).toEqual(["review_ask"]);
    expect(g.internal.map((t) => t.name)).toEqual(["shipping_update", "ops_ticket_alert"]);
  });

  it("videoPosterSrc seeks to the first frame", () => {
    expect(videoPosterSrc("https://x/v.mp4")).toBe("https://x/v.mp4#t=0.1");
    expect(videoPosterSrc("https://x/v.mp4#t=2")).toBe("https://x/v.mp4#t=2");
  });
});
