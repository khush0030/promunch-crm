"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Play, Pause, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/Toast";

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

const statusPill: Record<string, { cls: string; label: string }> = {
  active: { cls: "green", label: "Active" },
  draft: { cls: "grey", label: "Draft" },
  paused: { cls: "amber", label: "Paused" },
};

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
      const res = await supabase
        .from("flows")
        .update({ status: next })
        .eq("id", flow.id)
        .select()
        .maybeSingle();
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
      const res = await supabase
        .from("flows")
        .update({ name, trigger_type: triggerType })
        .eq("id", flow.id)
        .select()
        .maybeSingle();
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

  if (!loaded) {
    return (
      <div className="page">
        <div className="muted">Loading…</div>
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      <div className="page">
        <Link
          href="/dashboard/flows"
          style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--text-2)", fontSize: 13 }}
        >
          <ChevronLeft size={14} /> Back to Flows
        </Link>
        <div className="muted" style={{ marginTop: 18 }}>
          Flow not found.
        </div>
      </div>
    );
  }

  const sp = statusPill[flow.status || "draft"] || statusPill.draft;
  const steps = flow.steps || [];
  const totalEntered = flow.total_entered || 0;
  const totalConverted = flow.total_converted || 0;
  const conversion = totalEntered > 0 ? ((totalConverted / totalEntered) * 100).toFixed(1) + "%" : "—";
  const revenue = Number(flow.revenue_attributed) || 0;

  return (
    <div className="page">
      <Link
        href="/dashboard/flows"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-2)",
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        <ChevronLeft size={14} /> Back to Flows
      </Link>

      <div className="page-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1>{flow.name}</h1>
            <span className={`pill ${sp.cls}`}>{sp.label}</span>
          </div>
          <div className="sub">
            Trigger: {triggerLabels[flow.trigger_type || ""] || flow.trigger_type || "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn" onClick={toggleStatus} disabled={busy}>
            {flow.status === "active" ? (
              <>
                <Pause size={14} /> Pause
              </>
            ) : (
              <>
                <Play size={14} /> Activate
              </>
            )}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleDelete}
            disabled={busy}
            style={{ color: "var(--accent)", borderColor: "var(--accent-soft)" }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Entered</div>
          <div className="value">{totalEntered.toLocaleString("en-IN")}</div>
        </div>
        <div className="kpi">
          <div className="label">Converted</div>
          <div className="value">{totalConverted.toLocaleString("en-IN")}</div>
        </div>
        <div className="kpi">
          <div className="label">Conversion</div>
          <div className="value">{conversion}</div>
        </div>
        <div className="kpi">
          <div className="label">Revenue</div>
          <div className="value" style={{ color: revenue > 0 ? "var(--green)" : undefined }}>
            {revenue > 0 ? `₹${revenue.toLocaleString("en-IN")}` : "—"}
          </div>
        </div>
      </div>

      <div className="grid-2 section">
        <div className="card card-pad">
          <div className="card-title">Settings</div>
          <div className="card-sub">Update the flow name and trigger.</div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                title="Flow name"
              />
            </div>
            <div className="field">
              <label>Trigger</label>
              <select
                className="input"
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value)}
                title="Trigger"
              >
                {Object.entries(triggerLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button type="button" className="btn primary" onClick={saveDetails} disabled={busy}>
                Save changes
              </button>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <div className="card-title">Steps</div>
          <div className="card-sub">
            {steps.length > 0
              ? `${steps.length} step${steps.length === 1 ? "" : "s"} in this flow`
              : "No steps yet — add one to start"}
          </div>
          {steps.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              {steps.map((s, i) => (
                <div key={i} className="legend-row">
                  <div className="legend-l">
                    <span
                      className="dot"
                      style={{
                        background:
                          s.type === "email"
                            ? "var(--accent)"
                            : s.type === "wait"
                            ? "var(--amber)"
                            : s.type === "condition"
                            ? "var(--blue)"
                            : "var(--text-3)",
                      }}
                    />
                    {s.label || s.type || `Step ${i + 1}`}
                  </div>
                  <div className="legend-r muted">{s.sub || s.subject || ""}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 14, fontSize: 13 }}>
              Step editor is coming soon. The flow can still be paused or activated.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
