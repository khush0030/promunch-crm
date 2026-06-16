"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Route as RouteIcon, ShoppingCart, PartyPopper, Gift } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/Toast";
import { PageHead, SectionLabel, StatusBadge, EmptyState } from "@/components/pm";
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
  triggerType: string;
  emails: number;
  revenue: number;
  totalEntered: number;
  totalConverted: number;
  conversion: string;
};

const templates = [
  { icon: <ShoppingCart size={16} />, title: "Abandoned cart", copy: "Recover checkouts left behind, on WhatsApp + email. Recommended first flow." },
  { icon: <PartyPopper size={16} />, title: "Welcome series", copy: "Greet new subscribers and introduce PROMUNCH." },
  { icon: <Gift size={16} />, title: "Post-purchase", copy: "Thank buyers and drive the second order." },
];

export default function FlowsPage() {
  const router = useRouter();
  const toast = useToast();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    const name = prompt("Name your new flow:");
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok || !data.flow) throw new Error(data.error || "Failed to create");
      toast.push({ kind: "success", text: `Flow "${name}" created.` });
      router.push(`/dashboard/flows/${data.flow.id}`);
    } catch (e) {
      toast.push({ kind: "error", text: `Create failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setCreating(false);
    }
  }

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
          triggerType: f.trigger_type || "",
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
        subtitle="Automated email & WhatsApp sequences triggered by customer behaviour"
        actions={<button className="pm-btn primary" onClick={handleCreate} disabled={creating}><Plus size={15} /> {creating ? "Creating…" : "Create flow"}</button>}
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
        <>
          <EmptyState
            icon={<RouteIcon />}
            title={loaded ? "No flows yet" : "Loading…"}
            cta={loaded ? <button className="pm-btn primary" onClick={handleCreate} disabled={creating}><Plus size={15} /> Create flow</button> : undefined}
            style={{ marginBottom: 16 }}
          >
            {loaded ? "Create automated flows like abandoned-cart recovery, welcome series, or post-purchase upsells." : undefined}
          </EmptyState>
          {loaded && (
            <>
              <SectionLabel>Start from a template</SectionLabel>
              <div className="pm-cards3">
                {templates.map((t) => (
                  <div className="pm-minicard" key={t.title}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="ic2 a" style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--pm-gold-soft)", color: "var(--pm-gold)" }}>{t.icon}</span>
                      <b>{t.title}</b>
                    </div>
                    <p>{t.copy}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
