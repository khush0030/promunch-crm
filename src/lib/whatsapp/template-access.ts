// Who may change which WhatsApp template, and what to tell them before they
// change an automatic one. Pure (no React, no server imports) so the Templates
// UI, the API routes and vitest share one rule.
//
//   marketing         any teammate (For campaigns)
//   customer_service  Owner / Admin only ("Automatic messages", utility)
//   internal          nobody from the dashboard ("Team alerts", system)
//
// What really happens while an edited automatic template is in Meta review
// (verified in the send paths, Sep 30 2026):
//   - wa-template-create's edit action flips our row to status 'pending'.
//   - Meta does not deliver a template while an edit is in review.
//   - wa-journey-tick only sends a journey / custom-flow template whose row is
//     'approved'; otherwise the run stays active and is retried every tick, so
//     those messages go out late, not never.
//   - Order confirmation (_shared/order-confirmation.ts approvedConfirmation
//     Template): a non-approved "first order" template is swapped for
//     order_confirmation_v2; a non-approved "returning customer" template falls
//     back to the first-order one (_shared/confirmations.ts). The backup resend
//     (wa-confirmation-sweep) does NOT check status, so it can fail for orders
//     it has to resend while the first-order template is in review.

import { templateKind, type TemplateKind } from "./templateKind";

export const AUTOMATIC_OWNER_ONLY = "Only the owner can change automatic messages.";
export const TEAM_ALERTS_LOCKED = "Team alert templates are used by the system and can't be changed here.";

/** The confirmation template the send path falls back to (order-confirmation.ts). */
export const DEFAULT_CONFIRMATION_TEMPLATE = "order_confirmation_v2";

export function canChangeTemplate(kind: TemplateKind, isAdmin: boolean): boolean {
  if (kind === "marketing") return true;
  if (kind === "customer_service") return isAdmin;
  return false;
}

/**
 * Server-side gate for anything that changes or deletes an existing template.
 * Pass every classification you know (the stored row AND the incoming body):
 * the strictest one wins. Returns the refusal message, or null when allowed.
 */
export function templateChangeRefusal(
  rows: ({ name: string; category?: string | null } | null | undefined)[],
  isAdmin: boolean,
): string | null {
  const kinds = rows.filter((r): r is { name: string; category?: string | null } => !!r?.name).map(templateKind);
  if (kinds.includes("internal")) return TEAM_ALERTS_LOCKED;
  if (kinds.includes("customer_service") && !isAdmin) return AUTOMATIC_OWNER_ONLY;
  return null;
}

export type FlowSettingsLike = {
  confirmation_template_first?: string | null;
  confirmation_template_repeat?: string | null;
} | null | undefined;

export type CustomFlowLike = { name?: string | null; enabled?: boolean | null; steps?: { template?: string | null }[] | null };

export type AutomaticUse = {
  /** Which order confirmation slot (Flows tab) points at this template. */
  confirmation: "first" | "repeat" | null;
  /** Names of custom flows with a step that sends it. */
  flows: string[];
};

export function automaticUse(name: string, settings: FlowSettingsLike, custom: CustomFlowLike[] | null | undefined): AutomaticUse {
  const first = String(settings?.confirmation_template_first ?? "").trim() || DEFAULT_CONFIRMATION_TEMPLATE;
  const repeat = String(settings?.confirmation_template_repeat ?? "").trim();
  const confirmation = name === first ? "first" : repeat && name === repeat ? "repeat" : null;
  const flows = (custom ?? [])
    .filter((f) => (f.steps ?? []).some((st) => String(st?.template ?? "") === name))
    .map((f) => String(f.name ?? "").trim() || "Untitled flow");
  return { confirmation, flows };
}

export type AutomaticWarning = {
  tone: "warn" | "danger" | "info";
  title: string;
  lines: string[];
  /** When set, the marketer must type this exact name before resubmitting. */
  confirmName: string | null;
};

/**
 * The callout shown in the creator for an automatic (customer_service)
 * template. `mode` "edit" = Edit & resubmit the live template; "copy" =
 * Duplicate as new version (the live one is untouched).
 */
export function automaticEditWarning(
  name: string,
  use: AutomaticUse,
  mode: "edit" | "copy",
  /** False when the Flows settings could not be read: assume the worst. */
  known = true,
): AutomaticWarning {
  const usedBy = use.flows.length ? `Used by: ${use.flows.join(", ")}.` : null;
  if (mode === "copy") {
    return {
      tone: "info",
      title: "This makes a new copy of an automatic message",
      lines: [
        "The current message keeps sending exactly as it is while Meta reviews this copy.",
        use.confirmation
          ? "Once the copy shows Approved, pick it as the order message in the Flows tab to start using it."
          : "Once the copy shows Approved, switch the automation that sends this message to the new name.",
      ],
      confirmName: null,
    };
  }
  const safer = "Safer: use Duplicate as new version instead. The current message keeps sending while the copy is reviewed, then you switch to it.";
  if (use.confirmation === "first") {
    return {
      tone: "danger",
      title: "This is the order confirmation every customer gets",
      lines: [
        "This message goes to every customer automatically when they place an order.",
        "Your changes go to Meta for review, usually a few minutes and up to 24 hours. While it is in review Meta will not send it, not even the old approved wording.",
        `During that time new orders get the standard confirmation (${DEFAULT_CONFIRMATION_TEMPLATE}) instead, and an order that needs the backup resend may get no confirmation until Meta approves the change.`,
        safer,
      ],
      confirmName: name,
    };
  }
  if (use.confirmation === "repeat") {
    return {
      tone: "danger",
      title: "This is the order confirmation for returning customers",
      lines: [
        "This message goes automatically to every returning customer when they order again.",
        "Your changes go to Meta for review, usually a few minutes and up to 24 hours. While it is in review Meta will not send it, not even the old approved wording.",
        "During that time returning customers get the first-order confirmation instead.",
        safer,
      ],
      confirmName: name,
    };
  }
  if (!known) {
    return {
      tone: "danger",
      title: "This message goes to customers automatically",
      lines: [
        "This message goes to every customer automatically (for example order updates).",
        "Your changes go to Meta for review, usually a few minutes and up to 24 hours. While it is in review Meta will not send it, not even the old approved wording.",
        "We could not check whether this is your order confirmation message. If it is, some customers may get no confirmation until Meta approves the change.",
        safer,
      ],
      confirmName: name,
    };
  }
  return {
    tone: "warn",
    title: "This message goes to customers automatically",
    lines: [
      "This message goes to every customer automatically (for example order updates).",
      "Your changes go to Meta for review, usually a few minutes and up to 24 hours. While it is in review Meta will not send it, not even the old approved wording.",
      "Automations that send it wait and send it after Meta approves the change, so customers get it late. If Meta rejects the change, they keep waiting until you fix it.",
      ...(usedBy ? [usedBy] : []),
      safer,
    ],
    confirmName: null,
  };
}
