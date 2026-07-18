// Dashboard-segment loading state: neutral placeholder panels while a page
// streams in. Matches the "pm-panel pm-dim" loading pattern used by pages.
export default function DashboardLoading() {
  return (
    <div className="pm-page" aria-busy="true">
      <div className="pm-panel pm-dim" style={{ marginBottom: 14 }}>Loading…</div>
      <div className="pm-grid g-2">
        <div className="pm-panel" style={{ minHeight: 140 }} />
        <div className="pm-panel" style={{ minHeight: 140 }} />
      </div>
    </div>
  );
}
