// Pure helpers for campaign journeys (follow-ups): stage wording, delay
// formatting and checks, the plain rule sentences, and turning flat campaign
// lists into parent -> follow-up trees. No React, no fetch (journey.test.ts).
//
// A follow-up is an ordinary campaign linked to its parent with
// followup_of + followup_after_hours + followup_stage. Copy rules: PROMUNCH in
// caps, no em dashes, plain English.

import { isAutomationTemplate } from "@/lib/whatsapp/templateKind";
import type { Campaign, FollowupStage } from "../types";
import { campaignTemplates, contentProblems, statusMeta, type CampaignTemplate, type Tone } from "./logic";

export const MAX_WIZARD_FOLLOWUPS = 3;
export const MAX_JOURNEY_FOLLOWUPS = 5;
export const MAX_JOURNEY_DEPTH = 3;
export const MIN_DELAY_HOURS = 1;
export const MAX_DELAY_HOURS = 720; // 30 days

/* ------------------------------------------------------------------------ */
/* Stages                                                                     */
/* ------------------------------------------------------------------------ */

export type StageMeta = {
  key: FollowupStage;
  /** Finishes "to people who ...". */
  who: string;
  /** One plain line under the picker. */
  description: string;
  /** Only works when the parent message has a tracked link. */
  needsTrackedLink?: boolean;
};

export const FOLLOWUP_STAGES: StageMeta[] = [
  { key: "not_read", who: "got it but didn't read it", description: "Got it but didn't open it. A gentle reminder often gets read." },
  { key: "read", who: "read it", description: "Opened it. Good for a next step, like a bigger offer." },
  { key: "read_no_reply", who: "read it but didn't reply", description: "Opened it but didn't write back. Try a question they can answer in one word." },
  { key: "delivered", who: "got it", description: "Everyone who got it, whatever they did next." },
  { key: "replied", who: "replied", description: "Wrote back to us after getting it." },
  { key: "clicked", who: "tapped the link", description: "Tapped the link button in the message.", needsTrackedLink: true },
  { key: "not_clicked", who: "got it but didn't tap the link", description: "Got it but didn't tap the link button.", needsTrackedLink: true },
  { key: "ordered", who: "bought something after getting it", description: "Placed a paid order after getting it. Nice for a thank you." },
  { key: "not_ordered", who: "got it but didn't buy", description: "Got it but haven't placed an order since." },
];

export function stageMeta(stage: string | null | undefined): StageMeta | null {
  return FOLLOWUP_STAGES.find((x) => x.key === stage) ?? null;
}

export function stageDescription(stage: string | null | undefined): string {
  return stageMeta(stage)?.description ?? "";
}

/** "people who read it" */
export function stageWho(stage: string | null | undefined): string {
  const m = stageMeta(stage);
  return m ? `people who ${m.who}` : "people from the first message";
}

type ButtonLike = { type?: string | null; url?: string | null };

/** True when the message has a link button we count taps on (/r/{{1}}). */
export function hasTrackedLink(tpl: { buttons?: ButtonLike[] | null } | null | undefined): boolean {
  const buttons = Array.isArray(tpl?.buttons) ? tpl!.buttons! : [];
  return buttons.some((b) => String(b?.type ?? "").toUpperCase() === "URL" && /\/r\/\{\{\s*1\s*\}\}/.test(String(b?.url ?? "")));
}

/** null when the stage can be picked, else the plain reason it can't. */
export function stageDisabledReason(stage: FollowupStage, parentTpl: { buttons?: ButtonLike[] | null } | null | undefined): string | null {
  if (stageMeta(stage)?.needsTrackedLink && !hasTrackedLink(parentTpl)) {
    return "Only for messages with a tracked link button. The first message has none, so we can't tell who tapped.";
  }
  return null;
}

