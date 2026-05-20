"use client";
import { useState, useEffect } from "react";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [counts, setCounts] = useState<Record<string, number | string>>({});

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [contactsRes, supportRes] = await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }),
        supabase
          .from("email_threads")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);
      if (cancelled) return;
      const next: Record<string, number | string> = {};
      if (typeof contactsRes.count === "number" && contactsRes.count > 0) {
        next.contactsTotal = contactsRes.count.toLocaleString("en-IN");
      }
      if (typeof supportRes.count === "number" && supportRes.count > 0) {
        next.supportPending = supportRes.count;
      }
      setCounts(next);
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ToastProvider>
      <div className="app">
        {isMobile && <MobileHeader onToggle={() => setSidebarOpen(!sidebarOpen)} />}
        <Sidebar
          isOpen={isMobile ? sidebarOpen : true}
          onToggle={() => setSidebarOpen(false)}
          isMobile={isMobile}
          counts={counts}
        />
        <main className="main">{children}</main>
      </div>
    </ToastProvider>
  );
}
