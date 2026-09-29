import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";

// Minimal chainable Supabase stub: records inserts/updates, resolves lookups.
const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
let contactById: Record<string, unknown> | null = null;
let contactByEmail: Record<string, unknown> | null = null;
let insertError: { message: string } | null = null;

function builder(table: string) {
  const state: { op: string; payload?: unknown; filters: Record<string, unknown> } = { op: "select", filters: {} };
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (payload: unknown) => {
      calls.push({ table, op: "insert", payload });
      return Promise.resolve({ error: insertError });
    },
    update: (payload: unknown) => {
      state.op = "update";
      state.payload = payload;
      calls.push({ table, op: "update", payload });
      return b;
    },
    eq: (col: string, val: unknown) => {
      state.filters[col] = val;
      return b;
    },
    is: () => b,
    gte: () => Promise.resolve({ error: null }),
    maybeSingle: () =>
      Promise.resolve({ data: "id" in state.filters ? contactById : contactByEmail, error: null }),
  };
  return b;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));

import { POST, OPTIONS } from "./route";
import { signContactToken } from "@/lib/email/browse-abandon";
import { NextRequest } from "next/server";

const CONTACT = "11111111-2222-3333-4444-555555555555";
let ipSeq = 0;

function req(body: unknown, origin: string | null = "https://promunch.in", raw?: string) {
  const headers: Record<string, string> = { "content-type": "text/plain", "x-forwarded-for": `10.0.0.${++ipSeq}` };
  if (origin) headers.origin = origin;
  return new NextRequest("https://admin.promunch.in/api/public/track", {
    method: "POST",
    headers,
    body: raw ?? JSON.stringify(body),
  });
}

const view = {
  event: "product_viewed",
  clientId: `client-${Math.random().toString(36).slice(2, 10)}`,
  product: { id: "gid://shopify/Product/123456", title: "Crunchies", url: "https://promunch.in/products/c", price: 149 },
  url: "https://promunch.in/products/c",
};

beforeEach(() => {
  calls.length = 0;
  contactById = null;
  contactByEmail = null;
  insertError = null;
});

describe("/api/public/track", () => {
  it("answers CORS preflight for the storefront", async () => {
    const res = OPTIONS(req(null, "https://promunch.in", ""));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://promunch.in");
  });

  it("refuses unknown and missing origins", async () => {
    expect((await POST(req(view, "https://evil.example"))).status).toBe(403);
    expect((await POST(req(view, null))).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("accepts the pixel sandbox's opaque 'null' origin", async () => {
    expect((await POST(req(view, "null"))).status).toBe(204);
  });

  it("stores an anonymous view without linking", async () => {
    const res = await POST(req(view));
    expect(res.status).toBe(204);
    const ins = calls.find((c) => c.op === "insert");
    expect(ins?.table).toBe("storefront_events");
    expect(ins?.payload).toMatchObject({ event: "product_viewed", contact_id: null, email: null });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("resolves a valid pm_c token to the contact and back-links the client", async () => {
    contactById = { id: CONTACT, email: "Asha@Example.com" };
    const res = await POST(req({ ...view, pm_c: signContactToken(CONTACT) }));
    expect(res.status).toBe(204);
    expect(calls.find((c) => c.op === "insert")?.payload).toMatchObject({ contact_id: CONTACT, email: "asha@example.com" });
    expect(calls.find((c) => c.op === "update")?.payload).toEqual({ contact_id: CONTACT, email: "asha@example.com" });
  });

  it("ignores a forged pm_c token", async () => {
    contactById = { id: CONTACT, email: "asha@example.com" };
    await POST(req({ ...view, pm_c: "Zm9v.zz.AAAA" }));
    expect(calls.find((c) => c.op === "insert")?.payload).toMatchObject({ contact_id: null, email: null });
  });

  it("uses a logged-in customer's email", async () => {
    contactByEmail = { id: CONTACT };
    await POST(req({ ...view, email: "asha@example.com" }));
    expect(calls.find((c) => c.op === "insert")?.payload).toMatchObject({ contact_id: CONTACT, email: "asha@example.com" });
  });

  it("rejects bad shape, bad json and oversize bodies without touching the DB", async () => {
    expect((await POST(req({ ...view, event: "nope" }))).status).toBe(400);
    expect((await POST(req(null, "https://promunch.in", "{not json"))).status).toBe(400);
    expect((await POST(req(null, "https://promunch.in", "x".repeat(5000)))).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("never 5xxes when the insert fails", async () => {
    insertError = { message: "relation does not exist" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(req(view))).status).toBe(204);
    spy.mockRestore();
  });

  it("rate-limits a single client", async () => {
    const clientId = "client-ratelimit-1";
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await POST(req({ ...view, clientId }))).status;
    expect(last).toBe(429);
  });
});
