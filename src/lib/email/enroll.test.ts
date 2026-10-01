import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory fake of the supabase-js query builder: just the calls the enrol /
// exit code uses, plus the two unique indexes on flow_enrollments that the
// no-duplicate invariant depends on.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let idSeq = 0;

function getPath(row: Row, col: string): unknown {
  if (col.includes("->>")) {
    const [c, k] = col.split("->>");
    const obj = row[c] as Row | null | undefined;
    return obj == null ? undefined : obj[k] == null ? undefined : String(obj[k]);
  }
  return row[col];
}
function likeToRe(p: string, flags = ""): RegExp {
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\" && i + 1 < p.length) { re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, flags);
}
function contains(hay: unknown, needle: unknown): boolean {
  if (Array.isArray(needle)) return Array.isArray(hay) && needle.every((n) => hay.some((h) => contains(h, n)));
  if (needle && typeof needle === "object") {
    if (!hay || typeof hay !== "object") return false;
    return Object.entries(needle).every(([k, v]) => contains((hay as Row)[k], v));
  }
  return hay === needle;
}
let beforeUpsert: (() => void) | null = null;
function uniqueViolation(table: string, row: Row, ignoreId?: unknown): string | null {
  if (table === "contacts") return (tables.contacts ?? []).some((c) => c.email === row.email) ? "dedup" : null;
  if (table !== "flow_enrollments") return null;
  for (const r of tables[table] ?? []) {
    if (r.id === ignoreId) continue;
    if (r.flow_id === row.flow_id && r.dedup_key != null && r.dedup_key === row.dedup_key) return "dedup";
    const cart = (x: Row) => x.status === "active" && String(x.dedup_key ?? "").startsWith("abandoned:");
    if (cart(r) && cart(row) && r.flow_id === row.flow_id && r.contact_id === row.contact_id) return "one_active_cart";
  }
  return null;
}

class Q {
  private filters: Array<(r: Row) => boolean> = [];
  private op: "select" | "update" | "upsert" = "select";
  private patch: Row = {};
  private upsertRow: Row = {};
  private ignoreDup = false;
  private single = false;
  private lim = Infinity;
  private ord: { col: string; asc: boolean } | null = null;
  constructor(private table: string) { tables[table] ??= []; }
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => getPath(r, c) === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  like(c: string, p: string) { const re = likeToRe(p); this.filters.push((r) => re.test(String(r[c] ?? ""))); return this; }
  ilike(c: string, p: string) { const re = likeToRe(p, "i"); this.filters.push((r) => re.test(String(r[c] ?? ""))); return this; }
  contains(c: string, v: unknown) { this.filters.push((r) => contains(r[c], v)); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.ord = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  update(p: Row) { this.op = "update"; this.patch = p; return this; }
  upsert(r: Row, o?: { ignoreDuplicates?: boolean }) { this.op = "upsert"; this.upsertRow = r; this.ignoreDup = !!o?.ignoreDuplicates; return this; }
  private run(): { data: unknown; error: { code?: string; message: string } | null } {
    const t = tables[this.table];
    if (this.op === "upsert") {
      if (beforeUpsert && this.table === "flow_enrollments") { const h = beforeUpsert; beforeUpsert = null; h(); }
      const row = { id: `id${++idSeq}`, ...this.upsertRow };
      const v = uniqueViolation(this.table, row);
      if (v === "dedup" && this.ignoreDup) return { data: [], error: null };
      if (v) return { data: null, error: { code: "23505", message: v } };
      t.push(row);
      return { data: [{ id: row.id }], error: null };
    }
    let rows = t.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of rows) {
        const next = { ...r, ...this.patch };
        if (uniqueViolation(this.table, next, r.id)) return { data: null, error: { code: "23505", message: "update" } };
        Object.assign(r, this.patch);
      }
      return { data: rows.map((r) => ({ id: r.id, contact_id: r.contact_id })), error: null };
    }
    if (this.ord) {
      const { col, asc } = this.ord;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    rows = rows.slice(0, this.lim);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
  then<T>(res: (v: { data: unknown; error: unknown }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve(this.run()).then(res, rej);
  }
}
const fake = { from: (t: string) => new Q(t) };

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: (t: string) => fake.from(t) } }));
vi.mock("../../../promunch-email-agent/supabase/functions/_shared/supabase.ts", () => ({ db: () => fake }));

