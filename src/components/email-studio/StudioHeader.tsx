"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/pm";

// One header for every Email Studio page; the tabs are real routes.
const TABS = [
  { key: "home", label: "Home", href: "/dashboard/email" },
  { key: "campaigns", label: "Campaigns", href: "/dashboard/email/campaigns" },
  { key: "templates", label: "Templates", href: "/dashboard/email/templates" },
  { key: "audiences", label: "Audiences", href: "/dashboard/email/audiences" },
  { key: "automations", label: "Automations", href: "/dashboard/flows" },
  { key: "settings", label: "Brand & settings", href: "/dashboard/email/settings" },
];

export type StudioTab = "home" | "campaigns" | "templates" | "audiences" | "settings";

export function StudioHeader({ tab, title, actions }: { tab: StudioTab; title?: ReactNode; actions?: ReactNode }) {
  const router = useRouter();
  return (
    <PageHeader
      crumb="Marketing · Email Studio"
      title={title ?? "Email Studio"}
      actions={actions}
      tabs={TABS.map(({ key, label }) => ({ key, label }))}
      activeTab={tab}
      onTab={(k) => {
        const t = TABS.find((x) => x.key === k);
        if (t) router.push(t.href);
      }}
    />
  );
}
