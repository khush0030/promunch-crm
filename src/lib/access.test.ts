import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  accessOf,
  apiRule,
  canCallApi,
  canOpenHref,
  canOpenPage,
  landingFor,
  pageModule,
  MODULE_KEYS,
  NO_ACCESS_PATH,
  PROFILE_PATH,
  ROLE_PRESETS,
  presetForModules,
  rolePreset,
} from "./access";
import { OWNER_EMAIL } from "./rbac";
import { NAV, SETTINGS, itemFor, navFor } from "@/components/shell/nav";

const marketer = accessOf({
  email: "priya@promunch.in",
  app_metadata: { role: "agent", modules: ["wa_marketing", "email_marketing"] },
});

describe("accessOf", () => {
  it("admins and the owner get every area regardless of a stored list", () => {
    const a = accessOf({ email: "x@promunch.in", app_metadata: { role: "admin", modules: [] } });
    expect(a).toEqual({ admin: true, restricted: false, modules: MODULE_KEYS });
    expect(accessOf({ email: OWNER_EMAIL, app_metadata: { role: "agent", modules: [] } }).restricted).toBe(false);
  });
  it("members with no stored list keep every area (pre-existing behaviour)", () => {
    expect(accessOf({ email: "a@promunch.in", app_metadata: { role: "agent" } }).restricted).toBe(false);
    expect(accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: null } }).restricted).toBe(false);
  });
  it("a stored list restricts, drops unknown keys, and ignores user_metadata", () => {
    const a = accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: ["inbox", "bogus"] } });
    expect(a).toEqual({ admin: false, restricted: true, modules: ["inbox"] });
    const self = accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: [] }, user_metadata: { modules: MODULE_KEYS } });
    expect(self.modules).toEqual([]);
  });
});

describe("role presets", () => {
  const as = (key: string) =>
    accessOf({ email: "r@promunch.in", app_metadata: { role: "agent", modules: [...(rolePreset(key)?.modules ?? [])] } });

  it("every preset uses real areas, lands somewhere it can open, and is unique", () => {
    for (const p of ROLE_PRESETS) {
      expect(p.modules.every((m) => MODULE_KEYS.includes(m))).toBe(true);
      const a = as(p.key);
      expect(a.restricted).toBe(true);
      expect(canOpenHref(a, landingFor(a))).toBe(true);
      expect(presetForModules([...p.modules])?.key).toBe(p.key);
    }
  });
  it("presetForModules matches exact lists only, in any order", () => {
    expect(presetForModules(["email_marketing", "wa_marketing"])?.key).toBe("marketing");
    expect(presetForModules(["wa_marketing", "audience"])).toBeNull();
    expect(presetForModules([])).toBeNull();
    expect(presetForModules(null)).toBeNull();
  });
  it("email marketing: Email Studio only, no WhatsApp", () => {
    const a = as("email_marketing");
    expect(canOpenHref(a, "/dashboard/email/campaigns/abc")).toBe(true);
    expect(canCallApi(a, "/api/email-studio/flows/test", "POST")).toBe(true);
    expect(canOpenHref(a, "/dashboard/whatsapp?tab=campaigns")).toBe(false);
    expect(canCallApi(a, "/api/whatsapp/campaigns/abc/send", "POST")).toBe(false);
    expect(canCallApi(a, "/api/contacts/export", "GET")).toBe(false);
  });
  it("WhatsApp automation: flows, cart recovery, campaigns, templates; no chats or email", () => {
    const a = as("wa_automation");
    expect(canOpenHref(a, "/dashboard/whatsapp?tab=flows")).toBe(true);
    expect(canCallApi(a, "/api/whatsapp/flows/custom", "POST")).toBe(true);
    expect(canCallApi(a, "/api/whatsapp/cart-recovery", "PUT")).toBe(true);
    expect(canCallApi(a, "/api/whatsapp/templates/submit", "POST")).toBe(true);
    expect(canOpenHref(a, "/dashboard/whatsapp?tab=inbox")).toBe(false);
    expect(canCallApi(a, "/api/whatsapp/send", "POST")).toBe(false);
    expect(canCallApi(a, "/api/whatsapp/kb", "POST")).toBe(false);
    expect(canOpenHref(a, "/dashboard/email")).toBe(false);
  });
  it("marketing gets both, and still no sales, contacts or settings", () => {
    const a = as("marketing");
    expect(canOpenHref(a, "/dashboard/email")).toBe(true);
    expect(canOpenHref(a, "/dashboard/whatsapp?tab=flows")).toBe(true);
    expect(canOpenPage(a, "/dashboard/sales", null)).toBe(false);
    expect(canOpenPage(a, "/dashboard/settings", null)).toBe(false);
  });
});

