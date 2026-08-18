import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { safeMessageType, WA_MESSAGE_TYPES } from "./wa-message-types.ts";

// Drift guard. A type the code accepts but the constraint rejects is not a type
// error, it is a dropped customer message: the insert throws, wa-webhook bails,
// and the AI reply / opt-out / COD button tap in that turn is lost. Read the
// constraint straight out of the migration and diff it against the code list.
Deno.test("wa_messages type allowlist matches the DB check constraint", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../migrations/20260818200000_wa_messages_type_widen.sql", import.meta.url),
  );
  const body = sql.slice(sql.lastIndexOf("check (type in ("));
  const fromSql = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assertEquals(
    [...fromSql].sort(),
    [...WA_MESSAGE_TYPES].sort(),
    "wa-message-types.ts and wa_messages_type_check have drifted — a message type one side accepts and the other rejects drops the whole inbound turn",
  );
});

Deno.test("safeMessageType: known types pass through, unknown clamps", () => {
  assertEquals(safeMessageType("button"), "button");
  assertEquals(safeMessageType("order"), "order");
  assertEquals(safeMessageType("text"), "text");
  // whatever Meta ships next
  assertEquals(safeMessageType("payment_transaction"), "unsupported");
  assertEquals(safeMessageType(""), "unsupported");
});
