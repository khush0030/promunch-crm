// Pure validation for Brevo SMS campaigns. SMS stays switched off
// (brevo_settings.sms_enabled) until India DLT sender ID + templates exist.

import { copyProblems } from "./brevo-send-guard";

export type SmsDraft = {
  name: string;
  sender: string;
  content: string;
  recipients?: { listIds: number[]; exclusionListIds?: number[] };
  unicodeEnabled?: boolean;
  unsubscribeInstruction?: string;
};

const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && x > 0))] : []);

/** GSM-7 is 160 chars per SMS (153 when split); unicode is 70 (67). */
export function smsParts(content: string, unicode: boolean): number {
  const len = [...content].length;
  if (len === 0) return 0;
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return len <= single ? 1 : Math.ceil(len / multi);
}

export function validateSmsDraft(b: Record<string, unknown>, partial = false): { ok: true; draft: Partial<SmsDraft> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const d: Partial<SmsDraft> = {};
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : undefined);

  const name = str("name");
  if (name !== undefined) {
    if (!name) errors.push("name can't be empty");
    else d.name = name.slice(0, 200);
  } else if (!partial) errors.push("name is required");

  const sender = str("sender");
  if (sender !== undefined) {
    if (!/^[A-Za-z0-9]{3,11}$/.test(sender) && !/^\d{3,15}$/.test(sender)) errors.push("sender: 3 to 11 letters/numbers (your DLT header)");
    else d.sender = sender;
  } else if (!partial) errors.push("sender is required");

  const content = typeof b.content === "string" ? b.content : undefined;
  if (content !== undefined) {
    if (!content.trim()) errors.push("message can't be empty");
    if ([...content].length > 1000) errors.push("message is too long (max 1000 characters)");
    for (const p of copyProblems(content)) errors.push(`message ${p}`);
    d.content = content;
  } else if (!partial) errors.push("message is required");

  if (typeof b.unicodeEnabled === "boolean") d.unicodeEnabled = b.unicodeEnabled;

  // Marketing messages always carry an opt-out (same rule as WhatsApp templates).
  const unsub = str("unsubscribeInstruction");
  if (unsub !== undefined || !partial) {
    const u = unsub || "Reply STOP to opt out";
    if (!/\bSTOP\b/.test(u)) errors.push('opt-out text must include "STOP"');
    else d.unsubscribeInstruction = u;
  }

  if (b.listIds !== undefined || !partial) {
    d.recipients = { listIds: ids(b.listIds), ...(b.exclusionListIds !== undefined ? { exclusionListIds: ids(b.exclusionListIds) } : {}) };
  }
  return errors.length ? { ok: false, errors } : { ok: true, draft: d };
}
