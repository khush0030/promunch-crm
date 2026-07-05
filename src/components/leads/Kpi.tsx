"use client";

// KPI stat tile for the B2B Leads dashboard. Extracted from
// dashboard/leads/page.tsx.

export default function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="pm-kpi">
      <div className="pm-muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>
        {value}
        {accent ? <span className="pm-badge2 bg-terra" style={{ marginLeft: 8 }}>{accent}</span> : null}
      </div>
    </div>
  );
}