/** Status wording for a follow-up (same statuses, different meaning for two). */
export function followupStatusMeta(status: string): { label: string; tone: Tone; hint: string } {
  if (status === "draft") return { label: "Draft", tone: "neu", hint: "Turns on by itself when the first message is launched." };
  if (status === "scheduled") return { label: "Waiting", tone: "info", hint: "On. It sends by itself as each person reaches their time." };
  if (status === "completed") return { label: "Completed", tone: "good", hint: "Everyone who fitted the rule has been handled." };
  return statusMeta(status);
}

/* ------------------------------------------------------------------------ */
/* Delay                                                                      */
/* ------------------------------------------------------------------------ */

export type DelayUnit = "hours" | "days";

export function toHours(amount: number, unit: DelayUnit): number {
  return unit === "days" ? amount * 24 : amount;
}

/** Hours -> the friendliest amount + unit for the picker. */
export function fromHours(hours: number): { amount: number; unit: DelayUnit } {
  if (hours >= 24 && hours % 24 === 0) return { amount: hours / 24, unit: "days" };
  return { amount: hours, unit: "hours" };
}

/** 48 -> "2 days", 1 -> "1 hour", 30 -> "30 hours". */
export function formatDelay(hours: number | null | undefined): string {
  const h = Math.max(0, Math.round(Number(hours ?? 0)));
  const { amount, unit } = fromHours(h);
  const word = unit === "days" ? "day" : "hour";
  return `${amount} ${word}${amount === 1 ? "" : "s"}`;
}

/** Plain problems with a typed delay (empty when fine). */
export function delayProblems(amount: number | string, unit: DelayUnit): string[] {
  const n = typeof amount === "number" ? amount : Number(String(amount).trim());
  if (String(amount).trim() === "" || !Number.isFinite(n)) return ["Type how long to wait, for example 2."];
  if (!Number.isInteger(n) || n < 1) return ["Use a whole number, 1 or more."];
  const h = toHours(n, unit);
  if (h > MAX_DELAY_HOURS) return ["The longest wait is 30 days."];
  if (h < MIN_DELAY_HOURS) return ["Wait at least 1 hour."];
  return [];
}

