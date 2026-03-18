"use client";
import { useState } from "react";
import Sidebar, { MobileHeader } from "@/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "#09090b" }}>
      <style>{`
        @media (max-width: 768px) {
          .mobile-header { display: flex !important; }
          .mobile-overlay { display: block !important; }
          .mobile-close { display: block !important; }
          .dashboard-main { margin-left: 0 !important; padding-top: 72px !important; padding-left: 16px !important; padding-right: 16px !important; }
        }
        @media (min-width: 769px) {
          .mobile-header { display: none !important; }
          .mobile-overlay { display: none !important; }
          .mobile-close { display: none !important; }
        }
      `}</style>
      <MobileHeader onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(false)} />
      <main
        className="dashboard-main"
        style={{
          flex: 1,
          marginLeft: "260px",
          overflowY: "auto",
          minHeight: "100vh",
          backgroundColor: "#09090b",
          padding: "32px",
        }}
      >
        {children}
      </main>
    </div>
  );
}
