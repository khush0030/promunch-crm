// Per-area access for team members (pure, so middleware, routes, the shell and
// tests share one map). Enforced in src/middleware.ts for every dashboard page
// and every session-gated /api/* route; the UI only hides what the middleware
// would refuse anyway.
//
// Model:
//   Admin / Owner (rbac.ts tier)       -> every area, always.
//   Member with app_metadata.modules    -> exactly those areas.
//   Member without app_metadata.modules -> every area (how members worked
//                                          before areas existed, so nobody
//                                          already on the team loses access).
// app_metadata is server-only (see rbac.ts), so a member cannot grant
// themselves an area.
import { isAdminUser, type RbacUser } from "@/lib/rbac";

export const MODULES = [
  { key: "home", label: "Home & Ask Maya", hint: "Home dashboard, needs attention, AI assistant", landing: "/dashboard" },
  { key: "sales", label: "Sales & orders", hint: "Revenue, web store, Amazon, orders & COD", landing: "/dashboard/sales" },
  { key: "inbox", label: "Inbox", hint: "WhatsApp chats, tickets, support email, voice calls", landing: "/dashboard/inbox" },
  {
    key: "wa_marketing",
    label: "WhatsApp marketing",
    hint: "Campaigns, automations, templates, popup, analytics",
    landing: "/dashboard/whatsapp?tab=campaigns",
  },
  {
    key: "email_marketing",
    label: "Email marketing",
    hint: "Email Studio: campaigns, builder, templates, audiences, reports",
    landing: "/dashboard/email",
  },
  { key: "audience", label: "Audience", hint: "Contacts list, import & export", landing: "/dashboard/contacts" },
  { key: "partners", label: "B2B leads & deals", hint: "Lead lists, outreach, deals, creators", landing: "/dashboard/leads" },
  { key: "bot_knowledge", label: "Bot knowledge", hint: "Master KB the WhatsApp bot answers from", landing: "/dashboard/whatsapp?tab=kb" },
  { key: "system", label: "Settings & activity", hint: "Connections, team list, activity log", landing: "/dashboard/settings" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS: ModuleKey[] = MODULES.map((m) => m.key);

export function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === "string" && (MODULE_KEYS as string[]).includes(v);
}

// restricted=false means "every area" (admin, or a member never restricted).
export type Access = { admin: boolean; restricted: boolean; modules: ModuleKey[] };

// Stored list -> clean list, or null when the user has no restriction.
export function storedModules(u: RbacUser): ModuleKey[] | null {
  const raw = (u?.app_metadata || {}).modules;
  if (!Array.isArray(raw)) return null;
  return MODULE_KEYS.filter((k) => raw.includes(k));
}

export function accessOf(u: RbacUser): Access {
  if (isAdminUser(u)) return { admin: true, restricted: false, modules: [...MODULE_KEYS] };
  const stored = storedModules(u);
  if (!stored) return { admin: false, restricted: false, modules: [...MODULE_KEYS] };
  return { admin: false, restricted: true, modules: stored };
}

export function canUse(a: Access, m: ModuleKey): boolean {
  return !a.restricted || a.modules.includes(m);
}

// Where to send someone who opened an area they don't have.
export const NO_ACCESS_PATH = "/dashboard/no-access";
export function landingFor(a: Access): string {
  const first = MODULES.find((m) => canUse(a, m.key));
  return first ? first.landing : NO_ACCESS_PATH;
}

// ---- Pages ----------------------------------------------------------------

// /dashboard/whatsapp is one page with tabs; the tab decides the area. No tab
// (or an unknown one) renders the inbox.
const WHATSAPP_TABS: Record<string, ModuleKey> = {
  inbox: "inbox",
  tickets: "inbox",
  voice: "inbox",
  templates: "wa_marketing",
  campaigns: "wa_marketing",
  flows: "wa_marketing",
  growth: "wa_marketing",
  analytics: "wa_marketing",
  kb: "bot_knowledge",
};
export function whatsappTabModule(tab: string | null): ModuleKey {
  return (tab && WHATSAPP_TABS[tab]) || "inbox";
}

const PAGE_PREFIXES: Array<[string, ModuleKey]> = [
  ["/dashboard/attention", "home"],
  ["/dashboard/assistant", "home"],
  ["/dashboard/sales", "sales"],
  ["/dashboard/inbox", "inbox"],
  ["/dashboard/support-emails", "inbox"],
  ["/dashboard/email", "email_marketing"],
  ["/dashboard/marketing", "email_marketing"],
  ["/dashboard/campaigns", "email_marketing"],
  ["/dashboard/flows", "email_marketing"],
  // Email marketing analytics (Resend era), not WhatsApp analytics.
  ["/dashboard/analytics", "email_marketing"],
  ["/dashboard/contacts", "audience"],
  ["/dashboard/leads", "partners"],
  ["/dashboard/deals", "partners"],
  ["/dashboard/instagram", "partners"],
  ["/dashboard/settings", "system"],
  ["/dashboard/audit-log", "system"],
  // Admin → security & activity. The page and its APIs are Admin-only on top.
  ["/dashboard/admin", "system"],
  ["/dashboard/integrations", "system"],
  ["/dashboard/team", "system"],
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

// "open" = any signed-in teammate; null = unmapped (restricted members are
// refused, so a new page stays closed until it is added here).
export function pageModule(path: string, tab: string | null): ModuleKey | "open" | null {
  if (under(path, NO_ACCESS_PATH)) return "open";
  if (path === "/dashboard") return "home";
  if (under(path, "/dashboard/whatsapp")) return whatsappTabModule(tab);
  for (const [prefix, m] of PAGE_PREFIXES) if (under(path, prefix)) return m;
  return null;
}

export function canOpenPage(a: Access, path: string, tab: string | null): boolean {
  if (!a.restricted) return true;
  const m = pageModule(path, tab);
  return m === "open" || (m !== null && a.modules.includes(m));
}

// Nav hrefs look like "/dashboard/whatsapp?tab=flows" or "/dashboard/settings#team".
export function canOpenHref(a: Access, href: string): boolean {
  const [beforeHash] = href.split("#");
  const [path, query = ""] = beforeHash.split("?");
  return canOpenPage(a, path, new URLSearchParams(query).get("tab"));
}

// ---- API routes -------------------------------------------------------------

// Most specific prefix first. `modules` may use the route with any method;
// `read` adds areas that may only GET it (the inbox lists templates to send
// one into a closed 24h window, but only WhatsApp marketing edits them).
type ApiRule = { prefix: string; open?: true; modules?: ModuleKey[]; read?: ModuleKey[] };

export const API_RULES: ApiRule[] = [
  // Shell chrome every teammate loads: badge counts, WhatsApp status pill,
  // current-user lookup (team writes are Admin-gated inside the route).
  { prefix: "/api/metrics/attention", open: true },
  { prefix: "/api/whatsapp/health", open: true },
  { prefix: "/api/team", open: true },

  { prefix: "/api/assistant", modules: ["home"] },
  { prefix: "/api/needs-attention", modules: ["home"] },
  { prefix: "/api/metrics/sales", modules: ["home", "sales"] },

  { prefix: "/api/metrics/web", modules: ["sales"] },
  { prefix: "/api/amazon", modules: ["sales"] },
  { prefix: "/api/shopify/stats", modules: ["sales"] },
  { prefix: "/api/whatsapp/confirmations", modules: ["sales"] },
  { prefix: "/api/whatsapp/cod-gate", modules: ["sales", "inbox"] },

  { prefix: "/api/inbox", modules: ["inbox"] },
  { prefix: "/api/support-emails", modules: ["inbox"] },
  { prefix: "/api/whatsapp/threads", modules: ["inbox"] },
  { prefix: "/api/whatsapp/send", modules: ["inbox"] },
  { prefix: "/api/whatsapp/voice-calls", modules: ["inbox"] },
  { prefix: "/api/instagram/threads", modules: ["inbox", "partners"] },
  { prefix: "/api/whatsapp/media-upload", modules: ["inbox", "wa_marketing"] },

  { prefix: "/api/whatsapp/templates", modules: ["wa_marketing"], read: ["inbox"] },
  { prefix: "/api/whatsapp/campaigns", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/flows", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/cart-recovery", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/growth", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/analytics", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/audience", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/segments", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/quota", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/engagement", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/import-contacts", modules: ["wa_marketing"] },
  { prefix: "/api/whatsapp/import-csv", modules: ["wa_marketing"] },

  { prefix: "/api/whatsapp/kb", modules: ["bot_knowledge"] },

  { prefix: "/api/email-studio", modules: ["email_marketing"] },
  { prefix: "/api/brevo", modules: ["email_marketing"] },
  { prefix: "/api/campaigns", modules: ["email_marketing"] },
  { prefix: "/api/flows", modules: ["email_marketing"] },

  { prefix: "/api/contacts", modules: ["audience"] },
  { prefix: "/api/import", modules: ["audience"] },

  { prefix: "/api/leads", modules: ["partners"] },
  { prefix: "/api/deals", modules: ["partners"] },
  { prefix: "/api/instagram", modules: ["partners"] },

  { prefix: "/api/settings", modules: ["system"] },
  { prefix: "/api/audit", modules: ["system"] },
  { prefix: "/api/admin", modules: ["system"] },
  { prefix: "/api/integrations", modules: ["system"] },
  { prefix: "/api/shopify/catalog", modules: ["system"] },
  // Raw send-any-email endpoint with no UI caller: keep it off restricted members.
  { prefix: "/api/email/send", modules: ["system"] },
];

export function apiRule(path: string): ApiRule | null {
  return API_RULES.find((r) => under(path, r.prefix)) ?? null;
}

export function canCallApi(a: Access, path: string, method: string): boolean {
  if (!a.restricted) return true;
  const rule = apiRule(path);
  if (!rule) return false;
  if (rule.open) return true;
  if (rule.modules?.some((m) => a.modules.includes(m))) return true;
  const isRead = method === "GET" || method === "HEAD";
  return isRead && !!rule.read?.some((m) => a.modules.includes(m));
}
