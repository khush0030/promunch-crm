// Pure helpers for Ask Maya → Saved answers. No I/O: the routes under
// /api/assistant/saved fetch and call these.

export type SavedAnswer = {
  id: string;
  name: string;
  question: string;
  answer: string | null;
  conversation_id: string | null;
  shared: boolean;
  pinned: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NewSavedAnswer = {
  name: string;
  question: string;
  answer: string | null;
  conversation_id: string | null;
  shared: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres 42P01 / PostgREST PGRST205: the table isn't there yet (the
// migration has to be pasted by hand). The UI then hides Save.
export function isMissingTable(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("assistant_saved_answers") && (m.includes("does not exist") || m.includes("could not find"));
}

export function parseSavedAnswer(body: unknown): { ok: true; row: NewSavedAnswer } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the answer as JSON." };
  const b = body as Record<string, unknown>;
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 2000) : "";
  if (!question) return { ok: false, error: "There is no question to save." };
  const rawName = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  const name = (rawName || question.replace(/\s+/g, " ")).slice(0, 120);
  const answer = typeof b.answer === "string" && b.answer.trim() ? b.answer.trim().slice(0, 20000) : null;
  const conv = typeof b.conversation_id === "string" && UUID_RE.test(b.conversation_id) ? b.conversation_id : null;
  return { ok: true, row: { name, question, answer, conversation_id: conv, shared: b.shared !== false } };
}

// Shared answers are for the whole team; private ones only for whoever saved them.
export function visibleTo(rows: SavedAnswer[], email: string | null): SavedAnswer[] {
  const me = (email ?? "").toLowerCase();
  return rows
    .filter((r) => r.shared || (!!me && (r.created_by ?? "").toLowerCase() === me))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
}

// Only the person who saved it may change or remove a saved answer; admins too.
export function canEdit(row: Pick<SavedAnswer, "created_by">, email: string | null, admin: boolean): boolean {
  if (admin) return true;
  return !!email && (row.created_by ?? "").toLowerCase() === email.toLowerCase();
}
