// Pure pre-send checks for Brevo campaigns (email and SMS). Every rule here
// exists to stop a campaign reaching customers by accident or twice. The
// atomic claim (brevo_campaign_sends primary key) is the last line; these
// checks run before it.

export type GuardInput = {
  channel: "email" | "sms";
  action: "send_now" | "schedule";
  status: string;
  modifiedAt: string | null;
  // modifiedAt values that have a recorded test send.
  testedVersions: string[];
  listIds: number[];
  exclusionListIds: number[];
  segmentIds: number[];
  listSizes: Map<number, number>;
  syncTarget: "test" | "live";
  testListId: number | null;
  confirmCount: number | null;
  scheduledAt: string | null;
  now: Date;
  smsEnabled: boolean;
  existingClaim: boolean;
};

export type GuardResult = { ok: true; recipientCount: number } | { ok: false; errors: string[]; recipientCount: number };

// Upper bound: lists can overlap and exclusions/blocklists shrink the real
// number, so the dialog says "up to".
export function recipientUpperBound(listIds: number[], sizes: Map<number, number>): number {
  return [...new Set(listIds)].reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0);
}

const SENDABLE = new Set(["draft", "suspended"]);

export function evaluateSendGuard(g: GuardInput): GuardResult {
  const errors: string[] = [];
  const recipientCount = recipientUpperBound(g.listIds, g.listSizes);

  if (g.existingClaim) errors.push("This campaign was already sent or scheduled from the dashboard.");
  if (!SENDABLE.has(g.status)) errors.push(`Campaign is "${g.status}". Only draft or suspended campaigns can be sent.`);
  if (g.channel === "sms" && !g.smsEnabled) errors.push("SMS sending is switched off (needs DLT sender ID and templates first).");
  if (g.listIds.length === 0 && g.segmentIds.length === 0) errors.push("Pick at least one list to send to.");
  if (g.segmentIds.length > 0 && g.syncTarget === "test") errors.push("Segments can't be used while sync is in test mode (they may include real customers).");
  if (!g.modifiedAt || !g.testedVersions.includes(g.modifiedAt)) {
    errors.push("Send a test of the current version first. Editing the campaign after a test needs a new test.");
  }
  if (g.syncTarget === "test") {
    if (!g.testListId) errors.push("Test mode: run a test sync first so the PROMUNCH TEST list exists.");
    else if (g.listIds.some((id) => id !== g.testListId)) errors.push("Test mode: campaigns can only go to the PROMUNCH TEST list until the owner switches sync to live.");
  }
  if (g.confirmCount == null || g.confirmCount !== recipientCount) {
    errors.push(`Confirm the recipient count (${recipientCount.toLocaleString("en-IN")}). It changed or wasn't confirmed.`);
  }
  if (g.action === "schedule") {
    const t = g.scheduledAt ? Date.parse(g.scheduledAt) : NaN;
    if (Number.isNaN(t)) errors.push("Pick a valid date and time to schedule.");
    else if (t < g.now.getTime() + 5 * 60_000) errors.push("Schedule at least 5 minutes ahead.");
  }
  return errors.length ? { ok: false, errors, recipientCount } : { ok: true, recipientCount };
}

// ---- campaign draft validation ------------------------------------------------

export type EmailDraftInput = {
  name?: unknown;
  subject?: unknown;
  previewText?: unknown;
  senderId?: unknown;
  replyTo?: unknown;
  htmlContent?: unknown;
  templateId?: unknown;
  listIds?: unknown;
  exclusionListIds?: unknown;
  tag?: unknown;
  utmCampaign?: unknown;
};

export type EmailDraft = {
  name: string;
  subject: string;
  previewText?: string;
  sender: { id: number };
  replyTo?: string;
  htmlContent?: string;
  templateId?: number;
  recipients: { listIds: number[]; exclusionListIds?: number[] };
  tag?: string;
  utmCampaign?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && x > 0))] : []);

