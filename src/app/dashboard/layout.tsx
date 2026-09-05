"use client";
import { useState, useEffect } from "react";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import Onboarding from "@/components/Onboarding";
import { ToastProvider } from "@/components/ui/Toast";
import QueryProvider from "@/components/QueryProvider";
import InboxNotifier from "@/components/whatsapp/InboxNotifier";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseBrowserClient();
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
      // Missing order confirmations — a sidebar badge so a miss is impossible
      // to overlook. Uses the service-role API route, not the anon client.
      try {
        const r = await fetch("/api/whatsapp/confirmations?hours=24", { cache: "no-store" });
        if (r.ok && !cancelled) {
          const d = await r.json();
          if (typeof d?.summary?.outstanding === "number" && d.summary.outstanding > 0) {
            next.confirmationsMissing = d.summary.outstanding;
          }
        }
      } catch {}
      // Failed WhatsApp sends (24h) — red badge on the WhatsApp nav item.
      try {
        const r = await fetch("/api/needs-attention", { cache: "no-store" });
        if (r.ok && !cancelled) {
          const d = await r.json();
          if (typeof d?.failedWhatsApp === "number" && d.failedWhatsApp > 0) {
            next.whatsappFailed = d.failedWhatsApp;
          }
        }
      } catch {}
      if (cancelled) return;
      setCounts(next);
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryProvider>
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
        <Onboarding />
        <InboxNotifier />
      </div>
    </ToastProvider>
    </QueryProvider>
  );
}
