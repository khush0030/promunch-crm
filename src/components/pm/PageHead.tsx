import type { ReactNode } from "react";
import { SectionTabs } from "@/components/shell/SectionTabs";

// Page title + subtitle on the left, optional actions (ranges, buttons) on the right.
// Matches the prototype `.pagehead`.
export function PageHead({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <>
      <div className="pm-head">
        <div>
          {back}
          <h1>{title}</h1>
          {subtitle != null && <p>{subtitle}</p>}
        </div>
        {actions != null && <div className="pm-acts">{actions}</div>}
      </div>
      {/* The other pages of the same sidebar place (Leads · Deals, ...). */}
      {!back && <SectionTabs />}
    </>
  );
}

export default PageHead;