/** Heads-up for short waits (the 1 marketing message a day rule). */
export function delayWarning(hours: number): string | null {
  if (hours > 0 && hours < 24) {
    return "They will get it the next day at the earliest, because of the 1 message a day rule. Nothing goes out at night either.";
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Sentences                                                                  */
/* ------------------------------------------------------------------------ */

/** "2 days after each person gets it, people who read it get "Diwali reminder"." */
export function followupRuleSentence(r: { hours: number | null | undefined; stage: string | null | undefined; templateName?: string | null }): string {
  const tail = r.templateName ? ` get "${r.templateName}"` : " get the follow-up";
  return `${formatDelay(r.hours)} after each person gets it, ${stageWho(r.stage)}${tail}.`;
}

/** "Follow-up · after 2 days · people who read it" */
export function followupShortLabel(hours: number | null | undefined, stage: string | null | undefined): string {
  return `Follow-up · after ${formatDelay(hours)} · ${stageWho(stage)}`;
}

/** Auto name: "<parent name>: follow-up 2". */
export function followupName(parentName: string, index: number): string {
  return `${parentName.trim() || "Campaign"}: follow-up ${index}`;
}

/* ------------------------------------------------------------------------ */
/* Templates a follow-up may use (same rule as the template step)             */
/* ------------------------------------------------------------------------ */

export function followupTemplates<T extends { name: string; category?: string | null }>(list: T[]): T[] {
  return campaignTemplates(list).filter((t) => !isAutomationTemplate(t.name));
}

/* ------------------------------------------------------------------------ */
/* Wizard drafts                                                              */
/* ------------------------------------------------------------------------ */

export type FollowupDraft = {
  /** Local key (stable across saves). */
  key: string;
  /** Server id once saved. */
  id?: string | null;
  amount: string;
  unit: DelayUnit;
  stage: FollowupStage;
  templateId: string | null;
  vars: Record<string, string>;
  mediaUrl: string | null;
};

export type Suggestion = { key: string; title: string; hint: string; stage: FollowupStage; hours: number };

export const FOLLOWUP_SUGGESTIONS: Suggestion[] = [
  { key: "remind", title: "Remind people who didn't read it, after 2 days", hint: "A short, different message often gets read the second time.", stage: "not_read", hours: 48 },
  { key: "thanks", title: "Thank people who ordered", hint: "3 days after the message, a thank you to everyone who bought.", stage: "ordered", hours: 72 },
];

let seq = 0;
export function newDraftKey(): string {
  seq += 1;
  return `fu-${Date.now().toString(36)}-${seq}`;
}

export function draftFromSuggestion(sg: Pick<Suggestion, "stage" | "hours">, key = newDraftKey()): FollowupDraft {
  const { amount, unit } = fromHours(sg.hours);
  return { key, id: null, amount: String(amount), unit, stage: sg.stage, templateId: null, vars: {}, mediaUrl: null };
}

export function draftHours(d: Pick<FollowupDraft, "amount" | "unit">): number | null {
  return delayProblems(d.amount, d.unit).length ? null : toHours(Number(d.amount), d.unit);
}

/** Everything wrong with one follow-up, as { field, message }. */
export function followupProblems(
  d: FollowupDraft,
  tpl: CampaignTemplate | null,
  parentTpl: { buttons?: ButtonLike[] | null } | null | undefined,
): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = delayProblems(d.amount, d.unit).map((m) => ({ field: "delay", message: m }));
  const why = stageDisabledReason(d.stage, parentTpl);
  if (why) out.push({ field: "stage", message: why });
  if (!tpl) return [...out, { field: "template", message: d.templateId ? "That message can't be used any more. Pick another one." : "Pick the message to send." }];
  // Name is automatic for follow-ups; AI personalisation is off.
  return [...out, ...contentProblems(tpl, d.vars, { mediaUrl: d.mediaUrl, ai: false, brief: "", name: "follow-up" })];
}

/** Rebuild a draft from a saved follow-up row. */
export function draftFromCampaign(c: Pick<Campaign, "id" | "followup_after_hours" | "followup_stage" | "template_id" | "template_vars" | "header_media_url">, copy = false): FollowupDraft {
  const { amount, unit } = fromHours(c.followup_after_hours ?? 48);
  const vars = { ...(c.template_vars ?? {}) };
  delete vars._ai_brief;
  return {
    key: copy ? newDraftKey() : `fu-${c.id}`,
    id: copy ? null : c.id,
    amount: String(amount),
    unit,
    stage: (c.followup_stage ?? "not_read") as FollowupStage,
    templateId: c.template_id,
    vars,
    mediaUrl: c.header_media_url ?? null,
  };
}

/* ------------------------------------------------------------------------ */
/* Trees                                                                      */
/* ------------------------------------------------------------------------ */

export type TreeNode<T> = { item: T; depth: number; children: TreeNode<T>[] };

type Linked = { id: string; followup_of?: string | null; created_at?: string | null };

const byCreated = <T extends Linked>(a: T, b: T) => (Date.parse(a.created_at ?? "") || 0) - (Date.parse(b.created_at ?? "") || 0);

/**
 * Flat list -> forest. A row whose parent isn't in the list is a root.
 * Children are ordered oldest first; roots keep the list's own order.
 * Cycles (bad data) are broken by treating the repeat as a root.
 */
export function buildTree<T extends Linked>(list: T[]): TreeNode<T>[] {
  const ids = new Set(list.map((x) => x.id));
  const kids = new Map<string, T[]>();
  for (const x of list) {
    if (x.followup_of && ids.has(x.followup_of) && x.followup_of !== x.id) {
      const arr = kids.get(x.followup_of) ?? [];
      arr.push(x);
      kids.set(x.followup_of, arr);
    }
  }
  const seen = new Set<string>();
  const grow = (x: T, depth: number): TreeNode<T> => {
    seen.add(x.id);
    const children = [...(kids.get(x.id) ?? [])].sort(byCreated).filter((c) => !seen.has(c.id)).map((c) => grow(c, depth + 1));
    return { item: x, depth, children };
  };
  const roots = list.filter((x) => !(x.followup_of && ids.has(x.followup_of) && x.followup_of !== x.id));
  const out = roots.map((r) => grow(r, 0));
  for (const x of list) if (!seen.has(x.id)) out.push(grow(x, 0)); // cycle leftovers
  return out;
}

/** Depth-first, parent before its follow-ups. */
export function flattenTree<T>(nodes: TreeNode<T>[]): { item: T; depth: number }[] {
  const out: { item: T; depth: number }[] = [];
  const walk = (n: TreeNode<T>) => {
    out.push({ item: n.item, depth: n.depth });
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/**
 * For the campaigns list: keep a whole journey when any step matches, show
 * the matching steps plus the parents they hang from (so a follow-up is never
 * shown without context). Returns flattened rows with depth.
 */
export function filterJourneyList<T extends Linked>(list: T[], matches: (x: T) => boolean): { item: T; depth: number }[] {
  const prune = (n: TreeNode<T>): TreeNode<T> | null => {
    const children = n.children.map(prune).filter((c): c is TreeNode<T> => c != null);
    if (!matches(n.item) && children.length === 0) return null;
    return { ...n, children };
  };
  return flattenTree(buildTree(list).map(prune).filter((n): n is TreeNode<T> => n != null));
}

/** How many follow-ups hang under this campaign (all levels). */
export function descendantCount<T extends Linked>(list: T[], id: string): number {
  const tree = buildTree(list);
  const find = (ns: TreeNode<T>[]): TreeNode<T> | null => {
    for (const n of ns) {
      if (n.item.id === id) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const n = find(tree);
  return n ? flattenTree(n.children).length : 0;
}

/* ------------------------------------------------------------------------ */
/* Exact copies (the server refuses them with a 409)                          */
/* ------------------------------------------------------------------------ */

export type JourneyMessage = {
  template_id?: string | null;
  template_vars?: Record<string, unknown> | null;
  header_media_url?: string | null;
};

// Same normalisation as the server (src/lib/wa-campaigns.ts): strings
// trimmed, key order ignored, empty picture = the template's own.
export function normalizeVars(v: unknown): string {
  const canon = (x: unknown): unknown => {
    if (typeof x === "string") return x.trim();
    if (Array.isArray(x)) return x.map(canon);
    if (x && typeof x === "object") {
      return Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])]));
    }
    return x ?? null;
  };
  const c = canon(v ?? {});
  return JSON.stringify(c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0 ? {} : c);
}

