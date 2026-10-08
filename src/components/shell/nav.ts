// Dashboard navigation (sidebar, phone tab bar, More sheet, section tabs,
// command palette). Eight places in three groups, plus Ask Maya pinned on top
// and Settings in the footer (docs/plans/2026-10-07-app-redesign/04-ia.md).
//
// Every place points at today's URLs; a place that spans several pages lists
// them in `pages` and the page header shows them as section tabs, so folding
// pages into one sidebar entry never strands a page.
import {
  Home,
  Inbox,
  Package,
  Megaphone,
  Sparkle,
  Handshake,
  Users,
  LineChart,
  Settings,
  Sparkles,
  MessageCircle,
  Mail,
  type LucideIcon,
} from "lucide-react";
import type { Attention } from "@/lib/metrics/attention";
import { canOpenHref, canUse, type Access, type ModuleKey } from "@/lib/access";

export type Area =
  | "Home"
  | "Inbox"
  | "Orders"
  | "Marketing"
  | "Creators"
  | "B2B"
  | "Customers"
  | "Insights"
  | "Settings"
  | "Maya";
export type AttentionCounts = Omit<Attention["counts"], "byHub">;

export const ROUTES = {
  inbox: "/dashboard/inbox",
  inboxTickets: "/dashboard/inbox/tickets",
  inboxEmail: "/dashboard/inbox/email",
  // Deep link to a single conversation on the unified Inbox page. `key`
  // carries its channel as a prefix: wa-<uuid> (WhatsApp), ig-<uuid>
  // (Instagram), em-<uuid> (support email, redirected to inboxEmail).
  conversation: (key: string) => `/dashboard/inbox/${key}`,
} as const;

// One page inside a place. `also` lists more hrefs that count as this page
// (other tabs of the same screen, detail pages under another path).
export type NavPage = { label: string; href: string; adminOnly?: boolean; also?: string[]; /** Extra area the page's data needs (hidden without it). */ needs?: ModuleKey };

export type NavItem = {
  area: Area;
  label: string;
  href: string;
  icon: LucideIcon;
  // One-line description for the phone More sheet.
  desc?: string;
  badge?: keyof AttentionCounts;
  // data-tour anchors used by the onboarding spotlight (Onboarding.tsx).
  tours?: string[];
  // Shown as section tabs under the page title when there are two or more.
  pages?: NavPage[];
  // Marketing only: WhatsApp and Email, shown under it while it is open.
  children?: NavItem[];
  // Command palette only: direct jumps that are not pages of their own here.
  palette?: NavPage[];
};
export type NavSection = { title: string | null; items: NavItem[] };

const WA_TABS = ["home", "campaigns", "templates", "flows", "analytics"];

export const MAYA: NavItem = {
  area: "Maya",
  label: "Ask Maya",
  href: "/dashboard/assistant",
  icon: Sparkle,
  desc: "Ask anything about sales, customers or campaigns",
};

export const SETTINGS: NavItem = {
  area: "Settings",
  label: "Settings",
  href: "/dashboard/settings",
  icon: Settings,
  desc: "Connections, team, API keys, brand, security",
  tours: ["settings"],
  pages: [
    { label: "Connections", href: "/dashboard/settings#connections", also: ["/dashboard/settings"] },
    { label: "Team & access", href: "/dashboard/settings#team" },
    { label: "API keys", href: "/dashboard/settings#apikeys", adminOnly: true },
    { label: "Brand & email", href: "/dashboard/settings#brand", also: ["/dashboard/email/settings", "/dashboard/settings#email"] },
    { label: "Security", href: "/dashboard/admin", adminOnly: true },
  ],
};

