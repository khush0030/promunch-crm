"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Mail, GitBranch, BarChart3, Settings,
  Inbox, ChevronRight, X, Menu, MessageSquare,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/support-emails", icon: Inbox, label: "Customer Support Emails" },
  { href: "/dashboard/whatsapp", icon: MessageSquare, label: "WhatsApp" },
  { href: "/dashboard/contacts", icon: Users, label: "Contacts" },
  { href: "/dashboard/campaigns", icon: Mail, label: "Campaigns" },
  { href: "/dashboard/flows", icon: GitBranch, label: "Flows" },
  { href: "/dashboard/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar({ isOpen, onToggle, isMobile }: { isOpen: boolean; onToggle: () => void; isMobile: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <div
      style={{
        width: "260px", minWidth: "260px", height: "100vh",
        backgroundColor: "#ffffff", borderRight: "1px solid #e5e7eb",
        display: "flex", flexDirection: "column",
        position: "fixed", top: 0, left: isOpen ? 0 : -280,
        zIndex: 100, transition: "left 0.25s ease",
      }}
    >
      <div style={{ padding: "20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Image src="/promunch-logo.png" alt="PROMUNCH" width={40} height={40} style={{ borderRadius: "8px" }} />
          <div>
            <div style={{ fontWeight: 900, fontSize: "17px", color: "#111827", letterSpacing: "2px" }}>PROMUNCH</div>
            <div style={{ fontSize: "10px", color: "#B91C4A", fontWeight: 700, letterSpacing: "2px" }}>CRM</div>
          </div>
        </div>
        {isMobile && (
          <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", padding: "4px" }}>
            <X size={20} />
          </button>
        )}
      </div>

      <nav style={{ flex: 1, padding: "12px", overflowY: "auto" }}>
        <div style={{ fontSize: "10px", fontWeight: 600, color: "#9ca3af", letterSpacing: "1px", textTransform: "uppercase", padding: "8px 8px 8px" }}>
          Main Menu
        </div>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} onClick={isMobile ? onToggle : undefined} style={{ textDecoration: "none" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "8px", marginBottom: "2px", cursor: "pointer",
                borderLeft: active ? "3px solid #B91C4A" : "3px solid transparent",
                backgroundColor: active ? "rgba(185, 28, 74, 0.08)" : "transparent",
                color: active ? "#B91C4A" : "#4b5563",
                fontWeight: active ? 600 : 500, fontSize: "14px",
              }}>
                <item.icon size={18} />
                {item.label}
                {active && <ChevronRight size={14} style={{ marginLeft: "auto", opacity: 0.6 }} />}
              </div>
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: "16px", borderTop: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, #B91C4A, #8B1539)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "#fff", flexShrink: 0 }}>K</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Khush Mutha</div>
            <div style={{ fontSize: "11px", color: "#6b7280" }}>khush@promunch.in</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileHeader({ onToggle }: { onToggle: () => void }) {
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0,
      height: "56px", backgroundColor: "#ffffff", borderBottom: "1px solid #e5e7eb",
      display: "flex", alignItems: "center", padding: "0 16px", zIndex: 80, justifyContent: "space-between",
    }}>
      <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: "#4b5563", padding: "8px" }}>
        <Menu size={24} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Image src="/promunch-logo.png" alt="PROMUNCH" width={28} height={28} style={{ borderRadius: "6px" }} />
        <span style={{ fontWeight: 900, fontSize: "15px", color: "#111827", letterSpacing: "2px" }}>PROMUNCH</span>
      </div>
      <div style={{ width: "40px" }} />
    </div>
  );
}
