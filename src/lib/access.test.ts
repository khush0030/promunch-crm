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
} from "./access";
import { OWNER_EMAIL } from "./rbac";
import { NAV, navFor } from "@/components/shell/nav";

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

describe("pages", () => {
  it("WhatsApp tabs split between inbox, marketing and bot knowledge", () => {
    expect(pageModule("/dashboard/whatsapp", null)).toBe("inbox");
    expect(pageModule("/dashboard/whatsapp", "growth")).toBe("wa_marketing");
    expect(pageModule("/dashboard/whatsapp", "kb")).toBe("bot_knowledge");
    expect(pageModule("/dashboard/whatsapp", "nonsense")).toBe("inbox");
  });
  it("the marketer can open campaigns, popup and email, nothing else", () => {
    expect(canOpenHref(marketer, "/dashboard/whatsapp?tab=campaigns")).toBe(true);
    expect(canOpenHref(marketer, "/dashboard/whatsapp?tab=growth")).toBe(true);
    expect(canOpenHref(marketer, "/dashboard/marketing/email/123/edit")).toBe(true);
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
    expect(landingFor(marketer)).toBe("/dashboard/whatsapp?tab=campaigns");
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
    expect(canCallApi(marketer, "/api/brevo/campaigns/1/actions", "POST")).toBe(true);
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

describe("nav", () => {
  it("navFor keeps only allowed items and drops empty hubs", () => {
    const hubs = navFor(marketer);
    expect(hubs.map((h) => h.hub)).toEqual(["Marketing"]);
    expect(hubs[0].items.map((i) => i.label)).not.toContain("Audience");
    expect(hubs[0].items.map((i) => i.label)).toContain("WhatsApp popup");
    expect(navFor(null)).toEqual([]);
    expect(navFor(accessOf({ email: OWNER_EMAIL }))).toBe(NAV);
  });
  it("Admin (sign-ins, IPs, activity log) is shown to owners/admins only", () => {
    const labels = (a: ReturnType<typeof accessOf>) => navFor(a).flatMap((h) => h.items.map((i) => i.label));
    expect(labels(accessOf({ email: "boss@promunch.in", app_metadata: { role: "admin" } }))).toContain("Admin");
    expect(labels(accessOf({ email: "a@promunch.in", app_metadata: { role: "agent" } }))).not.toContain("Admin");
    expect(labels(accessOf({ email: "a@promunch.in", app_metadata: { role: "agent", modules: ["system"] } }))).not.toContain("Admin");
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
