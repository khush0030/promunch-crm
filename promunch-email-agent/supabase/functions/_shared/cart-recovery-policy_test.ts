import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { claimCartTemplateAttempt, hasPriorityCart } from "./cart-recovery-policy.ts";

function database(options: { attempted?: boolean; historyError?: boolean; active?: boolean } = {}) {
  const claims = new Set<string>();
  const filters: string[] = [];
  const sb = {
    from(table: string) {
      const query = {
        select() { return query; }, eq(key: string, value: unknown) { filters.push(`${key}=${value}`); return query; },
        is() { return query; }, or() { return query; }, order() { return query; }, in() { return query; },
        range() { return Promise.resolve({ data: [{ id: "run-1", context: {} }], error: options.historyError ? {} : null }); },
        limit() { return Promise.resolve({ data: table === "wa_messages" ? (options.attempted ? [{ id: "m1" }] : []) : (options.active ? [{ id: "run-1" }] : []), error: options.historyError ? {} : null }); },
        insert(row: { order_ref: string }) {
          if (claims.has(row.order_ref)) return Promise.resolve({ error: { code: "23505" } });
          claims.add(row.order_ref);
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
  } as unknown as Parameters<typeof claimCartTemplateAttempt>[0];
  return { sb, claims, filters };
}

Deno.test("concurrent sibling cart templates have exactly one winner", async () => {
  const { sb, claims } = database();
  const results = await Promise.all(Array.from({ length: 8 }, () => claimCartTemplateAttempt(sb, "recipient", "cart-1")));
  assertEquals(results.filter(Boolean).length, 1);
  assertEquals(claims.size, 1);
  assertEquals(await claimCartTemplateAttempt(sb, "recipient", "cart-2"), true);
});

Deno.test("historical failures and unknown ledger state prevent new attempts", async () => {
  for (const options of [{ attempted: true }, { historyError: true }]) {
    const { sb, claims } = database(options);
    assertEquals(await claimCartTemplateAttempt(sb, "recipient", "cart-1"), false);
    assertEquals(claims.size, 0);
  }
  assertEquals(await claimCartTemplateAttempt(database().sb, "recipient", null), false);
});

Deno.test("optional marketing yields to an active cart and fails closed", async () => {
  assertEquals(await hasPriorityCart(database({ active: true }).sb, "recipient"), true);
  assertEquals(await hasPriorityCart(database().sb, "recipient"), false);
  assertEquals(await hasPriorityCart(database({ historyError: true }).sb, "recipient"), true);
});
