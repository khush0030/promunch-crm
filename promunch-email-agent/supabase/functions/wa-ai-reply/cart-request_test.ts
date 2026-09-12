import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleCartRequest } from "./cart-request.ts";

function fakeDb(options: { sealFails?: boolean; claimFails?: boolean } = {}) {
  let claimed = false;
  return {
    from(table: string) {
      const q = { select() { return q; }, eq() { return q; },
        maybeSingle() { return Promise.resolve({ data: { target_url: "https://promunch.in/cart/123:2?storefront=true", sent_by: "growth:cart-request:ip", created_at: new Date().toISOString() }, error: null }); },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
      if (!["wa_short_links", "wa_messages"].includes(table)) throw Error("unexpected write");
      return q;
    },
    rpc(name: string) {
      if (name === "claim_ai_reply") {
        const won = !claimed; claimed = true;
        return Promise.resolve({ data: won, error: options.claimFails ? {} : null });
      }
      if (name === "mark_ai_reply_sent") return Promise.resolve({ error: options.sealFails ? {} : null });
      throw Error("unexpected RPC");
    },
  } as unknown as Parameters<typeof handleCartRequest>[0];
}
const inbound = () => ({ id: "inbound-1", body: "PROMUNCH cart request: cr_" + "a".repeat(32), created_at: new Date().toISOString() });

Deno.test("duplicate cart request jobs send once; no contact opt-in writes", async () => {
  let sends = 0;
  const send = async () => { sends++; return { ok: true }; };
  const sb = fakeDb();
  await Promise.all(Array.from({ length: 8 }, () => handleCartRequest(sb, "thread", inbound(), false, null, send)));
  assertEquals(sends, 1);
});
Deno.test("unknown outcome and failed durable claim never cause another send", async () => {
  for (const options of [{ claimFails: true }, { sealFails: true }]) {
    let sends = 0;
    await handleCartRequest(fakeDb(options), "thread", inbound(), false, null, async () => { sends++; return { ok: true }; });
    assertEquals(sends, 0);
  }
  const sb = fakeDb(); let sends = 0;
  const send = async () => { sends++; throw Error("timeout after acceptance"); };
  await handleCartRequest(sb, "thread", inbound(), false, null, send).catch(() => {});
  await handleCartRequest(sb, "thread", inbound(), false, null, send);
  assertEquals(sends, 1);
});
Deno.test("draft and expired service window never send", async () => {
  let sends = 0;
  const send = async () => { sends++; return { ok: true }; };
  await handleCartRequest(fakeDb(), "thread", inbound(), true, null, send);
  await handleCartRequest(fakeDb(), "thread", { ...inbound(), created_at: "2020-01-01T00:00:00Z" }, false, null, send);
  assertEquals(sends, 0);
});
