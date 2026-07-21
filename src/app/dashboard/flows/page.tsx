"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Route as RouteIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHead, StatusBadge, EmptyState } from "@/components/pm";
import type { BadgeTone } from "@/components/pm";

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: "green", label: "Active" },
  draft: { tone: "gray", label: "Draft" },
  paused: { tone: "gold", label: "Paused" },
};

const triggerLabels: Record<string, string> = {
  checkout_abandoned: "Customer abandons checkout",
  order_placed: "Customer places an order",
  customer_created: "New customer created",
  segment_entry: "Customer enters a segment",
  date_based: "Date-based trigger",
};

type FlowRow = {
  id: string;
  name: string;
  status: string;
  trigger: string;
  emails: number;
  revenue: number;
  totalEntered: number;
  totalConverted: number;
  conversion: string;
};

export default function FlowsPage() {
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await supabase.from("flows").select("*").order("created_at", { ascending: false });
      const rows = res.data || [];
      const mapped: FlowRow[] = rows.map((f) => {
        const stepCount = Array.isArray(f.steps) ? f.steps.length : 0;
        const conv = f.total_entered > 0 ? ((f.total_converted / f.total_entered) * 100).toFixed(1) + "%" : "";
        return {
          id: f.id,
          name: f.name,
          status: f.status || "draft",
          trigger: triggerLabels[f.trigger_type] || f.trigger_type || "",
          emails: stepCount,
          revenue: Number(f.revenue_attributed) || 0,
          totalEntered: f.total_entered || 0,
          totalConverted: f.total_converted || 0,
          conversion: conv,
        };
      });
      setFlows(mapped);
      setLoaded(true);
    }
    load();
  }, []);

  const statusCounts: { tone: BadgeTone; label: string; count: number }[] = [
    { tone: "green", label: "Active", count: flows.filter((f) => f.status === "active").length },
    { tone: "gray", label: "Draft", count: flows.filter((f) => f.status === "draft").length },
    { tone: "gold", label: "Paused", count: flows.filter((f) => f.status === "paused").length },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Flows"
        subtitle="Automated email sequences triggered by customer behaviour"
        actions={<Link className="pm-btn primary" href="/dashboard/flows/new"><Plus size={15} /> Create flow</Link>}
      />

      {flows.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {statusCounts.map((s) => <StatusBadge key={s.label} tone={s.tone}>{s.count} {s.label}</StatusBadge>)}
        </div>
      )}

      {flows.length > 0 ? (
        <div className="pm-grid g-11">
          {flows.map((flow) => {
            const sp = statusMeta[flow.status] || statusMeta.draft;
            return (
              <Link key={flow.id} href={`/dashboard/flows/${flow.id}`} className="pm-panel" style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{flow.name}</div>
                    <div style={{ marginTop: 6 }}><StatusBadge tone={sp.tone}>{sp.label}</StatusBadge></div>
                  </div>
                </div>
                <div className="pm-csub" style={{ marginBottom: 12 }}>Trigger: {flow.trigger || "—"}</div>
                <div style={{ display: "flex", gap: 24, paddingTop: 12, borderTop: "1px solid var(--pm-line)" }}>
                  {[
                    { l: "Emails", v: String(flow.emails), c: "var(--pm-ink)" },
                    { l: "Revenue", v: flow.revenue > 0 ? `₹${flow.revenue.toLocaleString()}` : "₹0", c: flow.revenue > 0 ? "var(--pm-green)" : "var(--pm-hint)" },
                    { l: "Conversion", v: flow.conversion || "—", c: flow.conversion ? "var(--pm-gold)" : "var(--pm-hint)" },
                  ].map((s) => (
                    <div key={s.l}>
                      <div className="pm-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontWeight: 600 }}>{s.l}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<RouteIcon />}
          title={loaded ? "No flows yet" : "Loading…"}
          cta={loaded ? <Link className="pm-btn primary" href="/dashboard/flows/new"><Plus size={15} /> Create flow</Link> : undefined}
        >
          {loaded ? "Start from a template like abandoned-cart recovery, welcome series, or win-back, or build your own." : undefined}
        </EmptyState>
      )}
    </div>
  );
}
