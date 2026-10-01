// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FLOW_TEMPLATES } from "../email/flow-templates";
import { flowIssues, sanitizeFlow, type EditableFlow } from "./automations";
import { SECTION_KINDS, loadCanvas, safeHref, sectionKindsFor, sections, serialize, whenLabel } from "./visual-edit";

function canvas(html: string) {
  const root = document.createElement("div");
  const n = loadCanvas(root, html);
  return { root, n };
}
/** The browser's own normal form of an HTML string (what a no-op edit returns). */
function normal(html: string) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.innerHTML;
}
const tags = (s: string) => (s.match(/\{\{\s*[a-z_.]+\s*\}\}/g) ?? []).sort();

describe("visual editor canvas", () => {
  const all = FLOW_TEMPLATES.flatMap((t) => t.steps.map((st, i) => ({ id: `${t.key} ${i + 1}`, html: st.body_html })));

  it("covers all 25 approved emails", () => expect(all).toHaveLength(25));

  it.each(all)("$id: opening and saving without edits changes nothing", ({ html }) => {
    const { root, n } = canvas(html);
    expect(n).toBeGreaterThan(0); // something is editable
    const out = serialize(root);
    expect(out).toBe(normal(html));
    expect(out).not.toMatch(/contenteditable|data-pm-/);
    expect(tags(out)).toEqual(tags(html));
  });

  it("turns text tags into locked chips and keeps attribute tags", () => {
    const { root } = canvas('<p style="x">Hi {{first_name}}, <a href="{{review_url}}">rate it</a></p>{{reorder_card}}');
    const chips = root.querySelectorAll("[data-pm-tag]");
    expect([...chips].map((c) => c.getAttribute("data-pm-tag"))).toEqual(["first_name", "reorder_card"]);
    expect(chips[0].getAttribute("contenteditable")).toBe("false");
    expect(chips[1].tagName).toBe("DIV");
    expect(root.querySelector("a")!.getAttribute("href")).toBe("{{review_url}}");
    expect(root.querySelector("p")!.getAttribute("contenteditable")).toBe("true");
    expect(sections(root)).toHaveLength(2);
  });

  it("an edit to text comes back with tags intact", () => {
    const { root } = canvas('<p style="margin:0">Hi {{first_name}}, old words.</p>');
    const p = root.querySelector("p")!;
    p.lastChild!.textContent = ", new words.";
    expect(serialize(root)).toBe('<p style="margin:0">Hi {{first_name}}, new words.</p>');
  });

  it("never makes layout tables editable as a whole", () => {
    const { root } = canvas(SECTION_KINDS.find((k) => k.key === "products")!.html());
    expect(root.querySelector("table[contenteditable]")).toBeNull();
    expect(root.querySelectorAll("[data-pm-edit]").length).toBeGreaterThan(0);
  });

  it("every ready-made section round-trips and passes the copy checks", () => {
    for (const k of SECTION_KINDS) {
      const html = k.html();
      const { root } = canvas(html);
      expect(serialize(root)).toBe(normal(html));
      const flow = sanitizeFlow({ name: "x", trigger_type: k.triggers?.[0] ?? "order_placed", steps: [{ delay_hours: 1, subject: "Hi", preview_text: "p", body_html: html + "<p>Hello from PROMUNCH</p>", coupon: { percent_off: 15 } }] }) as EditableFlow;
      expect(flowIssues(flow).filter((i) => i.level === "block").map((i) => i.message), k.key).toEqual([]);
    }
  });

  it("offers personalised sections only where they get filled", () => {
    expect(sectionKindsFor("checkout_abandoned").map((k) => k.key)).toContain("cart");
    expect(sectionKindsFor("checkout_abandoned").map((k) => k.key)).not.toContain("reorder");
    expect(sectionKindsFor("order_placed").map((k) => k.key)).toContain("reorder");
  });
});

describe("helpers", () => {
  it("safeHref allows https and tags only", () => {
    expect(safeHref(" https://promunch.in/x ")).toBe("https://promunch.in/x");
    expect(safeHref("{{reorder_url}}")).toBe("{{reorder_url}}");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("http://x.com")).toBeNull();
    expect(safeHref("promunch.in")).toBeNull();
  });
  it("whenLabel reads like a sentence", () => {
    expect(whenLabel("checkout_abandoned", 0, 0.75)).toBe("45 min after they leave checkout");
    expect(whenLabel("order_placed", 0, 600)).toBe("25 days after they order");
    expect(whenLabel("order_placed", 1, 168)).toBe("7 days after the email above");
    expect(whenLabel("segment_entry", 0, 0)).toBe("Right after they qualify");
  });
});
