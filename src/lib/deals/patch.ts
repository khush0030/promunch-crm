// Pure: a drawer/board edit (PATCH /api/deals/[id]) -> a deals update plus
// the activity entries it should leave behind. No I/O.
//
// Every human edit that touches what the scanner also writes (stage, next
// step, follow-up) stamps human_touched_at, so deal-scan leaves it alone
// until a new inbound email arrives after that moment.

import { STAGE_LABEL, isClosedStage, normalizeStage } from "./stages";
import { normalizePhone, parseKind, parseRupees, shortDay, type Deal } from "./model";
import { EMAIL_RE, text, validDate, workDomain } from "./create";

export type ActivityDraft = { kind: "stage" | "system"; body: string };

export type DealPatch = {
  patch: Record<string, unknown>;
  activities: ActivityDraft[];
};

export function parseDealPatch(
  body: unknown,
  current: Deal,
  now: Date = new Date(),
): { ok: true; value: DealPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the change as JSON." };
  const b = body as Record<string, unknown>;
  const iso = now.toISOString();
  const patch: Record<string, unknown> = {};
  const activities: ActivityDraft[] = [];
  let humanDecision = false;

  if ("company_name" in b) {
    const c = text(b.company_name, 200);
    if (!c) return { ok: false, error: "The business name can't be empty." };
    patch.company_name = c;
  }
  if ("contact_name" in b) patch.contact_name = text(b.contact_name, 120);
  if ("contact_email" in b) {
    const e = text(b.contact_email, 200)?.toLowerCase() ?? null;
    if (e && !EMAIL_RE.test(e)) return { ok: false, error: "That email doesn't look right." };
    patch.contact_email = e;
    if (e && !current.company_domain) {
      const d = workDomain(e);
      if (d) patch.company_domain = d;
    }
  }
  if ("contact_phone" in b) {
    const raw = text(b.contact_phone, 40);
    const p = raw ? normalizePhone(raw) : null;
    if (raw && !p) return { ok: false, error: "That phone number doesn't look right." };
    patch.contact_phone = p;
  }
  if ("kind" in b) {
    const k = parseKind(b.kind);
    if (!k) return { ok: false, error: "Pick a type from the list." };
    patch.kind = k;
    patch.manual_kind_override = true;
  }
  if ("owner_email" in b) {
    const o = text(b.owner_email, 200)?.toLowerCase() ?? null;
    if (o && !EMAIL_RE.test(o)) return { ok: false, error: "Pick an owner from the team list." };
    patch.owner_email = o;
  }
  if ("value_inr" in b || "value" in b) {
    const raw = b.value_inr ?? b.value;
    if (raw == null || raw === "") patch.value_inr = null;
    else {
      const v = parseRupees(raw);
      if (v == null) return { ok: false, error: "Type the value as a number of rupees, like 50000 or 1.5L." };
      patch.value_inr = v;
    }
  }

  if ("stage" in b) {
    const s = normalizeStage(b.stage);
    if (!s) return { ok: false, error: "Pick a stage from the list." };
    if (s !== current.stage) {
      const reason = text(b.reason, 300);
      if (isClosedStage(s) && !reason) {
        return { ok: false, error: `Add a short reason for ${STAGE_LABEL[s]}.` };
      }
      patch.stage = s;
      patch.stage_updated_at = iso;
      patch.manual_stage_override = true;
      patch.closed_reason = isClosedStage(s) ? reason : null;
      if (s === "won" || s === "lost") {
        // nothing left to chase
        patch.follow_up_needed = false;
        patch.follow_up_reason = null;
      }
      activities.push({
        kind: "stage",
        body: `Moved from ${STAGE_LABEL[current.stage]} to ${STAGE_LABEL[s]}${reason ? `: ${reason}` : ""}`,
      });
      humanDecision = true;
    }
  }

  if ("next_step" in b) {
    const n = text(b.next_step, 500);
    patch.next_step = n;
    patch.next_step_owner = n ? "us" : current.next_step_owner;
    humanDecision = true;
  }
  if ("next_step_owner" in b) {
    const o = b.next_step_owner;
    if (o !== "us" && o !== "them" && o !== null) return { ok: false, error: "Who acts next: us or them." };
    patch.next_step_owner = o;
    humanDecision = true;
  }

  if ("follow_up_at" in b) {
    if (b.follow_up_at == null || b.follow_up_at === "") patch.follow_up_at = null;
    else {
      const d = validDate(b.follow_up_at);
      if (!d) return { ok: false, error: "Pick a real follow-up date." };
      patch.follow_up_at = d;
    }
    // A date replaces any automatic flag: the date now decides.
    patch.follow_up_needed = false;
    patch.follow_up_reason = null;
    humanDecision = true;
  }

  // "Done" on the next step: log it, clear the step and the follow-up.
  if (b.done === true) {
    const step = current.next_step ?? current.follow_up_reason ?? "Follow-up";
    activities.push({ kind: "system", body: `Done: ${step}` });
    if (!("next_step" in b)) patch.next_step = null;
    if (!("follow_up_at" in b)) patch.follow_up_at = null;
    patch.follow_up_needed = false;
    patch.follow_up_reason = null;
    humanDecision = true;
  }

  if (typeof b.follow_up_needed === "boolean") {
    patch.follow_up_needed = b.follow_up_needed;
    if (!b.follow_up_needed) patch.follow_up_reason = null;
    humanDecision = true;
  }

  if (Object.keys(patch).length === 0 && activities.length === 0) {
    return { ok: false, error: "Nothing to change." };
  }
  if (humanDecision) patch.human_touched_at = iso;

  if ("follow_up_at" in patch && patch.follow_up_at && b.done !== true) {
    activities.push({ kind: "system", body: `Follow-up set for ${shortDay(patch.follow_up_at as string)}` });
  }
  return { ok: true, value: { patch, activities } };
}
