import type { ReactNode } from "react";

// pm v2 page header — the shell renders no header of its own, so every page
// composes this at the top of its body. Ported from the prototype's
// .a-top/.a-crumb/.a-h1/.a-actions (pm2-top/pm2-crumb/pm2-h1/pm2-actions in
// globals.css). `title` sits in the display face (--pm-display).
export function PageHeader({
  crumb,
  title,
  actions,
}: {
  crumb: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pm2-top">
      <div>
        <div className="pm2-crumb">
          <i />
          {crumb}
        </div>
        <h1 className="pm2-h1">{title}</h1>
      </div>
      {actions != null && <div className="pm2-actions">{actions}</div>}
    </div>
  );
}

export default PageHeader;
