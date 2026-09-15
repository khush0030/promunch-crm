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

export type Hub = "Today" | "Sales" | "Inbox" | "Marketing" | "Partners" | "System";
export type AttentionCounts = Omit<Attention["counts"], "byHub">;

// Current targets for items whose final page does not exist yet.
// Phase 1 swaps these to /dashboard/sales/web, /dashboard/sales/amazon and
// /dashboard/sales/orders (Task 0.7 adds the redirects from the legacy
// routes). salesOverview now points at the real Sales overview page (1.3).
export const ROUTES = {
  salesOverview: "/dashboard/sales",
  salesWeb: "/dashboard/shopify-attribution",
  salesAmazon: "/dashboard/amazon",
  salesOrders: "/dashboard/order-confirmations",
  // Instagram tabs are not URL-driven yet, so Creators lands on the page.
  creators: "/dashboard/instagram",
} as const;

export type NavItem = {
  label: string;
  href: string;
  badge?: keyof AttentionCounts;
  // data-tour anchor used by the onboarding spotlight (Onboarding.tsx).
  tour?: string;
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
      { label: "Conversations", href: "/dashboard/whatsapp", badge: "inbox", tour: "whatsapp" },
      { label: "Tickets", href: "/dashboard/whatsapp?tab=tickets" },
      { label: "Email drafts", href: "/dashboard/support-emails", tour: "support-emails" },
      { label: "Instagram", href: "/dashboard/instagram" },
    ],
  },
  {
    hub: "Marketing", color: "#FFC905", icon: Megaphone,
    items: [
      { label: "Campaigns", href: "/dashboard/whatsapp?tab=campaigns" },
      { label: "Email campaigns", href: "/dashboard/campaigns", tour: "campaigns" },
      { label: "Automations", href: "/dashboard/whatsapp?tab=flows" },
      { label: "Email automations", href: "/dashboard/flows" },
      { label: "Audience", href: "/dashboard/contacts", tour: "contacts" },
      { label: "Templates", href: "/dashboard/whatsapp?tab=templates" },
      { label: "Sign-up popup", href: "/dashboard/whatsapp?tab=growth" },
    ],
  },
  {
    hub: "Partners", color: "#E86A24", icon: Handshake,
    items: [
      { label: "B2B leads", href: "/dashboard/leads" },
      { label: "Deals", href: "/dashboard/deals" },
      { label: "Creators", href: ROUTES.creators },
    ],
  },
  {
    hub: "System", color: "#8A7F83", icon: Settings,
    items: [
      { label: "Bot knowledge", href: "/dashboard/whatsapp?tab=kb" },
      { label: "Health", href: "/dashboard/settings#connections" },
      { label: "Settings", href: "/dashboard/settings", tour: "settings" },
      { label: "Activity", href: "/dashboard/audit-log" },
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
      const p = parseHref(it.href);
      if (p.tab) tabs.set(p.path, (tabs.get(p.path) ?? new Set()).add(p.tab));
      if (p.hash) hashes.set(p.path, (hashes.get(p.path) ?? new Set()).add(p.hash));
    }
  }
  return { tabs, hashes };
})();

export type ActiveNav = { hub: Hub; item: NavItem };

// The nav item for the current location. Exact path beats a prefix match
// (/dashboard/contacts/123 -> Audience), a matching tab or hash beats none,
// and on a tie the first item in NAV order wins. "/dashboard" never matches
// as a prefix.
export function findActive(pathname: string, tab: string | null, hash: string): ActiveNav | null {
  let best: ActiveNav | null = null;
  let bestScore = -1;
  for (const h of NAV) {
    for (const item of h.items) {
      const p = parseHref(item.href);
      let score: number;
      if (pathname === p.path) score = 1000;
      else if (p.path !== "/dashboard" && pathname.startsWith(p.path + "/")) score = p.path.length;
      else continue;
      if (p.tab) {
        if (tab !== p.tab) continue;
        score += 10;
      } else if (tab && claimed.tabs.get(p.path)?.has(tab)) continue;
      if (p.hash) {
        if (hash !== p.hash) continue;
        score += 10;
      } else if (hash && claimed.hashes.get(p.path)?.has(hash)) continue;
      if (score > bestScore) {
        best = { hub: h.hub, item };
        bestScore = score;
      }
    }
  }
  return best;
}

// Where a hub-level link (phone tab bar) goes: the first item in the hub that
// actually resolves to that hub. While Sales Overview still shares
// /dashboard with Home, the Sales tab opens Web store instead.
export function hubHref(hub: Hub): string {
  const h = NAV.find((x) => x.hub === hub)!;
  for (const item of h.items) {
    const p = parseHref(item.href);
    if (findActive(p.path, p.tab, p.hash)?.hub === hub) return item.href;
  }
  return h.items[0].href;
}