import * as app from "./enroll";
// Loaded by a runtime path, not a static import: the edge file imports Deno
// modules (./supabase.ts, mocked above) that Next's build type check cannot
// resolve. Both twins export the same API, so it is typed as the app twin.
const EDGE_FLOWS = "../../../promunch-email-agent/supabase/functions/_shared/email-flows";
const edge = (await import(/* @vite-ignore */ EDGE_FLOWS)) as typeof app;

const step = (h = 1) => ({ type: "email", delay_hours: h, subject: "s", body_html: "b" });

function reset() {
  for (const k of Object.keys(tables)) delete tables[k];
  idSeq = 0;
  beforeUpsert = null;
  tables.contacts = [{ id: "c1", email: "a@x.com" }];
  tables.flows = [];
  tables.flow_enrollments = [];
  tables.shopify_orders = [];
}
function flow(id: string, trigger_type: string, trigger_config: Row = {}, steps = [step(), step(24)], status = "active", created_at = "2026-01-01") {
  tables.flows.push({ id, trigger_type, trigger_config, steps, status, created_at });
}
const enrolments = () => tables.flow_enrollments;

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------
describe.each([["app", app], ["edge", edge]] as const)("pure rules (%s twin)", (_n, m) => {
  it("selects every flow with steps, or just the targeted one", () => {
    const fs = [
      { id: "a", steps: [step()], trigger_config: {} },
      { id: "b", steps: [], trigger_config: {} },
      { id: "c", steps: [step()], trigger_config: null },
    ];
    expect(m.selectFlowsForEnrol(fs).map((f) => f.id)).toEqual(["a", "c"]);
    expect(m.selectFlowsForEnrol(fs, "c").map((f) => f.id)).toEqual(["c"]);
    expect(m.selectFlowsForEnrol(fs, "b")).toEqual([]);
  });

  it("exit_on_order defaults: cart/welcome/segment yes, order/date no, config wins", () => {
    const f = (trigger_type: string, cfg: Row = {}) => ({ id: "x", trigger_type, steps: [], trigger_config: cfg });
    expect(m.exitsOnOrder(f("checkout_abandoned"))).toBe(true);
    expect(m.exitsOnOrder(f("customer_created"))).toBe(true);
    expect(m.exitsOnOrder(f("segment_entry"))).toBe(true);
    expect(m.exitsOnOrder(f("order_placed"))).toBe(false);
    expect(m.exitsOnOrder(f("date_based"))).toBe(false);
    expect(m.exitsOnOrder(f("segment_entry", { exit_on_order: false }))).toBe(false);
    expect(m.exitsOnOrder(f("date_based", { exit_on_order: true }))).toBe(true);
  });

  it("exit_on_checkout: welcome by default, never the cart flow itself", () => {
    const f = (trigger_type: string, cfg: Row = {}) => ({ id: "x", trigger_type, steps: [], trigger_config: cfg });
    expect(m.exitsOnCheckout(f("customer_created"))).toBe(true);
    expect(m.exitsOnCheckout(f("segment_entry"))).toBe(false);
    expect(m.exitsOnCheckout(f("segment_entry", { exit_on_checkout: true }))).toBe(true);
    expect(m.exitsOnCheckout(f("checkout_abandoned", { exit_on_checkout: true }))).toBe(false);
  });

  it("hasPriorOrder ignores the current, cancelled, voided/refunded and creator-seed orders", () => {
    const cur = { orderId: 111, orderRef: "#1" };
    expect(m.hasPriorOrder([], cur)).toBe(false);
    expect(m.hasPriorOrder([{ shopify_id: 111, order_number: "#1" }], cur)).toBe(false);
    expect(m.hasPriorOrder([{ shopify_id: 999, order_number: "#1" }], cur)).toBe(false);
    expect(m.hasPriorOrder([{ shopify_id: 2, order_number: "#2", cancelled_at: "x" }], cur)).toBe(false);
    expect(m.hasPriorOrder([{ shopify_id: 2, order_number: "#2", financial_status: "REFUNDED" }], cur)).toBe(false);
    expect(m.hasPriorOrder([{ shopify_id: 2, order_number: "#2", is_creator: true }], cur)).toBe(false);
    expect(m.hasPriorOrder([{ shopify_id: 2, order_number: "#2", financial_status: "paid" }], cur)).toBe(true);
  });

  it("first_order_only flows dedup per contact, others per entity", () => {
    const fo = { id: "f", steps: [], trigger_config: { first_order_only: true } };
    const pp = { id: "p", steps: [], trigger_config: {} };
    expect(m.dedupKeyFor(fo, { dedupPrefix: "postpurchase", entityRef: "#9" }, "c1")).toBe("postpurchase:first:c1");
    expect(m.dedupKeyFor(pp, { dedupPrefix: "postpurchase", entityRef: "#9" }, "c1")).toBe("postpurchase:#9");
  });

  it("mergeCartContext: newer cart wins, blanks never wipe, tokens accumulate", () => {
    const prev = { checkout_url: "u1", items: [{ title: "A" }], total: 100, first_name: "Asha", coupon: "K" };
    const out = m.mergeCartContext(prev, { checkout_url: "u2", items: [{ title: "B" }], total: 200, first_name: null }, "t2", "abandoned:t1");
    expect(out).toMatchObject({ checkout_url: "u2", items: [{ title: "B" }], total: 200, first_name: "Asha", coupon: "K", checkout_token: "t2" });
    expect(out.checkout_tokens).toEqual(["t1", "t2"]);
    const kept = m.mergeCartContext(out, { items: [], total: 0, checkout_url: "" }, "t2", "abandoned:t1");
    expect(kept).toMatchObject({ items: [{ title: "B" }], total: 200, checkout_url: "u2" });
    expect(kept.checkout_tokens).toEqual(["t1", "t2"]);
  });

  it("extendedDeadline only ever pushes out", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    expect(m.extendedDeadline(null, 30, now)).toBe("2026-09-30T06:00:00.000Z");
    expect(m.extendedDeadline("2026-10-05T00:00:00.000Z", 30, now)).toBe("2026-10-05T00:00:00.000Z");
    expect(m.extendedDeadline("2026-09-29T01:00:00.000Z", 30, now)).toBe("2026-09-30T06:00:00.000Z");
    expect(m.extendedDeadline("2026-09-29T01:00:00.000Z", null, now)).toBe("2026-09-29T01:00:00.000Z");
  });

  it("escapeLike escapes wildcards", () => {
    expect(m.escapeLike("a_b%c\\d@x.com")).toBe("a\\_b\\%c\\\\d@x.com");
    expect(m.isSingleActivePerContact("checkout_abandoned", "x")).toBe(true);
    expect(m.isSingleActivePerContact("segment_entry", "browse")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestration against the fake DB (both twins run the same scenarios).
// ---------------------------------------------------------------------------
const twins = [
  ["app", app.enrollEmailFlow, app],
  ["edge", edge.enrolEmailFlow, edge],
] as const;

describe.each(twins)("enrolment (%s twin)", (_n, enrol, m) => {
  beforeEach(reset);

  const cart = (token: string, items: Row[] = [{ title: token }]) =>
    enrol("checkout_abandoned", {
      email: "A@x.com", entityRef: token, dedupPrefix: "abandoned", firstName: "Asha",
      context: { checkout_url: `https://promunch.in/cart/${token}`, items, total: 100 },
    });

  it("a second checkout refreshes the live cart enrolment instead of starting a parallel one", async () => {
    flow("cart", "checkout_abandoned", { deadline_hours: 30 });
    expect(await cart("t1")).toBe(1);
    const e = enrolments()[0];
    e.current_step = 2; // two emails already out
    const nextAt = e.next_action_at;
    expect(await cart("t2", [{ title: "Crunchies" }])).toBe(1);
    expect(enrolments()).toHaveLength(1);
    expect(e.current_step).toBe(2); // never re-sends a step
    expect(e.next_action_at).toBe(nextAt);
    expect(e.dedup_key).toBe("abandoned:t1");
    expect(e.context).toMatchObject({ checkout_url: "https://promunch.in/cart/t2", items: [{ title: "Crunchies" }], checkout_token: "t2", checkout_tokens: ["t1", "t2"] });
  });

  it("a checkouts/update for a finished cart never re-enrols it (by key or by merged token)", async () => {
    flow("cart", "checkout_abandoned");
    await cart("t1");
    await cart("t2");
    enrolments()[0].status = "completed";
    expect(await cart("t1")).toBe(0);
    expect(await cart("t2")).toBe(0);
    expect(enrolments()).toHaveLength(1);
    // a genuinely new cart after the old one finished is a new sequence
    expect(await cart("t3")).toBe(1);
    expect(enrolments()).toHaveLength(2);
  });

  it("an existing live cart with another token is refreshed, not duplicated", async () => {
    flow("cart", "checkout_abandoned");
    tables.flow_enrollments.push({ id: "w", flow_id: "cart", contact_id: "c1", status: "active", dedup_key: "abandoned:tw", context: {}, entered_at: "2026-01-01", current_step: 0 });
    expect(await cart("t9")).toBe(1);
    expect(enrolments()).toHaveLength(1);
    expect(enrolments()[0].context).toMatchObject({ checkout_tokens: ["tw", "t9"] });
  });

  it("race: a concurrent webhook wins the insert → 23505 folds into the winner", async () => {
    flow("cart", "checkout_abandoned");
    beforeUpsert = () => {
      tables.flow_enrollments.push({ id: "w", flow_id: "cart", contact_id: "c1", status: "active", dedup_key: "abandoned:tw", context: { checkout_tokens: ["tw"] }, entered_at: "2026-01-01", current_step: 0 });
    };
    expect(await cart("t9")).toBe(1);
    expect(enrolments()).toHaveLength(1);
    expect(enrolments()[0].context).toMatchObject({ checkout_token: "t9", checkout_tokens: ["tw", "t9"] });
  });

  it("enrols into EVERY active flow for the trigger; flowId targets one", async () => {
    flow("pp", "order_placed");
    flow("review", "order_placed", {}, [step(168)]);
    flow("draft", "order_placed", {}, [step()], "draft");
    const n = await enrol("order_placed", { email: "a@x.com", entityRef: "#5", dedupPrefix: "postpurchase" });
    expect(n).toBe(2);
    expect(enrolments().map((e) => e.flow_id).sort()).toEqual(["pp", "review"]);
    expect(enrolments()[0].context).toMatchObject({ order_ref: "#5" });
    // idempotent
    expect(await enrol("order_placed", { email: "a@x.com", entityRef: "#5", dedupPrefix: "postpurchase" })).toBe(0);
    reset();
    flow("wb", "segment_entry");
    flow("vip", "segment_entry");
    expect(await enrol("segment_entry", { email: "a@x.com", entityRef: "q3", dedupPrefix: "winback", flowId: "vip" })).toBe(1);
    expect(enrolments().map((e) => e.flow_id)).toEqual(["vip"]);
  });

  it("first_order_only skips repeat buyers and fires at most once per contact", async () => {
    flow("first", "order_placed", { first_order_only: true });
    tables.shopify_orders.push({ shopify_id: 1, order_number: "#1", customer_email: "A@X.com", financial_status: "paid" });
    // the current order row itself does not count as prior
    // unknown first-order status (Shopify count lookup failed) = not first
    expect(await enrol("order_placed", { email: "a@x.com", entityRef: "#1", dedupPrefix: "postpurchase", orderId: 1 })).toBe(0);
    expect(await enrol("order_placed", { email: "a@x.com", entityRef: "#1", dedupPrefix: "postpurchase", orderId: 1, isFirstOrder: false })).toBe(0);
    expect(await enrol("order_placed", { email: "a@x.com", entityRef: "#1", dedupPrefix: "postpurchase", orderId: 1, isFirstOrder: true })).toBe(1);
    tables.shopify_orders.push({ shopify_id: 2, order_number: "#2", customer_email: "a@x.com", financial_status: "paid" });
    // our history wins even when the caller says first
    expect(await enrol("order_placed", { email: "a@x.com", entityRef: "#2", dedupPrefix: "postpurchase", orderId: 2, isFirstOrder: true })).toBe(0);
    expect(enrolments()).toHaveLength(1);
    expect(enrolments()[0].dedup_key).toBe("postpurchase:first:c1");
  });

  it("order placed: converts cart + welcome + win-back, leaves order_placed running", async () => {
    flow("cart", "checkout_abandoned");
    flow("welcome", "customer_created");
    flow("wb", "segment_entry");
    flow("vip", "segment_entry", { exit_on_order: false });
    flow("pp", "order_placed");
    for (const f of ["cart", "welcome", "wb", "vip", "pp"]) {
      tables.flow_enrollments.push({ id: f, flow_id: f, contact_id: "c1", status: "active", dedup_key: `${f === "cart" ? "abandoned" : f}:k` });
    }
    expect(await m.exitFlowsOnOrder("A@x.com")).toBe(3);
    const st = Object.fromEntries(enrolments().map((e) => [e.id, e.status]));
    expect(st).toEqual({ cart: "converted", welcome: "converted", wb: "converted", vip: "active", pp: "active" });
  });

  it("phone-only order converts via checkout token, including a merged token", async () => {
    flow("cart", "checkout_abandoned");
    flow("welcome", "customer_created");
    await cart("t1");
    await cart("t2"); // merged into the t1 enrolment
    tables.flow_enrollments.push({ id: "w", flow_id: "welcome", contact_id: "c1", status: "active", dedup_key: "welcome:c1" });
    expect(await m.convertAbandonedEmailFlowsByCheckout("t2")).toBe(2);
    expect(enrolments().every((e) => e.status === "converted")).toBe(true);
  });

  it("checkout started exits welcome only", async () => {
    flow("cart", "checkout_abandoned");
    flow("welcome", "customer_created");
    flow("wb", "segment_entry");
    for (const f of ["welcome", "wb"]) tables.flow_enrollments.push({ id: f, flow_id: f, contact_id: "c1", status: "active", dedup_key: `${f}:k` });
    expect(await m.exitFlowsOnCheckout("a@x.com")).toBe(1);
    expect(enrolments().find((e) => e.id === "welcome")).toMatchObject({ status: "exited", last_error: "checkout started" });
    expect(enrolments().find((e) => e.id === "wb")?.status).toBe("active");
  });

  it("refund/cancel cancels that order's order_placed enrolments only", async () => {
    flow("pp", "order_placed");
    flow("first", "order_placed", { first_order_only: true });
    flow("wb", "segment_entry");
    tables.flow_enrollments.push(
      { id: "a", flow_id: "pp", contact_id: "c1", status: "active", dedup_key: "postpurchase:#7", context: { order_ref: "#7" } },
      { id: "b", flow_id: "first", contact_id: "c1", status: "active", dedup_key: "postpurchase:first:c1", context: { order_ref: "#7" } },
      { id: "c", flow_id: "pp", contact_id: "c1", status: "active", dedup_key: "postpurchase:#8", context: { order_ref: "#8" } },
      { id: "d", flow_id: "wb", contact_id: "c1", status: "active", dedup_key: "postpurchase:#7", context: { order_ref: "#7" } },
    );
    expect(await m.exitOrderEmailFlows("#7", "refunded")).toBe(2);
    const st = Object.fromEntries(enrolments().map((e) => [e.id, e.status]));
    expect(st).toEqual({ a: "cancelled", b: "cancelled", c: "active", d: "active" });
    expect(enrolments()[0].last_error).toBe("order refunded");
  });

  it("no email / no active flow / no contact → enrols nobody", async () => {
    flow("cart", "checkout_abandoned", {}, [step()], "draft");
    expect(await cart("t1")).toBe(0);
    expect(await enrol("customer_created", { email: null, entityRef: "x", dedupPrefix: "welcome" })).toBe(0);
    expect(enrolments()).toHaveLength(0);
  });
});
