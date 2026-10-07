"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/pm";
import s from "./studio.module.css";

// One header for every Email Studio page; the tabs are real routes.
const TABS = [
  { key: "home", label: "Home", href: "/dashboard/email" },
  { key: "campaigns", label: "Campaigns", href: "/dashboard/email/campaigns" },
  { key: "templates", label: "Templates", href: "/dashboard/email/templates" },
  { key: "audiences", label: "Audiences", href: "/dashboard/email/audiences" },
  { key: "automations", label: "Automations", href: "/dashboard/email/automations" },
  { key: "settings", label: "Brand & settings", href: "/dashboard/email/settings" },
];

export type StudioTab = "home" | "campaigns" | "templates" | "audiences" | "automations" | "settings";

// `back` turns the header into a detail header: a back link instead of the
// crumb, and no tab row (builder, report, template editor).
export function StudioHeader({
  tab,
  title,
  actions,
  back,
}: {
  tab: StudioTab;
  title?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  const router = useRouter();
  return (
    <PageHeader
      crumb={
        back ? (
          <Link href={back.href} className={s.back}>
            <ArrowLeft size={14} aria-hidden /> {back.label}
          </Link>
        ) : (
          "Marketing · Email"
        )
      }
      title={title ?? "Email"}
      actions={actions}
      tabs={back ? undefined : TABS.map(({ key, label }) => ({ key, label }))}
      activeTab={tab}
      onTab={(k) => {
        const t = TABS.find((x) => x.key === k);
        if (t) router.push(t.href);
      }}
    />
  );
}
