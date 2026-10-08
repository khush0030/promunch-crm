import { describe, expect, it } from "vitest";
import { isCollabHost, routeCollab, STOREFRONT_URL } from "./collab-host";

const CODE = "2HcVWoTpISN0";

describe("isCollabHost", () => {
  it("matches the creator host, ignoring port and case", () => {
    expect(isCollabHost("collab.promunch.in", "collab.promunch.in")).toBe(true);
    expect(isCollabHost("Collab.Promunch.in:443", "collab.promunch.in")).toBe(true);
  });
  it("does not match the dashboard hosts", () => {
    expect(isCollabHost("admin.promunch.in", "collab.promunch.in")).toBe(false);
    expect(isCollabHost("promunch-crm.vercel.app", "collab.promunch.in")).toBe(false);
    expect(isCollabHost(null, "collab.promunch.in")).toBe(false);
  });
});

describe("routeCollab", () => {
  it("rewrites /<code> to the portal page", () => {
    expect(routeCollab(`/${CODE}`)).toEqual({ kind: "rewrite", pathname: `/c/${CODE}` });
  });
  it("redirects the old /c/<code> shape to the short form", () => {
    expect(routeCollab(`/c/${CODE}`)).toEqual({ kind: "redirect", location: `/${CODE}` });
  });
  it("lets the portal API and Next assets through", () => {
    expect(routeCollab(`/api/public/collab/${CODE}/ack`)).toEqual({ kind: "pass" });
    expect(routeCollab("/_next/static/chunks/x.js")).toEqual({ kind: "pass" });
  });
  it("never exposes the dashboard or other APIs", () => {
    expect(routeCollab("/dashboard")).toEqual({ kind: "redirect", location: STOREFRONT_URL });
    expect(routeCollab("/login")).toEqual({ kind: "redirect", location: STOREFRONT_URL });
    expect(routeCollab("/dashboard/influencers")).toEqual({ kind: "redirect", location: STOREFRONT_URL });
    expect(routeCollab("/api/influencers")).toEqual({ kind: "not_found" });
    expect(routeCollab("/api/public/wa-optin")).toEqual({ kind: "not_found" });
  });
  it("sends the bare host and bad codes to the storefront", () => {
    expect(routeCollab("/")).toEqual({ kind: "redirect", location: STOREFRONT_URL });
    expect(routeCollab("/short")).toEqual({ kind: "redirect", location: STOREFRONT_URL });
    expect(routeCollab(`/${CODE}/extra`)).toEqual({ kind: "redirect", location: STOREFRONT_URL });
  });
});
