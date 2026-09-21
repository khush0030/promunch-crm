import { assertEquals } from "jsr:@std/assert";
import { claimLossOutcome, isStaleDraft } from "./approve-guard.ts";

Deno.test("isStaleDraft: no expectation never blocks (Slack callers)", () => {
  assertEquals(isStaleDraft(undefined, "a"), false);
  assertEquals(isStaleDraft(null, "a"), false);
  assertEquals(isStaleDraft("", "a"), false);
});

Deno.test("isStaleDraft: blocks only when the shown revision is not current", () => {
  assertEquals(isStaleDraft("a", "a"), false);
  assertEquals(isStaleDraft("a", "b"), true);
});

Deno.test("claimLossOutcome: sent/sending read as already sent, anything else did not start", () => {
  assertEquals(claimLossOutcome("sent"), "already_sent");
  assertEquals(claimLossOutcome("sending"), "already_sent");
  assertEquals(claimLossOutcome("pending"), "not_started");
  assertEquals(claimLossOutcome("skipped"), "not_started");
  assertEquals(claimLossOutcome("failed"), "not_started");
  assertEquals(claimLossOutcome(null), "not_started");
  assertEquals(claimLossOutcome(undefined), "not_started");
});

import { mailboxRepliedAfter } from "./approve-guard.ts";

const ME = "hello@promunch.in";
const msg = (id: string, from: string, t: number, labelIds?: string[]) => ({
  gmailMessageId: id,
  fromEmail: from,
  internalDateMs: t,
  labelIds,
});

Deno.test("mailboxRepliedAfter: no mailbox message means not answered", () => {
  assertEquals(mailboxRepliedAfter([msg("a", "c@x.com", 100)], ME, "a"), false);
});

Deno.test("mailboxRepliedAfter: mailbox reply after the inbound counts", () => {
  const t = [msg("a", "c@x.com", 100), msg("b", ME, 200)];
  assertEquals(mailboxRepliedAfter(t, ME, "a"), true);
});

Deno.test("mailboxRepliedAfter: address match is case-insensitive", () => {
  const t = [msg("a", "c@x.com", 100), msg("b", "Hello@PROMUNCH.in", 200)];
  assertEquals(mailboxRepliedAfter(t, ME, "a"), true);
});

Deno.test("mailboxRepliedAfter: an earlier mailbox reply (before the new inbound) does not count", () => {
  const t = [msg("a", "c@x.com", 100), msg("b", ME, 200), msg("c", "c@x.com", 300)];
  assertEquals(mailboxRepliedAfter(t, ME, "c"), false);
});

Deno.test("mailboxRepliedAfter: Gmail drafts are ignored", () => {
  const t = [msg("a", "c@x.com", 100), msg("d", ME, 200, ["DRAFT"])];
  assertEquals(mailboxRepliedAfter(t, ME, "a"), false);
});

Deno.test("mailboxRepliedAfter: unknown inbound id falls back to latest non-mailbox message", () => {
  const answered = [msg("a", "c@x.com", 100), msg("b", ME, 200)];
  assertEquals(mailboxRepliedAfter(answered, ME, "gone"), true);
  const open = [msg("a", "c@x.com", 100), msg("b", ME, 200), msg("c", "c@x.com", 300)];
  assertEquals(mailboxRepliedAfter(open, ME, null), false);
});

Deno.test("mailboxRepliedAfter: thread with only mailbox messages counts as answered", () => {
  assertEquals(mailboxRepliedAfter([msg("b", ME, 200)], ME, "gone"), true);
});

Deno.test("mailboxRepliedAfter: same-millisecond mailbox message listed after the inbound counts", () => {
  const t = [msg("a", "c@x.com", 100), msg("b", ME, 100)];
  assertEquals(mailboxRepliedAfter(t, ME, "a"), true);
});

Deno.test("mailboxRepliedAfter: empty thread is not answered", () => {
  assertEquals(mailboxRepliedAfter([], ME, "a"), false);
});
