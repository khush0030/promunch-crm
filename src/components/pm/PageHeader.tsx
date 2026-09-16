import type { ReactNode } from "react";

export type PageHeaderTab = { label: string; key: string; count?: number | string };

// pm v2 page header — the shell renders no header of its own, so every page
// composes this at the top of its body. Ported from the prototype's
// .a-top/.a-crumb/.a-h1/.a-actions (pm2-top/pm2-crumb/pm2-h1/pm2-actions in
// globals.css). `title` sits in the display face (--pm-display). Optional
// `tabs` render a second row (ported from the prototype's .a-tabs, as
// .pm2-tabs) below the crumb/title/actions row.
export function PageHeader({
  crumb,
  title,
  actions,
  tabs,
  activeTab,
  onTab,
}: {
  crumb: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  tabs?: PageHeaderTab[];
  activeTab?: string;
  onTab?: (key: string) => void;
}) {
  return (
    <>
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
      {tabs != null && tabs.length > 0 && (
        <div className="pm2-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === activeTab}
              className={t.key === activeTab ? "on" : undefined}
              onClick={() => onTab?.(t.key)}
            >
              {t.label}
              {t.count != null && <em>{t.count}</em>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default PageHeader;
