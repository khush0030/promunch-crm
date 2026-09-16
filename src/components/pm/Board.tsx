import type { ReactNode } from "react";

export type BoardColumn = { key: string; title: string; count: number; cards: ReactNode[] };

// Kanban board (Tickets by status). On phone the columns become horizontally
// swipeable snap panes that scroll inside the board only — the page itself
// never scrolls sideways (see .pm2-kan in the phone media query).
export function Board({ columns, empty = "Nothing here" }: { columns: BoardColumn[]; empty?: string }) {
  if (columns.length === 0) {
    return <div style={{ color: "var(--pm-hint)", fontSize: 13.5 }}>{empty}</div>;
  }
  return (
    <div className="pm2-kan">
      {columns.map((col) => (
        <div className="pm2-kcol" key={col.key}>
          <h4>
            {col.title} <span>{col.count}</span>
          </h4>
          {col.cards.length === 0 ? (
            <div className="pm2-kc" style={{ color: "var(--pm-hint)" }}>
              {empty}
            </div>
          ) : (
            col.cards.map((card, i) => (
              // Cards are opaque ReactNode content with no stable id available here.
              <div className="pm2-kc" key={`${col.key}-${i}`}>
                {card}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

export default Board;