function effectiveMedia(override: string | null | undefined, templateDefault: string | null | undefined): string | null {
  return (override ?? "").trim() || (templateDefault ?? "").trim() || null;
}

/** Same template, same blanks, same picture. */
export function sameJourneyMessage(a: JourneyMessage, b: JourneyMessage, templateDefaultMedia?: string | null): boolean {
  if (!a.template_id || a.template_id !== b.template_id) return false;
  return (
    normalizeVars(a.template_vars) === normalizeVars(b.template_vars) &&
    effectiveMedia(a.header_media_url, templateDefaultMedia) === effectiveMedia(b.header_media_url, templateDefaultMedia)
  );
}

/**
 * Which messages are exact copies of an earlier one: the main message is
 * "the main message", earlier follow-ups are "follow-up N". Returns key ->
 * plain warning (only the later copy is flagged).
 */
export function duplicateWarnings(
  main: JourneyMessage | null,
  followups: { key: string; msg: JourneyMessage }[],
  defaultMedia: (templateId: string) => string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  followups.forEach((f, i) => {
    if (!f.msg.template_id) return;
    const dm = defaultMedia(f.msg.template_id);
    let hit: string | null = null;
    if (main && sameJourneyMessage(f.msg, main, dm)) hit = "the main message";
    else {
      const j = followups.slice(0, i).findIndex((o) => sameJourneyMessage(f.msg, o.msg, dm));
      if (j >= 0) hit = `follow-up ${j + 1}`;
    }
    if (hit) out[f.key] = `This is exactly the same as ${hit}. Change the picture or the text, or pick another message.`;
  });
  return out;
}