export const NAV: NavSection[] = [
  {
    title: null,
    items: [
      {
        area: "Home",
        label: "Home",
        href: "/dashboard",
        icon: Home,
        desc: "Today and what needs you",
        tours: ["dashboard"],
        pages: [
          { label: "Today", href: "/dashboard" },
          { label: "Needs you", href: "/dashboard/attention" },
        ],
      },
      {
        area: "Inbox",
        label: "Inbox",
        href: ROUTES.inboxTickets,
        icon: Inbox,
        desc: "Chats, tickets and email drafts",
        badge: "inbox",
        tours: ["whatsapp", "support-emails"],
        pages: [
          { label: "Tickets", href: ROUTES.inboxTickets },
          { label: "Live chats", href: ROUTES.inbox },
          { label: "Email drafts", href: ROUTES.inboxEmail },
          { label: "Bot knowledge", href: "/dashboard/whatsapp?tab=kb" },
        ],
      },
      {
        area: "Orders",
        label: "Orders & COD",
        href: "/dashboard/sales/orders",
        icon: Package,
        desc: "Confirm COD orders and voice calls",
        badge: "orders",
        tours: ["order-confirmations"],
        pages: [
          { label: "Confirm COD", href: "/dashboard/sales/orders" },
          { label: "Voice calls", href: "/dashboard/whatsapp?tab=voice" },
          { label: "All orders", href: "/dashboard/sales/orders?tab=all", also: ["/dashboard/sales/orders?tab=coverage"] },
          { label: "Call rules", href: "/dashboard/sales/orders?tab=rules", needs: "wa_marketing" },
        ],
      },
    ],
  },
  {
    title: "Grow",
    items: [
      {
        area: "Marketing",
        label: "Marketing",
        href: "/dashboard/whatsapp?tab=home",
        icon: Megaphone,
        children: [
          {
            area: "Marketing",
            label: "WhatsApp",
            href: "/dashboard/whatsapp?tab=home",
            icon: MessageCircle,
            desc: "Campaigns, templates and automations",
            tours: ["wa-marketing"],
            pages: [
              {
                label: "WhatsApp",
                href: "/dashboard/whatsapp?tab=home",
                also: [...WA_TABS.map((t) => `/dashboard/whatsapp?tab=${t}`), "/dashboard/whatsapp", "/dashboard/whatsapp/campaigns"],
              },
            ],
            palette: [
              { label: "WhatsApp campaigns", href: "/dashboard/whatsapp?tab=campaigns" },
              { label: "WhatsApp message templates", href: "/dashboard/whatsapp?tab=templates" },
              { label: "WhatsApp automations", href: "/dashboard/whatsapp?tab=flows" },
              { label: "WhatsApp results", href: "/dashboard/whatsapp?tab=analytics" },
              { label: "New WhatsApp campaign", href: "/dashboard/whatsapp/campaigns/new" },
            ],
          },
          {
            area: "Marketing",
            label: "Email",
            href: "/dashboard/email",
            icon: Mail,
            desc: "Email campaigns and automations",
            tours: ["email-studio"],
            pages: [{ label: "Email", href: "/dashboard/email", also: ["/dashboard/analytics"] }],
            // Brevo hub and the old in-house email pages, retiring. Reachable
            // by URL and the command palette only.
            palette: [
              { label: "Email (Brevo)", href: "/dashboard/marketing/email" },
              { label: "Legacy email campaigns", href: "/dashboard/campaigns" },
              { label: "Legacy email automations", href: "/dashboard/flows" },
            ],
          },
        ],
      },
      {
        area: "Creators",
        label: "Creators",
        href: "/dashboard/influencers",
        icon: Sparkles,
        desc: "Influencer collabs: brief, box, draft, post",
      },
      {
        area: "B2B",
        label: "B2B & deals",
        href: "/dashboard/leads",
        icon: Handshake,
        desc: "Find buyers, send as Parth, track deals",
        pages: [
          { label: "Overview", href: "/dashboard/leads", also: ["/dashboard/leads?tab=setup"] },
          { label: "Lists", href: "/dashboard/leads?tab=lists", also: ["/dashboard/leads?tab=find"] },
          { label: "Review", href: "/dashboard/leads?tab=review" },
          { label: "Replies", href: "/dashboard/leads?tab=replies" },
          { label: "Deals", href: "/dashboard/deals" },
        ],
      },
    ],
  },
  {
    title: "Know",
    items: [
      {
        area: "Customers",
        label: "Customers",
        href: "/dashboard/contacts",
        icon: Users,
        desc: "Everyone who bought or signed up",
        tours: ["contacts"],
        pages: [
          { label: "Customers", href: "/dashboard/contacts" },
          { label: "Segments", href: "/dashboard/email/audiences" },
          { label: "Sign-up popup", href: "/dashboard/whatsapp?tab=growth" },
        ],
      },
      {
        area: "Insights",
        label: "Insights",
        href: "/dashboard/sales",
        icon: LineChart,
        desc: "Sales, website and Amazon",
        pages: [
          { label: "Sales", href: "/dashboard/sales" },
          { label: "Website", href: "/dashboard/sales/web" },
          { label: "Amazon", href: "/dashboard/sales/amazon" },
        ],
      },
    ],
  },
];

// Every place, flattened: the sections (Marketing's children instead of
// Marketing itself), then Maya and Settings.
export function allItems(sections: NavSection[] = NAV, extra: NavItem[] = [MAYA, SETTINGS]): NavItem[] {
  const out: NavItem[] = [];
  for (const s of sections) for (const it of s.items) out.push(...(it.children ?? [it]));
  return [...out, ...extra];
}