describe("influencer tracker", () => {
  it("lives in the partners area (page + API)", () => {
    const partner = accessOf({ email: "c@promunch.in", app_metadata: { role: "agent", modules: ["partners"] } });
    expect(pageModule("/dashboard/influencers", null)).toBe("partners");
    expect(canCallApi(partner, "/api/influencers/deals/abc/drafts/def/review", "POST")).toBe(true);
    expect(canCallApi(marketer, "/api/influencers/deals", "GET")).toBe(false);
    expect(apiRule("/api/influencers/settings")?.modules).toEqual(["partners"]);
  });
});

describe("reputation", () => {
  it("is its own area (page + API), closed to other restricted members", () => {
    const rep = accessOf({ email: "r@promunch.in", app_metadata: { role: "agent", modules: ["reputation"] } });
    expect(pageModule("/dashboard/reputation", null)).toBe("reputation");
    expect(canOpenHref(rep, "/dashboard/reputation?m=abc")).toBe(true);
    expect(landingFor(rep)).toBe("/dashboard/reputation");
    expect(canCallApi(rep, "/api/orm/mentions/abc/draft", "POST")).toBe(true);
    expect(canCallApi(rep, "/api/orm/settings", "PATCH")).toBe(true);
    expect(canCallApi(marketer, "/api/orm/mentions", "GET")).toBe(false);
    expect(canOpenPage(marketer, "/dashboard/reputation", null)).toBe(false);
    expect(apiRule("/api/orm/sources/judgeme/run")?.modules).toEqual(["reputation"]);
    expect(apiRule("/api/ormX")).toBeNull();
  });
});

describe("pages", () => {
  it("WhatsApp tabs split between inbox, marketing and bot knowledge", () => {
    expect(pageModule("/dashboard/whatsapp", null)).toBe("inbox");
    expect(pageModule("/dashboard/whatsapp", "growth")).toBe("wa_marketing");
    expect(pageModule("/dashboard/whatsapp", "kb")).toBe("bot_knowledge");
    expect(pageModule("/dashboard/whatsapp", "nonsense")).toBe("inbox");
    expect(pageModule("/dashboard/whatsapp/campaigns/new", null)).toBe("wa_marketing");
    expect(pageModule("/dashboard/whatsapp/campaigns/abc/edit", null)).toBe("wa_marketing");
    expect(canOpenPage(marketer, "/dashboard/whatsapp/campaigns/abc", null)).toBe(true);
  });
  it("the marketer can open campaigns, popup and email, nothing else", () => {
    expect(canOpenHref(marketer, "/dashboard/whatsapp?tab=campaigns")).toBe(true);
    expect(canOpenHref(marketer, "/dashboard/whatsapp?tab=home")).toBe(true);
    expect(pageModule("/dashboard/whatsapp", "home")).toBe("wa_marketing");
    expect(canOpenHref(marketer, "/dashboard/whatsapp?tab=growth")).toBe(true);
    expect(canOpenHref(marketer, "/dashboard/email/campaigns/abc")).toBe(true);
    expect(canCallApi(marketer, "/api/email-studio/campaigns/abc/send", "POST")).toBe(true);
    expect(canOpenPage(marketer, "/dashboard", null)).toBe(false);
    expect(canOpenPage(marketer, "/dashboard/whatsapp", null)).toBe(false);
    expect(canOpenPage(marketer, "/dashboard/contacts", null)).toBe(false);
    expect(canOpenPage(marketer, "/dashboard/settings", null)).toBe(false);
    expect(canOpenPage(marketer, NO_ACCESS_PATH, null)).toBe(true);
  });
  it("unmapped pages are closed to restricted members", () => {
    expect(pageModule("/dashboard/brand-new", null)).toBeNull();
    expect(canOpenPage(marketer, "/dashboard/brand-new", null)).toBe(false);
  });
  it("landing is the first allowed area, or the no-access page", () => {
    expect(landingFor(marketer)).toBe("/dashboard/whatsapp?tab=home");
    expect(landingFor(accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: [] } }))).toBe(NO_ACCESS_PATH);
    // Every landing must itself be allowed, or the middleware would loop.
    for (const k of MODULE_KEYS) {
      const only = accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: [k] } });
      expect(canOpenHref(only, landingFor(only))).toBe(true);
    }
  });
});

