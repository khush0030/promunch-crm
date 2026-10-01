// Pre-send checks shown on the Review step. "block" issues disable Send;
// "warn" issues are advice. Enforces AGENTS.md §5 copy rules on everything
// the employee typed: PROMUNCH in caps, no em dashes, never "Oltaflock".
//
// Keep imports relative: vitest has no "@/" alias.

import type { Block, EmailDesign } from "./design";

export type Issue = { level: "block" | "warn"; message: string; blockId?: string };

/** Every piece of customer-visible copy in a block (not URLs). */
function blockCopy(b: Block): string[] {
  switch (b.type) {
    case "heading":
    case "text":
      return [b.text.replace(/\]\([^)]*\)/g, "]")]; // drop link targets
    case "button":
      return [b.label];
    case "image":
      return [b.alt];
    case "products":
      return [b.buttonLabel];
    case "coupon":
      return [b.headline, b.note];
    default:
      return [];
  }
}

export function copyIssues(label: string, text: string, blockId?: string): Issue[] {
  const out: Issue[] = [];
  if (/[—–]/.test(text)) out.push({ level: "block", message: `${label}: remove the dash (— or –). Use a comma, full stop or "to".`, blockId });
  if (/oltaflock/i.test(text)) out.push({ level: "block", message: `${label}: never mention Oltaflock in PROMUNCH copy.`, blockId });
  // "promunch" in copy must be all caps. Ignore technical identifiers: domains
  // (promunch.in), handles (@promunch.snacks) and emails (hello@promunch.in).
  const bad = text.match(/(?<![@\w.])promunch\b(?!\.[a-z])/gi)?.filter((m) => m !== "PROMUNCH");
  if (bad && bad.length) out.push({ level: "block", message: `${label}: write the brand as PROMUNCH (all caps).`, blockId });
  return out;
}

function urlOk(u: string): boolean {
  return /^(https?:\/\/[^\s]+\.[^\s]+|mailto:[^\s]+@[^\s]+)$/i.test(u.trim());
}

export function checkEmail(input: {
  subject: string;
  previewText: string;
  design: EmailDesign;
  knownProducts?: Set<string>;
}): Issue[] {
  const { subject, previewText, design } = input;
  const issues: Issue[] = [];

  if (!subject.trim()) issues.push({ level: "block", message: "Add a subject line." });
  else {
    issues.push(...copyIssues("Subject", subject));
    if (subject.length > 60) issues.push({ level: "warn", message: `Subject is ${subject.length} characters. Under 50 reads fully on phones.` });
    const letters = subject.replace(/[^A-Za-z]/g, "");
    const caps = subject.replace(/PROMUNCH/g, "").replace(/[^A-Z]/g, "").length;
    if (letters.length > 8 && caps / letters.length > 0.6) issues.push({ level: "warn", message: "Subject is mostly CAPITALS. Spam filters dislike that." });
    if (/!{2,}|\$\$|100% free|act now|click here/i.test(subject)) issues.push({ level: "warn", message: "Subject has spam-trigger wording (!!, 'click here', 'act now')." });
  }
  if (!previewText.trim()) issues.push({ level: "warn", message: "Add preview text. It shows next to the subject in the inbox." });
  else issues.push(...copyIssues("Preview text", previewText));

  if (design.blocks.length === 0) issues.push({ level: "block", message: "The email is empty. Add some blocks." });

  let hasLink = false;
  design.blocks.forEach((b, i) => {
    const label = `Block ${i + 1} (${b.type})`;
    for (const c of blockCopy(b)) issues.push(...copyIssues(label, c, b.id));
    switch (b.type) {
      case "button":
        if (!b.label.trim()) issues.push({ level: "block", message: `${label}: the button has no text.`, blockId: b.id });
        if (!urlOk(b.href)) issues.push({ level: "block", message: `${label}: the button link is missing or not a full https:// address.`, blockId: b.id });
        else hasLink = true;
        break;
      case "image":
        if (!b.src) issues.push({ level: "block", message: `${label}: choose or upload an image.`, blockId: b.id });
        if (!b.alt.trim()) issues.push({ level: "warn", message: `${label}: add a short image description (shown when images are off).`, blockId: b.id });
        if (b.href && !urlOk(b.href)) issues.push({ level: "block", message: `${label}: the image link is not a full https:// address.`, blockId: b.id });
        if (b.href) hasLink = true;
        break;
      case "products":
        if (b.items.length === 0) issues.push({ level: "block", message: `${label}: pick at least one product.`, blockId: b.id });
        else hasLink = true;
        if (input.knownProducts) {
          const gone = b.items.filter((id) => !input.knownProducts!.has(id));
          if (gone.length) issues.push({ level: "warn", message: `${label}: ${gone.length} product(s) are sold out or removed and will be skipped.`, blockId: b.id });
        }
        break;
      case "coupon":
        if (!b.code.trim()) issues.push({ level: "block", message: `${label}: add the coupon code.`, blockId: b.id });
        else issues.push({ level: "warn", message: `${label}: make sure ${b.code.trim()} exists and is active in Shopify.`, blockId: b.id });
        break;
      case "text":
      case "heading":
        for (const m of b.text.matchAll(/\]\(([^)]*)\)/g)) {
          if (!urlOk(m[1])) issues.push({ level: "block", message: `${label}: a link points to "${m[1]}", which is not a full https:// address.`, blockId: b.id });
          else hasLink = true;
        }
        if (/\{\{\s*first_name\s*\}\}/i.test(b.text)) issues.push({ level: "warn", message: `${label}: {{first_name}} has no fallback. Use {{first_name|there}} so people without a name don't see a blank.`, blockId: b.id });
        break;
    }
  });
  if (design.blocks.length > 0 && !hasLink) issues.push({ level: "warn", message: "There is no link to the store. Add a button or products." });

  return issues;
}

export function hasBlockers(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "block");
}