function pageList(it: NavItem): NavPage[] {
  return it.pages ?? [{ label: it.label, href: it.href }];
}

export function parseHref(href: string): { path: string; tab: string | null; hash: string } {
  const [beforeHash, hashPart] = href.split("#");
  const [path, query = ""] = beforeHash.split("?");
  return { path, tab: new URLSearchParams(query).get("tab"), hash: hashPart ? `#${hashPart}` : "" };
}

// Tabs / hashes that some page claims on a given path. A plain href on that
// path (e.g. /dashboard/whatsapp) does not match when the URL carries a
// claimed tab (?tab=kb belongs to Inbox, not WhatsApp).
const claimed = (() => {
  const tabs = new Map<string, Set<string>>();
  const hashes = new Map<string, Set<string>>();
  for (const it of allItems()) {
    for (const pg of [...pageList(it), ...(it.palette ?? [])]) {
      for (const href of [pg.href, ...(pg.also ?? [])]) {
        const p = parseHref(href);
        if (p.tab) tabs.set(p.path, (tabs.get(p.path) ?? new Set()).add(p.tab));
        if (p.hash) hashes.set(p.path, (hashes.get(p.path) ?? new Set()).add(p.hash));
      }
    }
  }
  return { tabs, hashes };
})();

// `item` is the place (WhatsApp / Email for Marketing), `page` the matching
// page within it (null when the match came from a palette-only jump).
export type ActiveNav = { area: Area; item: NavItem; page: NavPage | null };

// The place for the current location. Exact path beats a prefix match
// (/dashboard/contacts/123 -> Customers, /dashboard/sales/orders -> Orders
// rather than Insights), a matching tab or hash beats none, and on a tie the
// first place in order wins. "/dashboard" never matches as a prefix.
export function findActive(pathname: string, tab: string | null, hash: string): ActiveNav | null {
  let best: ActiveNav | null = null;
  let bestScore = -1;
  for (const item of allItems()) {
    const consider = (page: NavPage | null, href: string) => {
      const score = hrefScore(href, pathname, tab, hash);
      if (score > bestScore) {
        best = { area: item.area, item, page };
        bestScore = score;
      }
    };
    for (const pg of pageList(item)) {
      consider(pg, pg.href);
      for (const a of pg.also ?? []) consider(pg, a);
    }
    for (const pg of item.palette ?? []) consider(null, pg.href);
  }
  return best;
}

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

// Same place, even when one side is an access-trimmed copy (itemFor).
export function samePlace(a: NavItem | null | undefined, b: NavItem | null | undefined): boolean {
  return !!a && !!b && a.area === b.area && a.label === b.label;
}

// --- access ---------------------------------------------------------------

function canSee(access: Access, href: string, adminOnly?: boolean, needs?: ModuleKey): boolean {
  if (adminOnly && !access.admin) return false;
  if (needs && !canUse(access, needs)) return false;
  return canOpenHref(access, href);
}

// A place trimmed to what a member can open: pages they can't open drop out,
// its href moves to the first page left, and it disappears when none are left.
export function itemFor(access: Access | null, it: NavItem): NavItem | null {
  if (!access) return null;
  if (it.children) {
    const children = it.children.map((c) => itemFor(access, c)).filter((c): c is NavItem => !!c);
    if (!children.length) return null;
    return { ...it, href: children[0].href, children };
  }
  const pages = it.pages?.filter((pg) => canSee(access, pg.href, pg.adminOnly, pg.needs));
  if (it.pages && !pages?.length) return null;
  if (!it.pages && !canSee(access, it.href)) return null;
  return { ...it, href: pages?.[0]?.href ?? it.href, pages };
}

// NAV trimmed to the places a member can open; sections left empty drop out.
// Null access (still loading) shows nothing, so a restricted member never
// sees a flash of places they can't open.
export function navFor(access: Access | null): NavSection[] {
  if (!access) return [];
  if (access.admin) return NAV;
  return NAV.map((s) => ({ ...s, items: s.items.map((it) => itemFor(access, it)).filter((it): it is NavItem => !!it) })).filter(
    (s) => s.items.length > 0,
  );
}

// Section tabs for the place the member is on: shown when it has two or more
// pages they can open.
export function sectionTabs(active: ActiveNav | null, access: Access | null): NavPage[] {
  if (!active || !access) return [];
  const it = itemFor(access, active.item);
  return it?.pages && it.pages.length > 1 ? it.pages : [];
}
