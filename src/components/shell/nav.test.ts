import { describe, it, expect } from "vitest";
import { MAYA, NAV, SETTINGS, allItems, findActive, itemFor, navFor, parseHref, sectionTabs } from "./nav";
import { accessOf } from "@/lib/access";

const at = (p: string, tab: string | null = null, hash = "") => findActive(p, tab, hash);
const place = (p: string, tab: string | null = null, hash = "") => at(p, tab, hash)?.item.label ?? null;
const page = (p: string, tab: string | null = null, hash = "") => at(p, tab, hash)?.page?.label ?? null;

describe("shell nav", () => {
  it("parses tab and hash", () => {
    expect(parseHref("/dashboard/whatsapp?tab=kb")).toEqual({ path: "/dashboard/whatsapp", tab: "kb", hash: "" });
    expect(parseHref("/dashboard/settings#connections")).toEqual({ path: "/dashboard/settings", tab: null, hash: "#connections" });
  });

  it("has nine places in three groups, Ask Maya pinned and Settings in the footer", () => {
    expect(NAV.map((s) => s.title)).toEqual([null, "Grow", "Know"]);
    expect(NAV.flatMap((s) => s.items.map((it) => it.label))).toEqual([
      "Home",
      "Inbox",
      "Orders & COD",
      "Marketing",
      "Creators",
      "B2B & deals",
      "Customers",
      "Reputation",
      "Insights",
    ]);
    expect(NAV[1].items[0].children?.map((c) => c.label)).toEqual(["WhatsApp", "Email"]);
    expect(MAYA.href).toBe("/dashboard/assistant");
    expect(SETTINGS.href).toBe("/dashboard/settings");
  });

  it("matches home exactly and never as a prefix", () => {
    expect(place("/dashboard")).toBe("Home");
    expect(place("/dashboard/unknown")).toBeNull();
    expect(page("/dashboard/attention")).toBe("Needs you");
  });

  it("keeps WhatsApp highlighted on every marketing tab and campaign page", () => {
    for (const t of ["home", "campaigns", "flows", "templates", "analytics"]) {
      expect(place("/dashboard/whatsapp", t)).toBe("WhatsApp");
      expect(at("/dashboard/whatsapp", t)?.area).toBe("Marketing");
    }
    expect(place("/dashboard/whatsapp")).toBe("WhatsApp");
    expect(place("/dashboard/whatsapp/campaigns/new")).toBe("WhatsApp");
    expect(place("/dashboard/whatsapp/campaigns/abc")).toBe("WhatsApp");
  });

  it("sends the WhatsApp tabs that moved to their new places", () => {
    expect(place("/dashboard/whatsapp", "kb")).toBe("Inbox");
    expect(page("/dashboard/whatsapp", "kb")).toBe("Bot knowledge");
    expect(place("/dashboard/whatsapp", "voice")).toBe("Orders & COD");
    expect(place("/dashboard/whatsapp", "growth")).toBe("Customers");
  });

  it("resolves Inbox pages", () => {
    expect(page("/dashboard/inbox")).toBe("Live chats");
    expect(page("/dashboard/inbox/wa-123")).toBe("Live chats");
    expect(page("/dashboard/inbox/tickets")).toBe("Tickets");
    expect(page("/dashboard/inbox/email")).toBe("Email drafts");
  });

  it("follows the IA tab sets (04-ia.md)", () => {
    const owner = accessOf({ email: "boss@promunch.in", app_metadata: { role: "admin" } });
    const labels = (path: string, tab: string | null = null, hash = "") => sectionTabs(findActive(path, tab, hash), owner).map((p) => p.label);
    expect(labels("/dashboard/inbox/tickets")).toEqual(["Tickets", "Live chats", "Email drafts", "Bot knowledge"]);
    expect(labels("/dashboard/sales/orders")).toEqual(["Confirm COD", "Voice calls", "All orders", "Call rules"]);
    expect(page("/dashboard/sales/orders", "all")).toBe("All orders");
    expect(page("/dashboard/sales/orders", "rules")).toBe("Call rules");
    expect(labels("/dashboard/contacts")).toEqual(["Customers", "Segments", "Sign-up popup"]);
    expect(page("/dashboard/email/audiences")).toBe("Segments");
    expect(labels("/dashboard/settings", null, "#team")).toEqual(["My profile", "Connections", "Team & access", "API keys", "Brand & email", "Security"]);
    expect(page("/dashboard/settings", null, "#team")).toBe("Team & access");
    expect(page("/dashboard/settings")).toBe("Connections");
    expect(page("/dashboard/settings", null, "#profile")).toBe("My profile");
    expect(page("/dashboard/profile")).toBe("My profile");
  });

  it("prefers the longer path: orders belong to Orders, the rest of sales to Insights", () => {
    expect(place("/dashboard/sales/orders")).toBe("Orders & COD");
    expect(place("/dashboard/sales")).toBe("Insights");
    expect(page("/dashboard/sales/amazon")).toBe("Amazon");
    expect(place("/dashboard/contacts/abc")).toBe("Customers");
    expect(place("/dashboard/deals")).toBe("B2B & deals");
    expect(place("/dashboard/email/campaigns/abc")).toBe("Email");
    expect(place("/dashboard/analytics")).toBe("Email");
    expect(place("/dashboard/admin")).toBe("Settings");
  });

  it("keeps retired and palette-only pages resolvable", () => {
    expect(place("/dashboard/campaigns")).toBe("Email");
    expect(place("/dashboard/flows/abc")).toBe("Email");
    expect(place("/dashboard/settings", null, "#connections")).toBe("Settings");
    expect(at("/dashboard/campaigns")?.page).toBeNull();
    expect(place("/dashboard/flows")).toBe("Email");
  });

  it("lists Reputation in Know and keeps it highlighted on every tab and deep link", () => {
    expect(NAV[2].items.map((it) => it.label)).toEqual(["Customers", "Reputation", "Insights"]);
    expect(place("/dashboard/reputation")).toBe("Reputation");
    expect(place("/dashboard/reputation", "settings")).toBe("Reputation");
    expect(at("/dashboard/reputation", "overview")?.area).toBe("Reputation");
  });

  it("never lists Instagram while its backend is off, keeps WhatsApp jumps in the palette", () => {
    const hrefs = allItems().flatMap((it) => [it.href, ...(it.pages ?? []).map((p) => p.href), ...(it.palette ?? []).map((p) => p.href)]);
    expect(hrefs.some((h) => h.startsWith("/dashboard/instagram"))).toBe(false);
    for (const t of ["campaigns", "templates", "flows", "analytics"]) expect(hrefs).toContain(`/dashboard/whatsapp?tab=${t}`);
    expect(hrefs).toContain("/dashboard/whatsapp/campaigns/new");
  });

  it("shows section tabs only for places with two or more pages", () => {
    const owner = accessOf({ email: "boss@promunch.in", app_metadata: { role: "admin" } });
    expect(sectionTabs(at("/dashboard/sales/web"), owner).map((p) => p.label)).toEqual(["Sales", "Website", "Amazon"]);
    expect(sectionTabs(at("/dashboard/influencers"), owner)).toEqual([]);
    expect(sectionTabs(at("/dashboard/admin"), owner).map((p) => p.label)).toEqual(["My profile", "Connections", "Team & access", "API keys", "Brand & email", "Security"]);
    const agent = accessOf({ email: "a@promunch.in", app_metadata: { role: "agent" } });
    expect(sectionTabs(at("/dashboard/settings"), agent).map((p) => p.label)).toEqual(["My profile", "Connections", "Team & access", "Brand & email"]);
  });

  it("hides Call rules from members without WhatsApp marketing (its data lives there)", () => {
    const salesOnly = accessOf({ email: "o@promunch.in", app_metadata: { role: "agent", modules: ["sales"] } });
    expect(sectionTabs(at("/dashboard/sales/orders"), salesOnly).map((p) => p.label)).not.toContain("Call rules");
    const both = accessOf({ email: "o@promunch.in", app_metadata: { role: "agent", modules: ["sales", "wa_marketing"] } });
    expect(sectionTabs(at("/dashboard/sales/orders"), both).map((p) => p.label)).toContain("Call rules");
  });

  it("trims places to what a restricted member can open", () => {
    const marketer = accessOf({ email: "p@promunch.in", app_metadata: { role: "agent", modules: ["wa_marketing"] } });
    const nav = navFor(marketer);
    expect(nav.flatMap((s) => s.items.map((it) => it.label))).toEqual(["Marketing", "Customers"]);
    expect(nav[0].items[0].children?.map((c) => c.label)).toEqual(["WhatsApp"]);
    // Customers is only the sign-up popup for them, and it opens there.
    const customers = itemFor(marketer, NAV[2].items[0]);
    expect(customers?.href).toBe("/dashboard/whatsapp?tab=growth");
    expect(customers?.pages?.map((p) => p.label)).toEqual(["Sign-up popup"]);
    expect(itemFor(marketer, SETTINGS)).toBeNull();
    expect(navFor(null)).toEqual([]);
  });
});
