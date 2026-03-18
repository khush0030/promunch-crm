"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Mail,
  GitBranch,
  BarChart3,
  Settings,
  Zap,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/contacts", icon: Users, label: "Contacts" },
  { href: "/dashboard/campaigns", icon: Mail, label: "Campaigns" },
  { href: "/dashboard/flows", icon: GitBranch, label: "Flows" },
  { href: "/dashboard/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
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
        left: 0,
        zIndex: 100,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "24px 20px",
          borderBottom: "1px solid #27272a",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Zap size={20} color="#fff" fill="#fff" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "16px", color: "#f4f4f5", letterSpacing: "-0.3px" }}>
            ProMunch
          </div>
          <div style={{ fontSize: "11px", color: "#7c3aed", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>
            CRM
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 12px", overflowY: "auto" }}>
        <div style={{ marginBottom: "4px" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "#52525b", letterSpacing: "1px", textTransform: "uppercase", padding: "8px 8px 4px" }}>
            Main Menu
          </div>
        </div>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  marginBottom: "2px",
                  cursor: "pointer",
                  borderLeft: active ? "3px solid #7c3aed" : "3px solid transparent",
                  backgroundColor: active ? "rgba(124, 58, 237, 0.1)" : "transparent",
                  color: active ? "#a78bfa" : "#a1a1aa",
                  transition: "all 0.15s ease",
                  fontWeight: active ? 600 : 400,
                  fontSize: "14px",
                }}
              >
                <item.icon size={18} />
                {item.label}
                {active && (
                  <ChevronRight size={14} style={{ marginLeft: "auto", opacity: 0.6 }} />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: "16px", borderTop: "1px solid #27272a" }}>
        {/* Shopify Status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 12px",
            borderRadius: "8px",
            backgroundColor: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            marginBottom: "12px",
          }}
        >
          <CheckCircle2 size={16} color="#10b981" />
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#10b981" }}>Shopify Connected</div>
            <div style={{ fontSize: "10px", color: "#71717a" }}>promunch.myshopify.com</div>
          </div>
        </div>

        {/* User */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            A
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#f4f4f5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Admin User
            </div>
            <div style={{ fontSize: "11px", color: "#71717a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              admin@promunch.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
