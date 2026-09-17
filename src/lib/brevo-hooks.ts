// Brevo webhook registration constants, shared by the registration route and
// the Health tab.

const APP_URL = (process.env.SITE_APP_URL || "https://promunch-crm.vercel.app").replace(/\/+$/, "");
export const BREVO_HOOK_URL = `${APP_URL}/api/webhooks/brevo`;

export const EXPECTED_HOOK_EVENTS = {
  marketing: ["spam", "opened", "click", "hardBounce", "softBounce", "unsubscribed", "listAddition", "delivered", "contactUpdated", "contactDeleted"],
  transactional: ["sent", "delivered", "hardBounce", "softBounce", "blocked", "spam", "invalid", "deferred", "click", "opened", "uniqueOpened", "unsubscribed"],
} as const;

export type HookKind = keyof typeof EXPECTED_HOOK_EVENTS;