describe("api", () => {
  it("the marketer can run WhatsApp + email marketing APIs", () => {
    expect(canCallApi(marketer, "/api/whatsapp/campaigns/abc/send", "POST")).toBe(true);
    expect(canCallApi(marketer, "/api/whatsapp/growth", "PUT")).toBe(true);
    expect(canCallApi(marketer, "/api/whatsapp/templates/submit", "POST")).toBe(true);
    expect(canCallApi(marketer, "/api/whatsapp/tags", "GET")).toBe(true);
    expect(canCallApi(marketer, "/api/whatsapp/lists", "POST")).toBe(true);
    expect(canCallApi(marketer, "/api/whatsapp/campaigns/audience-preview", "POST")).toBe(true);
    expect(canCallApi(marketer, "/api/whatsapp/campaigns/abc/journey", "GET")).toBe(true);
    expect(canCallApi(marketer, "/api/metrics/attention", "GET")).toBe(true);
  });
  it("the marketer is refused customer chats, contacts, sales, settings", () => {
    expect(canCallApi(marketer, "/api/whatsapp/threads", "GET")).toBe(false);
    expect(canCallApi(marketer, "/api/whatsapp/send", "POST")).toBe(false);
    expect(canCallApi(marketer, "/api/contacts/export", "GET")).toBe(false);
    expect(canCallApi(marketer, "/api/metrics/sales", "GET")).toBe(false);
    expect(canCallApi(marketer, "/api/settings/api-keys", "GET")).toBe(false);
    expect(canCallApi(marketer, "/api/unknown-new-route", "GET")).toBe(false);
  });
  it("inbox may read templates but not edit them", () => {
    const agent = accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: ["inbox"] } });
    expect(canCallApi(agent, "/api/whatsapp/templates", "GET")).toBe(true);
    expect(canCallApi(agent, "/api/whatsapp/templates/submit", "POST")).toBe(false);
  });
  it("prefixes don't bleed (/api/flows vs /api/whatsapp/flows, /api/contacts vs /api/contactsX)", () => {
    expect(apiRule("/api/whatsapp/flows/custom")?.modules).toEqual(["wa_marketing"]);
    expect(apiRule("/api/contactsX")).toBeNull();
  });
});

describe("my profile", () => {
  const noAreas = accessOf({ email: "z@promunch.in", app_metadata: { role: "agent", modules: [] } });
  it("every member, even one with no areas, can edit their own profile", () => {
    for (const a of [marketer, noAreas]) {
      expect(canCallApi(a, "/api/me/profile", "GET")).toBe(true);
      expect(canCallApi(a, "/api/me/profile", "PATCH")).toBe(true);
      expect(canCallApi(a, "/api/me/avatar", "POST")).toBe(true);
      expect(canCallApi(a, "/api/me/notifications", "PATCH")).toBe(true);
      // The bell feed is open; the route itself filters items to the caller's areas.
      expect(canCallApi(a, "/api/notifications", "GET")).toBe(true);
      expect(canOpenPage(a, PROFILE_PATH, null)).toBe(true);
    }
    expect(pageModule(PROFILE_PATH, null)).toBe("open");
  });
  it("opening /api/me does not open look-alike prefixes", () => {
    expect(canCallApi(marketer, "/api/metrics/sales", "GET")).toBe(false);
    expect(apiRule("/api/meX")).toBeNull();
  });
  it("Settings lists My profile first; restricted members without Settings use the stand-alone page", () => {
    const agent = accessOf({ email: "a@promunch.in", app_metadata: { role: "agent" } });
    expect(itemFor(agent, SETTINGS)?.pages?.[0]?.label).toBe("My profile");
    expect(canOpenHref(agent, "/dashboard/settings#profile")).toBe(true);
    expect(canOpenHref(marketer, "/dashboard/settings#profile")).toBe(false);
  });
});

