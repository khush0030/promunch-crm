import type { ReactNode } from "react";

export type TableCol<T> = {
  h: ReactNode;
  key?: keyof T;
  render?: (row: T) => ReactNode;
  num?: boolean;
};

export type TableCard = { title: ReactNode; value?: ReactNode; meta?: ReactNode };

// Phone-aware table. Desktop: a real <table>. When `card` is given, phones
// (<=720px) get a stacked card list built from card(row) and the table hides.
export function Table<T>({
  cols,
  rows,
  card,
  rowKey,
  highlight,
  empty,
}: {
  cols: TableCol<T>[];
  rows: T[];
  card?: (row: T) => TableCard;
  rowKey?: (row: T, index: number) => string | number;
  highlight?: (row: T) => boolean;
  // Rendered in place of the table/card list when rows is empty.
  empty?: ReactNode;
}) {
  const k = (r: T, i: number) => (rowKey ? rowKey(r, i) : i);
  const cell = (c: TableCol<T>, r: T): ReactNode => {
    if (c.render) return c.render(r);
    if (c.key != null) {
      const v = r[c.key];
      return v == null ? "" : (v as unknown as ReactNode);
    }
    return null;
  };
  if (rows.length === 0 && empty != null) {
    return <div className="pm2-empty">{empty}</div>;
  }
  return (
    <>
      <div className={`pm2-tbl-wrap${card ? " swap" : ""}`}>
        <table className="pm2-tbl">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} className={c.num ? "n" : undefined}>
                  {c.h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={k(r, ri)} className={highlight?.(r) ? "hl" : undefined}>
                {cols.map((c, ci) => (
                  <td key={ci} className={c.num ? "n" : undefined}>
                    {cell(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card && (
        <div className="pm2-cards">
          {rows.map((r, ri) => {
            const c = card(r);
            return (
              <div key={k(r, ri)} className={`pm2-rowc${highlight?.(r) ? " hl" : ""}`}>
                <div className="t">{c.title}</div>
                <div className="v">{c.value}</div>
                {c.meta != null && <div className="m">{c.meta}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default Table;
