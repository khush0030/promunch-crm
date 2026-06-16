import type { ReactNode } from "react";

// 3-pane inbox shell: conversation list · thread · context. Each pane is a
// raised card column. Used by WhatsApp inbox + Tickets.
export function InboxLayout({
  list,
  thread,
  context,
}: {
  list: ReactNode;
  thread: ReactNode;
  context: ReactNode;
}) {
  return (
    <div className="pm-inbox">
      <div className="pm-ibcol">
        <div className="pm-iblist">{list}</div>
      </div>
      <div className="pm-ibcol">{thread}</div>
      <div className="pm-ibcol">
        <div className="pm-ctx">{context}</div>
      </div>
    </div>
  );
}

export default InboxLayout;