// Brand rule: em dashes are banned in customer-facing copy.
export function copyProblems(text: string): string[] {
  const p: string[] = [];
  if (text.includes("—")) p.push("contains an em dash (not allowed in PROMUNCH copy)");
  if (/\bpromunch\b/.test(text) || /\bProMunch\b|\bPromunch\b/.test(text)) p.push('brand name must be written "PROMUNCH"');
  if (/oltaflock/i.test(text)) p.push('mentions "Oltaflock"');
  return p;
}

// Strips tags/URLs so brand checks don't trip on promunch.in links or HTML attributes.
export function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[\w.-]+@[\w.-]+\b/g, " ")
    .replace(/@[\w][\w.]*/g, " ")
    .replace(/\bpromunch\.in\b|\btrypromunch\.in\b/gi, " ")
    .replace(/&nbsp;/g, " ");
}

export function validateEmailDraft(b: EmailDraftInput, partial = false): { ok: true; draft: Partial<EmailDraft> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const d: Partial<EmailDraft> = {};
  const text = (k: keyof EmailDraftInput, max: number, required: boolean) => {
    const v = b[k];
    if (v === undefined) {
      if (required && !partial) errors.push(`${k} is required`);
      return undefined;
    }
    if (typeof v !== "string") {
      errors.push(`${k} must be text`);
      return undefined;
    }
    const s = v.trim();
    if (required && !s) errors.push(`${k} can't be empty`);
    if (s.length > max) errors.push(`${k} is too long (max ${max})`);
    return s;
  };

  const name = text("name", 200, true);
  if (name !== undefined) d.name = name;
  const subject = text("subject", 250, true);
  if (subject !== undefined) {
    d.subject = subject;
    for (const p of copyProblems(visibleText(subject))) errors.push(`subject ${p}`);
  }
  const preview = text("previewText", 250, false);
  if (preview !== undefined) {
    d.previewText = preview;
    for (const p of copyProblems(visibleText(preview))) errors.push(`preview text ${p}`);
  }
  if (b.senderId !== undefined) {
    if (!Number.isInteger(b.senderId)) errors.push("senderId must be a sender id");
    else d.sender = { id: b.senderId as number };
  } else if (!partial) errors.push("senderId is required");
  const replyTo = text("replyTo", 200, false);
  if (replyTo) {
    if (!EMAIL_RE.test(replyTo)) errors.push("replyTo must be an email");
    else d.replyTo = replyTo;
  }
  if (b.htmlContent !== undefined && b.templateId !== undefined && b.templateId !== null && b.htmlContent !== "") {
    errors.push("use either htmlContent or templateId, not both");
  }
  if (typeof b.htmlContent === "string" && b.htmlContent.trim()) {
    if (b.htmlContent.length > 1_000_000) errors.push("htmlContent is too large");
    d.htmlContent = b.htmlContent;
    for (const p of copyProblems(visibleText(b.htmlContent))) errors.push(`email body ${p}`);
  }
  if (b.templateId !== undefined && b.templateId !== null) {
    if (!Number.isInteger(b.templateId)) errors.push("templateId must be a template id");
    else d.templateId = b.templateId as number;
  }
  if (!partial && !d.htmlContent && !d.templateId) errors.push("add email content (HTML or a Brevo template)");
  if (b.listIds !== undefined || !partial) {
    const listIds = ids(b.listIds);
    d.recipients = { listIds, ...(b.exclusionListIds !== undefined ? { exclusionListIds: ids(b.exclusionListIds) } : {}) };
  }
  const tag = text("tag", 100, false);
  if (tag) d.tag = tag;
  const utm = text("utmCampaign", 100, false);
  if (utm) {
    if (!/^[\w-]+$/.test(utm)) errors.push("utmCampaign may use letters, numbers, - and _ only");
    else d.utmCampaign = utm;
  }
  return errors.length ? { ok: false, errors } : { ok: true, draft: d };
}
