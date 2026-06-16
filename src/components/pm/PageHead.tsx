import type { ReactNode } from "react";

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
    <div className="pm-head">
      <div>
        {back}
        <h1>{title}</h1>
        {subtitle != null && <p>{subtitle}</p>}
      </div>
      {actions != null && <div className="pm-acts">{actions}</div>}
    </div>
  );
}

export default PageHead;
