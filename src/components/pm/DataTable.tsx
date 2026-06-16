import type { ReactNode } from "react";

export type Column<T> = {
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
};

// Cream-header, hairline-row table wrapped in a raised card. Generic over the
// row type; pass `onRowClick` to make rows clickable.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T, index: number) => void;
  empty?: ReactNode;
}) {
  return (
    <div className="pm-tablewrap">
      <table className="pm-tbl">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ width: c.width, textAlign: c.align }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: "center", color: "var(--pm-hint)", padding: "32px 16px" }}>
                {empty ?? "No rows"}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={onRowClick ? "clickable" : undefined}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              >
                {columns.map((c, ci) => (
                  <td key={ci} style={{ textAlign: c.align }}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
