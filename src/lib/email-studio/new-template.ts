// Pure body builder for Email → Templates → "New template". The existing
// POST /api/email-studio/templates copies a built-in design when given
// `fromSystem`, so a new template is a named copy of a starting point
// ("blank" = logo, heading, text, button). No I/O here.

export const BLANK_START = "blank";

export function newTemplateBody(
  rawName: string,
  start: string,
  validStarts: readonly string[],
): { ok: true; body: { name: string; fromSystem: string; category: "custom" } } | { ok: false; error: string } {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) return { ok: false, error: "Give the template a name." };
  const fromSystem = validStarts.includes(start) ? start : BLANK_START;
  return { ok: true, body: { name, fromSystem, category: "custom" } };
}
