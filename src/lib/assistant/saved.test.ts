import { describe, it, expect } from "vitest";
import { canEdit, isMissingTable, parseSavedAnswer, visibleTo, type SavedAnswer } from "./saved";

const row = (p: Partial<SavedAnswer>): SavedAnswer => ({
  id: "1",
  name: "n",
  question: "q",
  answer: null,
  conversation_id: null,
  shared: true,
  pinned: false,
  created_by: "a@promunch.in",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...p,
});

describe("parseSavedAnswer", () => {
  it("names it after the question when no name is given, shared by default", () => {
    expect(parseSavedAnswer({ question: "  Why are sales up this week? ", answer: "Because…", conversation_id: "nope" })).toEqual({
      ok: true,
      row: { name: "Why are sales up this week?", question: "Why are sales up this week?", answer: "Because…", conversation_id: null, shared: true },
    });
  });
  it("keeps a custom name, a valid conversation id and a private flag", () => {
    const r = parseSavedAnswer({ question: "q", name: "COD savings", shared: false, conversation_id: "123e4567-e89b-12d3-a456-426614174000" });
    expect(r.ok && r.row).toMatchObject({ name: "COD savings", shared: false, conversation_id: "123e4567-e89b-12d3-a456-426614174000" });
  });
  it("needs a question", () => {
    expect(parseSavedAnswer({ name: "x" }).ok).toBe(false);
    expect(parseSavedAnswer(null).ok).toBe(false);
  });
});

describe("visibleTo", () => {
  it("shows shared answers and my private ones, pinned first then newest", () => {
    const rows = [
      row({ id: "old", created_at: "2026-09-01T00:00:00Z" }),
      row({ id: "mine-private", shared: false, created_by: "Me@promunch.in" }),
      row({ id: "theirs-private", shared: false, created_by: "x@promunch.in" }),
      row({ id: "pinned", pinned: true, created_at: "2026-08-01T00:00:00Z" }),
    ];
    expect(visibleTo(rows, "me@promunch.in").map((r) => r.id)).toEqual(["pinned", "mine-private", "old"]);
  });
});

describe("canEdit and isMissingTable", () => {
  it("lets the saver or an admin change it", () => {
    expect(canEdit({ created_by: "a@promunch.in" }, "A@promunch.in", false)).toBe(true);
    expect(canEdit({ created_by: "a@promunch.in" }, "b@promunch.in", false)).toBe(false);
    expect(canEdit({ created_by: "a@promunch.in" }, "b@promunch.in", true)).toBe(true);
  });
  it("spots a table that hasn't been created yet", () => {
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isMissingTable({ message: 'relation "assistant_saved_answers" does not exist' })).toBe(true);
    expect(isMissingTable({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
