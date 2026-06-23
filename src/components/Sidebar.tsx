"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Mail,
  MessageCircle,
  CircleCheck,
  Store,
  Package,
  Briefcase,
  Users,
  Megaphone,
  Route as RouteIcon,
  BarChart3,
  Settings as SettingsIcon,
  HelpCircle,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type NavLink = {
  href?: string;
  label: string;
  icon: React.ReactNode;
  countKey?: string;
  tour?: string; // data-tour anchor for the onboarding spotlight
  action?: "tour"; // renders a button instead of a link
};
type NavGroup = { id: string; label?: string; items: NavLink[] };

// Simplified warm-editorial nav. Integrations + Team fold into Settings tabs,
// so they're no longer top-level items — the routes stay reachable from there
// (and by URL). Every other route keeps its place.
const groups: NavGroup[] = [
  {
    id: "overview",
    items: [{ href: "/dashboard", label: "Dashboard", tour: "dashboard", icon: <LayoutDashboard /> }],
  },
  {
    id: "inbox",
    label: "Inbox",
    items: [
      { href: "/dashboard/support-emails", label: "Support Emails", tour: "support-emails", countKey: "supportPending", icon: <Mail /> },
      { href: "/dashboard/whatsapp", label: "WhatsApp", tour: "whatsapp", countKey: "whatsappFailed", icon: <MessageCircle /> },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      { href: "/dashboard/order-confirmations", label: "Order Confirmations", tour: "order-confirmations", countKey: "confirmationsMissing", icon: <CircleCheck /> },
      { href: "/dashboard/shopify-attribution", label: "Shopify", icon: <Store /> },
      { href: "/dashboard/amazon", label: "Amazon", icon: <Package /> },
      { href: "/dashboard/leads", label: "B2B Leads", icon: <Briefcase /> },
    ],
  },
  {
    id: "audience",
    label: "Audience",
    items: [
      { href: "/dashboard/contacts", label: "Contacts", tour: "contacts", icon: <Users /> },
      { href: "/dashboard/campaigns", label: "Campaigns", tour: "campaigns", icon: <Megaphone /> },
      { href: "/dashboard/flows", label: "Flows", icon: <RouteIcon /> },
      { href: "/dashboard/analytics", label: "Analytics", icon: <BarChart3 /> },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { href: "/dashboard/settings", label: "Settings", tour: "settings", icon: <SettingsIcon /> },
      { label: "Help & tour", action: "tour", icon: <HelpCircle /> },
    ],
  },
];

export function MobileHeader({ onToggle }: { onToggle: () => void }) {
  return (
    <header className="mobile-header">
      <button type="button" onClick={onToggle} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Image
          src="/pm-logo-square.png"
          alt="PROMUNCH"
          width={28}
          height={28}
          style={{ borderRadius: 6, display: "block" }}
          priority
        />
        <b style={{ fontSize: 14, fontWeight: 700 }}>PROMUNCH</b>
      </div>
      <div style={{ width: 28 }} />
    </header>
  );
}

export default function Sidebar({
  isOpen,
  onToggle,
  isMobile,
  counts,
}: {
  isOpen: boolean;
  onToggle: () => void;
  isMobile: boolean;
  counts?: Record<string, number | string | undefined>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const resolve = (u: { email?: string | null; user_metadata?: Record<string, unknown> } | null) => {
      if (!u) return setUser(null);
      const meta = u.user_metadata || {};
      const name =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        (u.email ? u.email.split("@")[0] : "User");
      setUser({ email: u.email || "", name });
    };
    supabase.auth.getUser().then(({ data }) => resolve(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => resolve(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const userName = user?.name || "Signed out";
  const userEmail = user?.email || "—";
  const userInitials = (user?.name || user?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      {isMobile && (
        <div className={`sidebar-overlay${isOpen ? " show" : ""}`} onClick={onToggle} aria-hidden />
      )}
      <aside className={`pm-side${isMobile && isOpen ? " open" : ""}`}>
        <div className="pm-brand">
          <Image
            src="/pm-logo-square.png"
            alt="PROMUNCH"
            width={30}
            height={30}
            style={{ borderRadius: 8, display: "block" }}
            priority
          />
          <div>
            <b>PROMUNCH</b>
            <span>CRM</span>
          </div>
          {isMobile && (
            <button
              type="button"
              onClick={onToggle}
              aria-label="Close menu"
              style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--pm-side-text)", cursor: "pointer" }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {groups.map((g) => (
          <div key={g.id}>
            {g.label && <div className="pm-navgroup">{g.label}</div>}
            {g.items.map((it) => {
              if (it.action === "tour") {
                return (
                  <button
                    key="help-tour"
                    type="button"
                    className="pm-nav"
                    style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                    onClick={() => {
                      if (isMobile) onToggle();
                      window.dispatchEvent(new Event("pm:start-tour"));
                    }}
                  >
                    {it.icon}
                    <span style={{ flex: 1 }}>{it.label}</span>
                  </button>
                );
              }
              const href = it.href!;
              const active = isActive(href);
              const count = it.countKey ? counts?.[it.countKey] : undefined;
              const showCount = count !== undefined && count !== null && count !== "" && count !== 0;
              return (
                <Link
                  key={href}
                  href={href}
                  data-tour={it.tour}
                  className={`pm-nav${active ? " on" : ""}`}
                  onClick={isMobile ? onToggle : undefined}
                >
                  {it.icon}
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {showCount && <span className="pm-badge">{count}</span>}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="pm-foot">
          <div className="pm-av">{userInitials}</div>
          <div style={{ minWidth: 0 }}>
            <div className="pm-nm">{userName}</div>
            <div className="pm-em">{userEmail}</div>
          </div>
          {user && (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-label="Sign out"
              title="Sign out"
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: "var(--pm-side-dim)",
                cursor: signingOut ? "not-allowed" : "pointer",
                padding: 4,
                borderRadius: 6,
              }}
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
