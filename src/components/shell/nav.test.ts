import { describe, it, expect } from "vitest";
import { findActive, hubHref, parseHref, NAV } from "./nav";

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
    expect(label("/dashboard/whatsapp")).toBe("Conversations");
    expect(label("/dashboard/whatsapp", "inbox")).toBe("Conversations");
    expect(label("/dashboard/whatsapp", "tickets")).toBe("Tickets");
    expect(label("/dashboard/whatsapp", "campaigns")).toBe("Campaigns");
    expect(label("/dashboard/whatsapp", "flows")).toBe("Automations");
    expect(label("/dashboard/whatsapp", "templates")).toBe("Templates");
    expect(label("/dashboard/whatsapp", "growth")).toBe("Sign-up popup");
    expect(label("/dashboard/whatsapp", "kb")).toBe("Bot knowledge");
    expect(findActive("/dashboard/whatsapp", "kb", "")?.hub).toBe("System");
  });

  it("uses prefix matches and hashes", () => {
    expect(label("/dashboard/contacts/abc")).toBe("Audience");
    expect(label("/dashboard/settings")).toBe("Settings");
    expect(label("/dashboard/settings", null, "#connections")).toBe("Health");
    expect(label("/dashboard/amazon")).toBe("Amazon");
    expect(findActive("/dashboard/amazon", null, "")?.hub).toBe("Sales");
  });

  it("hub links land inside their hub", () => {
    for (const h of NAV) {
      const p = parseHref(hubHref(h.hub));
      expect(findActive(p.path, p.tab, p.hash)?.hub).toBe(h.hub);
    }
  });
});
