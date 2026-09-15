"use client";
import Shell from "@/components/shell/Shell";
import Onboarding from "@/components/Onboarding";
import { ToastProvider } from "@/components/ui/Toast";
import QueryProvider from "@/components/QueryProvider";
import InboxNotifier from "@/components/whatsapp/InboxNotifier";
import { TooltipLayer } from "@/components/pm/Tooltip";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ToastProvider>
        <Shell>{children}</Shell>
        <Onboarding />
        <InboxNotifier />
        <TooltipLayer />
      </ToastProvider>
    </QueryProvider>
  );
}
