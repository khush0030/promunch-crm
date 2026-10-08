// Six-hub navigation for the dashboard shell (sidebar, phone tab bar, More
// sheet, command palette). The hub structure is final; hrefs that still point
// at legacy pages go through ROUTES so Phase 1 can swap them in one place.
import {
  Home,
  ShoppingCart,
  Inbox,
  Megaphone,
  Handshake,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { Attention } from "@/lib/metrics/attention";
import { canOpenHref, type Access } from "@/lib/access";

export type Hub = "Today" | "Sales" | "Inbox" | "Marketing" | "Partners" | "System";
export type AttentionCounts = Omit<Attention["counts"], "byHub">;

// Current targets for items whose final page does not exist yet.
// salesOverview, salesAmazon and salesOrders now point at their real pages
// (1.3, 1.5, 1.6).
export const ROUTES = {
  salesOverview: "/dashboard/sales",
  salesWeb: "/dashboard/sales/web",
  salesAmazon: "/dashboard/sales/amazon",
  salesOrders: "/dashboard/sales/orders",
  // Instagram tabs are not URL-driven yet, so Creators lands on the page.
  creators: "/dashboard/instagram",
  inbox: "/dashboard/inbox",
  inboxTickets: "/dashboard/inbox/tickets",
  inboxEmail: "/dashboard/inbox/email",
  // Deep link to a single conversation on the unified Inbox page. `key`
  // carries its channel as a prefix: wa-<uuid> (WhatsApp), ig-<uuid>
  // (Instagram), em-<uuid> (support email, redirected to inboxEmail).
  conversation: (key: string) => `/dashboard/inbox/${key}`,
} as const;

export type NavItem = {
  label: string;
  href: string;
  badge?: keyof AttentionCounts;
  // data-tour anchor used by the onboarding spotlight (Onboarding.tsx).
  tour?: string;
  // Not listed in the sidebar or the More sheet, but still resolves in
  // findActive (so the hub highlights) and shows up in the command palette.
  // Used for legacy pages kept reachable by URL.
  hidden?: boolean;
  // Owners / admins only (the page's APIs refuse everyone else too).
  adminOnly?: boolean;
  // Other hrefs this (visible) item stands for, so it stays highlighted on
  // them: one "WhatsApp marketing" entry covers every marketing tab and the
  // campaign pages. A match through `covers` beats any other item.
  covers?: string[];
};
export type NavHub = { hub: Hub; color: string; accent?: string; icon: LucideIcon; items: NavItem[] };

export const NAV: NavHub[] = [
  {
    hub: "Today", color: "#1D1517", accent: "#AF272F", icon: Home,
    items: [
      { label: "Home", href: "/dashboard", tour: "dashboard" },
      { label: "Needs attention", href: "/dashboard/attention", badge: "open" },
      { label: "Ask Maya", href: "/dashboard/assistant" },
    ],
  },
  {
    hub: "Sales", color: "#AF272F", icon: ShoppingCart,
    items: [
      { label: "Overview", href: ROUTES.salesOverview },
      { label: "Web store", href: ROUTES.salesWeb },
      { label: "Amazon", href: ROUTES.salesAmazon },
      { label: "Orders & COD", href: ROUTES.salesOrders, badge: "orders", tour: "order-confirmations" },
    ],
  },
  {
    hub: "Inbox", color: "#0A9CB8", icon: Inbox,
    items: [
      { label: "Conversations", href: ROUTES.inbox, badge: "inbox", tour: "whatsapp" },
      { label: "Tickets", href: ROUTES.inboxTickets },
      { label: "Email drafts", href: ROUTES.inboxEmail, tour: "support-emails" },
    ],
  },
  {
    hub: "Marketing", color: "#FFC905", icon: Megaphone,
    items: [
      // One entry for all of WhatsApp marketing (mirrors Email Studio). It
      // lands on the "Start here" tab; the other tabs live on the page.
      {
        label: "WhatsApp marketing",
        href: "/dashboard/whatsapp?tab=home",
        tour: "wa-marketing",
        covers: [
          "/dashboard/whatsapp?tab=campaigns",
          "/dashboard/whatsapp?tab=templates",
          "/dashboard/whatsapp?tab=flows",
          "/dashboard/whatsapp?tab=analytics",
          "/dashboard/whatsapp?tab=growth",
          "/dashboard/whatsapp/campaigns",
        ],
      },
      { label: "Email Studio", href: "/dashboard/email", tour: "email-studio" },
      { label: "Audience", href: "/dashboard/contacts", tour: "contacts" },
      // Reviews, comments and mentions across the web (ORM feed).
      { label: "Reputation", href: "/dashboard/reputation" },
      // Direct jumps for the command palette (hidden from the sidebar; the
      // WhatsApp marketing entry stays highlighted on all of them).
      { label: "WhatsApp campaigns", href: "/dashboard/whatsapp?tab=campaigns", hidden: true },
      { label: "WhatsApp message templates", href: "/dashboard/whatsapp?tab=templates", hidden: true },
      { label: "WhatsApp automations", href: "/dashboard/whatsapp?tab=flows", hidden: true },
      { label: "WhatsApp results", href: "/dashboard/whatsapp?tab=analytics", hidden: true },
      { label: "WhatsApp signup popup", href: "/dashboard/whatsapp?tab=growth", hidden: true },
      { label: "New WhatsApp campaign", href: "/dashboard/whatsapp/campaigns/new", hidden: true },
      { label: "WhatsApp campaign report", href: "/dashboard/whatsapp/campaigns", hidden: true },
      // Old in-house email pages. Reachable by URL and the command palette only.
      { label: "Legacy email campaigns", href: "/dashboard/campaigns", hidden: true },
      { label: "Legacy email automations", href: "/dashboard/flows", hidden: true },
    ],
  },
  {
    hub: "Partners", color: "#E86A24", icon: Handshake,
    items: [
      { label: "B2B leads", href: "/dashboard/leads" },
      { label: "Deals", href: "/dashboard/deals" },
      // Influencer delivery tracker (barter collabs: brief, box, draft, post).
      { label: "Influencers", href: "/dashboard/influencers" },
      // Creators (/dashboard/instagram) is off until the Instagram backend is
      // live: its tables were never migrated in prod, so the page only errors.
      // Re-add `{ label: "Creators", href: ROUTES.creators }` here, restore the
      // Instagram option in the Conversations channel picker, and drop the
      // /dashboard/instagram redirect in next.config.ts, all together.
    ],
  },
  {
    hub: "System", color: "#8A7F83", icon: Settings,
    items: [
      { label: "Bot knowledge", href: "/dashboard/whatsapp?tab=kb" },
      { label: "Health", href: "/dashboard/settings#connections" },
      { label: "Settings", href: "/dashboard/settings", tour: "settings" },
      { label: "Admin", href: "/dashboard/admin", adminOnly: true },
    ],
  },
];

export function parseHref(href: string): { path: string; tab: string | null; hash: string } {
  const [beforeHash, hashPart] = href.split("#");
  const [path, query = ""] = beforeHash.split("?");
  return { path, tab: new URLSearchParams(query).get("tab"), hash: hashPart ? `#${hashPart}` : "" };
}

// Tabs / hashes that some NAV item claims on a given path. An untabbed item
// on that path (e.g. Conversations on /dashboard/whatsapp) does not match
// when the URL carries a claimed tab.
const claimed = (() => {
  const tabs = new Map<string, Set<string>>();
  const hashes = new Map<string, Set<string>>();
  for (const h of NAV) {
    for (const it of h.items) {
      for (const href of [it.href, ...(it.covers ?? [])]) {
        const p = parseHref(href);
        if (p.tab) tabs.set(p.path, (tabs.get(p.path) ?? new Set()).add(p.tab));
        if (p.hash) hashes.set(p.path, (hashes.get(p.path) ?? new Set()).add(p.hash));
      }
    }
  }
  return { tabs, hashes };
})();

export type ActiveNav = { hub: Hub; item: NavItem };

// Items shown in the sidebar and the More sheet.
export function visibleItems(h: NavHub): NavItem[] {
  return h.items.filter((it) => !it.hidden);
}

// NAV trimmed to the areas a member can open (lib/access.ts); hubs left with
// no items drop out. Null access (still loading) shows nothing, so a
// restricted member never sees a flash of areas they can't open.
export function navFor(access: Access | null): NavHub[] {
  if (access?.admin) return NAV;
  return NAV.map((h) => ({
    ...h,
    items: h.items.filter((it) => access && !it.adminOnly && canOpenHref(access, it.href)),
  })).filter((h) => h.items.length > 0);
}

// Short preview of a collapsed hub: the first few item names, plus how many
// more it holds.
export const PREVIEW_ITEMS = 3;
export function hubPreview(h: NavHub): { names: string[]; more: number } {
  const items = visibleItems(h);
  return { names: items.slice(0, PREVIEW_ITEMS).map((it) => it.label), more: Math.max(0, items.length - PREVIEW_ITEMS) };
}

// The nav item for the current location. Exact path beats a prefix match
// (/dashboard/contacts/123 -> Audience), a matching tab or hash beats none,
// and on a tie the first item in NAV order wins. "/dashboard" never matches
// as a prefix.
export function findActive(pathname: string, tab: string | null, hash: string): ActiveNav | null {
  let best: ActiveNav | null = null;
  let bestScore = -1;
  for (const h of NAV) {
    for (const item of h.items) {
      let score = hrefScore(item.href, pathname, tab, hash);
      for (const c of item.covers ?? []) {
        const cs = hrefScore(c, pathname, tab, hash);
        if (cs >= 0) score = Math.max(score, COVER_BONUS + cs);
      }
      if (score > bestScore) {
        best = { hub: h.hub, item };
        bestScore = score;
      }
    }
  }
  return best;
}

const COVER_BONUS = 5000;

// How well one href matches the location; -1 = no match.
function hrefScore(href: string, pathname: string, tab: string | null, hash: string): number {
  const p = parseHref(href);
  let score: number;
  if (pathname === p.path) score = 1000;
  else if (p.path !== "/dashboard" && pathname.startsWith(p.path + "/")) score = p.path.length;
  else return -1;
  if (p.tab) {
    if (tab !== p.tab) return -1;
    score += 10;
  } else if (tab && claimed.tabs.get(p.path)?.has(tab)) return -1;
  if (p.hash) {
    if (hash !== p.hash) return -1;
    score += 10;
  } else if (hash && claimed.hashes.get(p.path)?.has(hash)) return -1;
  return score;
}

// Where a hub-level link (phone tab bar) goes: the first item in the hub that
// actually resolves to that hub. While Sales Overview still shares
// /dashboard with Home, the Sales tab opens Web store instead.
export function hubHref(hub: Hub, nav: NavHub[] = NAV): string {
  const h = nav.find((x) => x.hub === hub) ?? NAV.find((x) => x.hub === hub)!;
  for (const item of visibleItems(h)) {
    const p = parseHref(item.href);
    if (findActive(p.path, p.tab, p.hash)?.hub === hub) return item.href;
  }
  return h.items[0].href;
}
