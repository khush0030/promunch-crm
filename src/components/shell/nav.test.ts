import { describe, it, expect } from "vitest";
import { findActive, hubHref, hubPreview, parseHref, visibleItems, NAV } from "./nav";

const label = (p: string, tab: string | null = null, hash = "") => findActive(p, tab, hash)?.item.label ?? null;

describe("shell nav", () => {
  it("parses tab and hash", () => {
    expect(parseHref("/dashboard/whatsapp?tab=kb")).toEqual({ path: "/dashboard/whatsapp", tab: "kb", hash: "" });
    expect(parseHref("/dashboard/settings#connections")).toEqual({ path: "/dashboard/settings", tab: null, hash: "#connections" });
  });

  it("matches home exactly and never as a prefix", () => {
    expect(label("/dashboard")).toBe("Home");
    expect(label("/dashboard/unknown")).toBeNull();
  });

  it("keeps the one WhatsApp marketing entry highlighted on every marketing tab", () => {
    for (const t of ["home", "campaigns", "flows", "templates", "growth", "analytics"]) {
      expect(label("/dashboard/whatsapp", t)).toBe("WhatsApp marketing");
    }
    expect(label("/dashboard/whatsapp/campaigns/new")).toBe("WhatsApp marketing");
    expect(label("/dashboard/whatsapp/campaigns/abc")).toBe("WhatsApp marketing");
    expect(findActive("/dashboard/whatsapp/campaigns/abc", null, "")?.hub).toBe("Marketing");
    expect(label("/dashboard/whatsapp", "kb")).toBe("Bot knowledge");
    expect(findActive("/dashboard/whatsapp", "kb", "")?.hub).toBe("System");
  });

  it("resolves the Inbox hub", () => {
    expect(label("/dashboard/inbox")).toBe("Conversations");
    expect(label("/dashboard/inbox/wa-123")).toBe("Conversations");
    expect(label("/dashboard/inbox/tickets")).toBe("Tickets");
    expect(label("/dashboard/inbox/email")).toBe("Email drafts");
    expect(findActive("/dashboard/inbox/wa-123", null, "")?.hub).toBe("Inbox");
  });

  it("uses prefix matches and hashes", () => {
    expect(label("/dashboard/contacts/abc")).toBe("Audience");
    expect(label("/dashboard/settings")).toBe("Settings");
    expect(label("/dashboard/settings", null, "#connections")).toBe("Health");
    expect(label("/dashboard/sales/amazon")).toBe("Amazon");
    expect(findActive("/dashboard/sales/amazon", null, "")?.hub).toBe("Sales");
  });

  it("keeps legacy email pages resolvable but out of the sidebar", () => {
    expect(label("/dashboard/campaigns")).toBe("Legacy email campaigns");
    expect(label("/dashboard/flows/abc")).toBe("Legacy email automations");
    expect(findActive("/dashboard/campaigns", null, "")?.hub).toBe("Marketing");
    const marketing = NAV.find((h) => h.hub === "Marketing")!;
    expect(visibleItems(marketing).map((it) => it.label)).toEqual(["WhatsApp marketing", "Email Studio", "Audience", "Reputation"]);
    // Partners is down to 2 while Creators (Instagram) is hidden; restore it
    // to the >= 3 rule when Creators comes back.
    for (const h of NAV) {
      expect(visibleItems(h).length).toBeGreaterThanOrEqual(h.hub === "Partners" ? 2 : 3);
    }
  });

  it("hides Instagram until its backend is live", () => {
    const partners = NAV.find((h) => h.hub === "Partners")!;
    expect(partners.items.map((it) => it.label)).toEqual(["B2B leads", "Deals", "Influencers"]);
    expect(NAV.flatMap((h) => h.items).some((it) => it.href.startsWith("/dashboard/instagram"))).toBe(false);
  });

  it("previews the first few visible items of a hub", () => {
    const marketing = NAV.find((h) => h.hub === "Marketing")!;
    expect(hubPreview(marketing)).toEqual({ names: ["WhatsApp marketing", "Email Studio", "Audience"], more: 1 });
    const today = NAV.find((h) => h.hub === "Today")!;
    expect(hubPreview(today).more).toBe(0);
  });

  it("keeps WhatsApp pages findable in the command palette", () => {
    const hrefs = NAV.flatMap((h) => h.items).map((it) => it.href);
    for (const t of ["campaigns", "templates", "flows", "analytics", "growth"]) {
      expect(hrefs).toContain(`/dashboard/whatsapp?tab=${t}`);
    }
    expect(hrefs).toContain("/dashboard/whatsapp/campaigns/new");
  });

  it("hub links land inside their hub", () => {
    for (const h of NAV) {
      const p = parseHref(hubHref(h.hub));
      expect(findActive(p.path, p.tab, p.hash)?.hub).toBe(h.hub);
    }
  });
});
