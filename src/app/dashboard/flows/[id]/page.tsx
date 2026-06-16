"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Play, Pause, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/Toast";
import { PageHead, KpiCard, Panel, StatusBadge } from "@/components/pm";
import type { BadgeTone } from "@/components/pm";

type Step = {
  type?: "wait" | "email" | "condition" | "exit" | string;
  label?: string;
  sub?: string;
  delay_hours?: number;
  subject?: string;
};

type Flow = {
  id: string;
  name: string;
  description?: string | null;
  trigger_type?: string | null;
  status?: string;
  steps?: Step[] | null;
  total_entered?: number;
  total_completed?: number;
  total_converted?: number;
  revenue_attributed?: number;
  created_at?: string;
};

const triggerLabels: Record<string, string> = {
  checkout_abandoned: "Cart abandoned",
  order_placed: "Order placed",
  customer_created: "New customer",
  segment_entry: "Segment entry",
  date_based: "Date-based",
};

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: "green", label: "Active" },
  draft: { tone: "gray", label: "Draft" },
  paused: { tone: "gold", label: "Paused" },
};

const stepColor = (t?: string) =>
  t === "email" ? "var(--pm-terra)" : t === "wait" ? "var(--pm-gold)" : t === "condition" ? "var(--pm-blue)" : "var(--pm-hint)";

export default function FlowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("");

  useEffect(() => {
    async function load() {
      const res = await supabase.from("flows").select("*").eq("id", id).maybeSingle();
      if (res.error || !res.data) {
        setNotFound(true);
      } else {
        const f = res.data as Flow;
        setFlow(f);
        setName(f.name || "");
        setTriggerType(f.trigger_type || "customer_created");
      }
      setLoaded(true);
    }
    load();
  }, [id]);

  async function toggleStatus() {
    if (!flow) return;
    const next = flow.status === "active" ? "paused" : "active";
    setBusy(true);
    try {
      const res = await supabase.from("flows").update({ status: next }).eq("id", flow.id).select().maybeSingle();
      if (res.error) throw res.error;
      if (res.data) setFlow(res.data as Flow);
      toast.push({ kind: "success", text: `Flow ${next === "active" ? "activated" : "paused"}.` });
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (!flow) return;
    setBusy(true);
    try {
      const res = await supabase.from("flows").update({ name, trigger_type: triggerType }).eq("id", flow.id).select().maybeSingle();
      if (res.error) throw res.error;
      if (res.data) setFlow(res.data as Flow);
      toast.push({ kind: "success", text: "Flow updated." });
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!flow) return;
    if (!confirm(`Delete "${flow.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await supabase.from("flows").delete().eq("id", flow.id);
      if (res.error) throw res.error;
      toast.push({ kind: "success", text: "Flow deleted." });
      router.push("/dashboard/flows");
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setBusy(false);
    }
  }

  const backLink = (
    <Link href="/dashboard/flows" className="more" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--pm-muted)", fontSize: 12 }}>
      <ArrowLeft size={14} /> Back to flows
    </Link>
  );

  if (!loaded) return <div className="pm-page"><PageHead title="Flow" subtitle="Loading…" /></div>;
  if (notFound || !flow) return <div className="pm-page"><PageHead back={backLink} title="Not found" subtitle="This flow doesn’t exist." /></div>;

  const sp = statusMeta[flow.status || "draft"] || statusMeta.draft;
  const steps = flow.steps || [];
  const totalEntered = flow.total_entered || 0;
  const totalConverted = flow.total_converted || 0;
  const conversion = totalEntered > 0 ? ((totalConverted / totalEntered) * 100).toFixed(1) + "%" : "—";
  const revenue = Number(flow.revenue_attributed) || 0;

  return (
    <div className="pm-page">
      <PageHead
        back={backLink}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>{flow.name} <StatusBadge tone={sp.tone}>{sp.label}</StatusBadge></span>}
        subtitle={`Trigger: ${triggerLabels[flow.trigger_type || ""] || flow.trigger_type || "—"}`}
        actions={
          <>
            <button className="pm-btn ghost" onClick={toggleStatus} disabled={busy}>
              {flow.status === "active" ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Activate</>}
            </button>
            <button className="pm-btn ghost" onClick={handleDelete} disabled={busy} style={{ color: "var(--pm-terra)" }}><Trash2 size={15} /> Delete</button>
          </>
        }
      />

      <div className="pm-kpis">
        <KpiCard label="Entered" value={totalEntered.toLocaleString("en-IN")} tone="b" />
        <KpiCard label="Converted" value={totalConverted.toLocaleString("en-IN")} tone="g" />
        <KpiCard label="Conversion" value={conversion} tone="o" />
        <KpiCard label="Revenue" value={revenue > 0 ? `₹${revenue.toLocaleString("en-IN")}` : "—"} tone="t" valueColor={revenue > 0 ? "var(--pm-green)" : undefined} />
      </div>

      <div className="pm-grid g-11" style={{ marginTop: 16 }}>
        <Panel title="Settings" caption="Update the flow name and trigger.">
          <div className="pm-field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} title="Flow name" />
          </div>
          <div className="pm-field">
            <label>Trigger</label>
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} title="Trigger">
              {Object.entries(triggerLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button className="pm-btn primary" onClick={saveDetails} disabled={busy}>Save changes</button>
        </Panel>

        <Panel title="Steps" caption={steps.length > 0 ? `${steps.length} step${steps.length === 1 ? "" : "s"} in this flow` : "No steps yet — add one to start"}>
          {steps.length > 0 ? (
            <div>
              {steps.map((s, i) => (
                <div key={i} className="pm-pill">
                  <span className="d" style={{ background: stepColor(s.type) }} />
                  <span className="nm">{s.label || s.type || `Step ${i + 1}`}</span>
                  <span className="pm-dim" style={{ fontSize: 12 }}>{s.sub || s.subject || ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="pm-dim" style={{ fontSize: 13 }}>Step editor is coming soon. The flow can still be paused or activated.</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