describe("nav", () => {
  it("navFor keeps only allowed places and drops empty groups", () => {
    const labels = navFor(marketer).flatMap((s) => s.items.map((i) => i.label));
    // Customers = the sign-up popup (a WhatsApp marketing tab)
    expect(labels).toEqual(["Marketing", "Customers"]);
    expect(navFor(marketer)[0].items[0].children?.map((c) => c.label)).toEqual(["WhatsApp", "Email"]);
    expect(navFor(null)).toEqual([]);
    expect(navFor(accessOf({ email: OWNER_EMAIL }))).toBe(NAV);
  });
  it("Security (sign-ins, IPs, activity log) is shown to owners/admins only", () => {
    const pages = (a: ReturnType<typeof accessOf>) => (itemFor(a, SETTINGS)?.pages ?? []).map((p) => p.label);
    expect(pages(accessOf({ email: "boss@promunch.in", app_metadata: { role: "admin" } }))).toContain("Security");
    expect(pages(accessOf({ email: "a@promunch.in", app_metadata: { role: "agent" } }))).not.toContain("Security");
    expect(pages(accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: ["system"] } }))).not.toContain("Security");
  });
});

// Coverage guard: a new route or page must be given an area here, otherwise
// restricted members are refused it (safe, but surprising).
function walk(dir: string, file: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, file));
    else if (name === file) out.push(p);
  }
  return out;
}
const appDir = join(process.cwd(), "src", "app");
const urlOf = (p: string, file: string) => "/" + relative(appDir, p).split(sep).join("/").replace(new RegExp(`/?${file}$`), "");

describe("coverage", () => {
  it("every session-gated API route maps to an area", () => {
    const routes = walk(join(appDir, "api"), "route.ts")
      .map((p) => urlOf(p, "route.ts"))
      .filter((u) => !/^\/api\/(cron|webhooks|public)\//.test(u));
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.filter((u) => !apiRule(u))).toEqual([]);
  });
  it("every dashboard page maps to an area", () => {
    const pages = walk(join(appDir, "dashboard"), "page.tsx").map((p) => urlOf(p, "page.tsx"));
    expect(pages.filter((u) => pageModule(u, null) === null)).toEqual([]);
  });
});

describe("P1 routes added Oct 9 (reports, KB ask, deals, saved answers, buyers)", () => {
  const as = (modules: string[]) => accessOf({ email: "m@promunch.in", app_metadata: { role: "agent", modules } });
  it("maps each new route to its area", () => {
    expect(apiRule("/api/inbox/tickets/reports")?.modules).toEqual(["inbox"]);
    expect(apiRule("/api/whatsapp/kb/ask")?.modules).toEqual(["bot_knowledge"]);
    expect(apiRule("/api/deals")?.modules).toEqual(["partners"]);
    expect(apiRule("/api/assistant/saved/abc")?.modules).toEqual(["home"]);
    expect(apiRule("/api/metrics/buyers")?.modules).toEqual(["sales"]);
    expect(pageModule("/dashboard/inbox/reports", null)).toBe("inbox");
    expect(pageModule("/dashboard/sales/repeat", null)).toBe("sales");
    expect(pageModule("/dashboard/sales/products", null)).toBe("sales");
  });
  it("refuses members without the area", () => {
    expect(canCallApi(as(["wa_marketing"]), "/api/metrics/buyers", "GET")).toBe(false);
    expect(canCallApi(as(["inbox"]), "/api/whatsapp/kb/ask", "GET")).toBe(false);
    expect(canCallApi(as(["bot_knowledge"]), "/api/whatsapp/kb/ask", "GET")).toBe(true);
    expect(canCallApi(as(["partners"]), "/api/deals", "POST")).toBe(true);
    expect(canCallApi(as(["sales"]), "/api/deals", "POST")).toBe(false);
  });
});
