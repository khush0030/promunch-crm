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

  it("resolves WhatsApp tabs", () => {
    expect(label("/dashboard/whatsapp", "campaigns")).toBe("WhatsApp campaigns");
    expect(label("/dashboard/whatsapp", "flows")).toBe("WhatsApp automations");
    expect(label("/dashboard/whatsapp", "templates")).toBe("WhatsApp templates");
    expect(label("/dashboard/whatsapp", "growth")).toBe("WhatsApp popup");
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
    expect(visibleItems(marketing).map((it) => it.label)).toEqual([
      "WhatsApp campaigns", "WhatsApp automations", "Email (Brevo)", "Audience", "WhatsApp templates", "WhatsApp popup",
    ]);
    for (const h of NAV) expect(visibleItems(h).length).toBeGreaterThanOrEqual(3);
  });

  it("previews the first few visible items of a hub", () => {
    const marketing = NAV.find((h) => h.hub === "Marketing")!;
    expect(hubPreview(marketing)).toEqual({ names: ["WhatsApp campaigns", "WhatsApp automations", "Email (Brevo)"], more: 3 });
    const today = NAV.find((h) => h.hub === "Today")!;
    expect(hubPreview(today).more).toBe(0);
  });

  it("hub links land inside their hub", () => {
    for (const h of NAV) {
      const p = parseHref(hubHref(h.hub));
      expect(findActive(p.path, p.tab, p.hash)?.hub).toBe(h.hub);
    }
  });
});
