"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Mail, GitBranch, BarChart3, Settings,
  Package, CheckCircle2, ChevronRight, X, Menu,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
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
        width: "260px",
        minWidth: "260px",
        height: "100vh",
        backgroundColor: "#111113",
        borderRight: "1px solid #27272a",
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        top: 0,
        left: isOpen ? 0 : -280,
        zIndex: 100,
        transition: "left 0.25s ease",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "20px", borderBottom: "1px solid #27272a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* PROMUNCH PM logo with brand colors */}
          <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "linear-gradient(135deg, #B91C4A, #8B1539)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
            <span style={{ fontWeight: 900, fontSize: "16px", color: "#fff", letterSpacing: "-1px", zIndex: 1 }}>PM</span>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "3px", background: "linear-gradient(90deg, #F5B731, #00B4D8, #E87339, #B91C4A)" }} />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: "17px", color: "#f4f4f5", letterSpacing: "2px" }}>PROMUNCH</div>
            <div style={{ fontSize: "10px", color: "#B91C4A", fontWeight: 700, letterSpacing: "2px" }}>CRM</div>
          </div>
        </div>
        {isMobile && (
          <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: "#71717a", padding: "4px" }}>
            <X size={20} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px", overflowY: "auto" }}>
        <div style={{ fontSize: "10px", fontWeight: 600, color: "#52525b", letterSpacing: "1px", textTransform: "uppercase", padding: "8px 8px 8px" }}>
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
                backgroundColor: active ? "rgba(185, 28, 74, 0.1)" : "transparent",
                color: active ? "#E8658B" : "#a1a1aa",
                fontWeight: active ? 600 : 400, fontSize: "14px",
              }}>
                <item.icon size={18} />
                {item.label}
                {active && <ChevronRight size={14} style={{ marginLeft: "auto", opacity: 0.6 }} />}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: "16px", borderTop: "1px solid #27272a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "8px", backgroundColor: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: "12px" }}>
          <CheckCircle2 size={16} color="#10b981" />
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#10b981" }}>Shopify Connected</div>
            <div style={{ fontSize: "10px", color: "#71717a" }}>promunch.myshopify.com</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, #B91C4A, #8B1539)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "#fff", flexShrink: 0 }}>K</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#f4f4f5" }}>Khush Mutha</div>
            <div style={{ fontSize: "11px", color: "#71717a" }}>khush@promunch.in</div>
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
      height: "56px", backgroundColor: "#111113", borderBottom: "1px solid #27272a",
      display: "flex", alignItems: "center", padding: "0 16px", zIndex: 80, justifyContent: "space-between",
    }}>
      <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: "#a1a1aa", padding: "8px" }}>
        <Menu size={24} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "linear-gradient(135deg, #B91C4A, #8B1539)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontWeight: 900, fontSize: "10px", color: "#fff" }}>PM</span>
        </div>
        <span style={{ fontWeight: 900, fontSize: "15px", color: "#f4f4f5", letterSpacing: "2px" }}>PROMUNCH</span>
      </div>
      <div style={{ width: "40px" }} />
    </div>
  );
}
