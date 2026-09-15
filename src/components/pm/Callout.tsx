import type { ReactNode } from "react";

// Full-width banner for one important fact plus an optional action.
export function Callout({
  tone = "plain",
  title,
  body,
  action,
}: {
  tone?: "crit" | "sun" | "plain";
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`pm2-callout${tone === "plain" ? "" : " " + tone}`}>
      <div>
        <div className="t">{title}</div>
        {body != null && <div className="c">{body}</div>}
      </div>
      {action != null && <div className="act">{action}</div>}
    </div>
  );
}

export default Callout;
