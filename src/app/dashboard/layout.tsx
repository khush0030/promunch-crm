"use client";
import { useState, useEffect } from "react";
import Sidebar, { MobileHeader } from "@/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(true);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "#09090b" }}>
      {isMobile && <MobileHeader onToggle={() => setSidebarOpen(!sidebarOpen)} />}
      
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 90 }}
        />
      )}

      <Sidebar isOpen={isMobile ? sidebarOpen : true} onToggle={() => setSidebarOpen(false)} isMobile={isMobile} />
      
      <main
        style={{
          flex: 1,
          marginLeft: isMobile ? 0 : "260px",
          overflowY: "auto",
          minHeight: "100vh",
          backgroundColor: "#09090b",
          padding: isMobile ? "72px 16px 32px" : "32px",
        }}
      >
        {children}
      </main>
    </div>
  );
}
