"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/pm";
import s from "./studio.module.css";

// One header for every Email page (04-ia.md): eyebrow, UPPERCASE title, one
// sentence, one primary action, then the tabs. The tabs are real routes.
// Audiences and Brand settings are pages of other places now (Customers ·
// Segments, Settings · Brand & email), so they are not Email tabs; their old
// URLs still work and keep their own header without the Email tabs.
const TABS = [
  { key: "home", label: "Overview", href: "/dashboard/email" },
  { key: "campaigns", label: "Campaigns", href: "/dashboard/email/campaigns" },
  { key: "automations", label: "Automations", href: "/dashboard/email/automations" },
  { key: "templates", label: "Templates", href: "/dashboard/email/templates" },
  { key: "results", label: "Results", href: "/dashboard/analytics" },
];

export type StudioTab = "home" | "campaigns" | "templates" | "automations" | "results" | "audiences" | "settings";

const ELSEWHERE: Partial<Record<StudioTab, string>> = { audiences: "Customers", settings: "Settings" };

// `back` turns the header into a detail header: a back link instead of the
// crumb, and no tab row (builder, report, template editor, automation).
export function StudioHeader({
  tab,
  title,
  summary,
  actions,
  back,
}: {
  tab: StudioTab;
  title?: ReactNode;
  /** One plain sentence under the title, key number in <b>. */
  summary?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  const router = useRouter();
  const elsewhere = ELSEWHERE[tab];
  return (
    <PageHeader
      crumb={
        back ? (
          <Link href={back.href} className={s.back}>
            <ArrowLeft size={14} aria-hidden /> {back.label}
          </Link>
        ) : (
          elsewhere ?? "Marketing · Email"
        )
      }
      title={title ?? "Email"}
      summary={summary}
      actions={actions}
      tabs={back || elsewhere ? undefined : TABS.map(({ key, label }) => ({ key, label }))}
      activeTab={tab}
      onTab={(k) => {
        const t = TABS.find((x) => x.key === k);
        if (t) router.push(t.href);
      }}
    />
  );
}
