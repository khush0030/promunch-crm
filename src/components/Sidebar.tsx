"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, LogOut, Menu, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type NavLink = { href: string; label: string; icon: React.ReactNode; countKey?: string };
type NavGroup = { id: string; label: string; items: NavLink[] };

const ICON_PROPS = { fill: "none", stroke: "currentColor", strokeWidth: 1.8 } as const;

const groups: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "inbox",
    label: "Inbox",
    items: [
      {
        href: "/dashboard/support-emails",
        label: "Support Emails",
        countKey: "supportPending",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        ),
      },
      {
        href: "/dashboard/whatsapp",
        label: "WhatsApp",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 21l2-5.5a8.5 8.5 0 0 1 7.5-12 8.38 8.38 0 0 1 8.5 8z" />
          </svg>
        ),
      },
      {
        href: "/dashboard/order-confirmations",
        label: "Order Confirmations",
        countKey: "confirmationsMissing",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            <path d="m9 11 3 3L22 4" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "audience",
    label: "Audience",
    items: [
      {
        href: "/dashboard/contacts",
        label: "Contacts",
        countKey: "contactsTotal",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    items: [
      {
        href: "/dashboard/campaigns",
        label: "Campaigns",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <path d="m3 11 18-5v12L3 14v-3z" />
            <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
          </svg>
        ),
      },
      {
        href: "/dashboard/flows",
        label: "Flows",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="12" r="2.5" />
            <path d="M8.5 6H14a3 3 0 0 1 3 3v.5M8.5 18H14a3 3 0 0 0 3-3v-.5" />
          </svg>
        ),
      },
      {
        href: "/dashboard/analytics",
        label: "Analytics",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <path d="M3 3v18h18" />
            <path d="M7 15v-4M12 15V7M17 15v-7" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      {
        href: "/dashboard/integrations",
        label: "Integrations",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
            <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
          </svg>
        ),
      },
      {
        href: "/dashboard/team",
        label: "Team",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: (
          <svg viewBox="0 0 24 24" {...ICON_PROPS}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.62.78 1.05 1.42 1.05H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        ),
      },
    ],
  },
];

const STORAGE_PREFIX = "promunch.sidebar.";

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
        <div className="brand-text">
          <b>PROMUNCH</b>
        </div>
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const next: Record<string, boolean> = {};
    for (const g of groups) {
      const raw = localStorage.getItem(STORAGE_PREFIX + g.id);
      if (raw === "1") next[g.id] = true;
    }
    setCollapsed(next);

    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        const meta = data.user.user_metadata || {};
        const name =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          (data.user.email ? data.user.email.split("@")[0] : "User");
        setUser({ email: data.user.email || "", name });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        const meta = session.user.user_metadata || {};
        const name =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          (session.user.email ? session.user.email.split("@")[0] : "User");
        setUser({ email: session.user.email || "", name });
      } else {
        setUser(null);
      }
    });
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

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_PREFIX + id, next[id] ? "1" : "0");
      } catch {}
      return next;
    });
  };

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
        <div
          className={`sidebar-overlay${isOpen ? " show" : ""}`}
          onClick={onToggle}
          aria-hidden
        />
      )}
      <aside className={`sidebar${isMobile && isOpen ? " open" : ""}`}>
        <div className="brand">
          <Image
            src="/pm-logo-square.png"
            alt="PROMUNCH"
            width={36}
            height={36}
            style={{ borderRadius: 8, display: "block" }}
            priority
          />
          <div className="brand-text">
            <b>PROMUNCH</b>
            <span>CRM</span>
          </div>
          {isMobile && (
            <button
              type="button"
              onClick={onToggle}
              aria-label="Close menu"
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: "var(--side-text)",
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <nav className="nav">
          {groups.map((g) => {
            const isCollapsed = hydrated && !!collapsed[g.id];
            return (
              <div key={g.id} className={`nav-group${isCollapsed ? " collapsed" : ""}`}>
                <button
                  type="button"
                  className="nav-group-head"
                  onClick={() => toggleGroup(g.id)}
                  aria-expanded={isCollapsed ? "false" : "true"}
                >
                  <ChevronDown className="chev" size={11} />
                  {g.label}
                </button>
                <div className="nav-group-items">
                  {g.items.map((it) => {
                    const active = isActive(it.href);
                    const count = it.countKey ? counts?.[it.countKey] : undefined;
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        className={`nav-item${active ? " active" : ""}`}
                        onClick={isMobile ? onToggle : undefined}
                      >
                        {it.icon}
                        <span style={{ flex: 1 }}>{it.label}</span>
                        {count !== undefined && count !== null && count !== "" && (
                          <span className="count">{count}</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="user">
          <div className="avatar" style={{ background: "var(--accent)" }}>
            {userInitials}
          </div>
          <div className="meta">
            <b>{userName}</b>
            <span>{userEmail}</span>
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
                color: "var(--side-text)",
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
