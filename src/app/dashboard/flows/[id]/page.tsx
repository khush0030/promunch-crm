"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Play, Pause, Trash2, Plus, Mail, Clock, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/Toast";
import { PageHead, KpiCard, Panel, StatusBadge } from "@/components/pm";
import type { BadgeTone } from "@/components/pm";

type Step = {
  type: string;
  delay_hours: number;
  subject: string;
  body_html: string;
  coupon_code?: string;
  preview_text?: string;
  subject_variants?: string[];
  preview_variants?: string[];
  format?: "designed" | "plain";
  signature?: string;
  from_name?: string;
};

type VariantStat = {
  step_index: number;
  variant: string;
  sends: number;
  opens: number;
  clicks: number;
  open_rate: number;
  click_rate: number;
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

type Flow = {
  id: string;
  name: string;
  description?: string | null;
  trigger_type?: string | null;
  trigger_config?: Record<string, unknown> | null;
  status?: string;
  steps?: Step[] | null;
  total_entered?: number;
  total_completed?: number;
  total_converted?: number;
  revenue_attributed?: number;
};

const triggerLabels: Record<string, string> = {
  checkout_abandoned: "Customer abandons checkout",
  order_placed: "Customer places an order",
  customer_created: "New subscriber / customer",
  segment_entry: "Customer enters a segment",
  date_based: "Date-based",
};

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: "green", label: "Active" },
  draft: { tone: "gray", label: "Draft" },
  paused: { tone: "gold", label: "Paused" },
};

function emptyStep(): Step {
  return { type: "email", delay_hours: 24, subject: "", body_html: "<p></p>" };
}

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
  const [coupon, setCoupon] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [variantStats, setVariantStats] = useState<VariantStat[]>([]);

  useEffect(() => {
    fetch(`/api/flows/${id}/variants`)
      .then((r) => (r.ok ? r.json() : { stats: [] }))
      .then((j) => setVariantStats(Array.isArray(j.stats) ? j.stats : []))
      .catch(() => setVariantStats([]));
  }, [id]);

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
        setCoupon(((f.trigger_config as Record<string, unknown> | null)?.coupon_code as string) || "");
        setSteps(Array.isArray(f.steps) ? (f.steps as Step[]).map((s) => ({ ...emptyStep(), ...s, type: "email" })) : []);
      }
      setLoaded(true);
    }
    load();
  }, [id]);

  function updateStep(i: number, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }
  /** Variant B lives at index 0 of subject_variants / preview_variants. */
  function setVariantB(i: number, field: "subject_variants" | "preview_variants", value: string) {
    setSteps((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s;
        const list = [...(s[field] ?? [])];
        list[0] = value;
        const trimmed = list.some((v) => v && v.trim()) ? list : undefined;
        return { ...s, [field]: trimmed };
      }),
    );
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function saveAll() {
    if (!flow) return;
    setBusy(true);
    try {
      const trigger_config: Record<string, unknown> = { ...(flow.trigger_config || {}) };
      if (coupon) trigger_config.coupon_code = coupon;
      else delete trigger_config.coupon_code;
      const res = await supabase
        .from("flows")
        .update({ name, trigger_type: triggerType, trigger_config, steps })
        .eq("id", flow.id)
        .select()
        .maybeSingle();
      if (res.error) throw res.error;
      if (res.data) setFlow(res.data as Flow);
      toast.push({ kind: "success", text: "Flow saved." });
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (!flow) return;
    const activating = flow.status !== "active";
    if (activating && steps.length === 0) {
      toast.push({ kind: "error", text: "Add at least one email step before activating." });
      return;
    }
    if (activating && !confirm("Activate this flow? Once the flow engine is live, enrolled customers will start receiving these emails. Save your steps first if you have unsaved edits.")) {
      return;
    }
    const next = activating ? "active" : "paused";
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
            <button className="pm-btn primary" onClick={saveAll} disabled={busy}>Save changes</button>
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

      <div className="pm-grid g-11" style={{ marginTop: 16, alignItems: "start" }}>
        <Panel title="Settings" caption="Name, trigger and coupon for this flow.">
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
          <div className="pm-field" style={{ marginBottom: 0 }}>
            <label>Coupon code (optional)</label>
            <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="PROMUNCH10" title="Coupon code" />
            <span className="pm-dim" style={{ fontSize: 11, marginTop: 4, display: "block" }}>Reference it in your email copy. No em dashes in customer copy.</span>
          </div>
        </Panel>

        <Panel
          title="Steps"
          caption="The emails in this flow, in order. Wait time is measured from the previous step."
          more={<button className="pm-btn ghost" onClick={addStep} style={{ padding: "4px 10px" }}><Plus size={13} /> Add email</button>}
        >
          {steps.length === 0 ? (
            <div className="pm-dim" style={{ fontSize: 13, padding: "8px 0" }}>No steps yet. Add your first email to start the flow.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {steps.map((s, i) => (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "var(--pm-muted)", fontSize: 11.5 }}>
                    {i === 0 ? <Zap size={13} /> : <Clock size={13} />}
                    <span>Wait</span>
                    <input
                      type="number"
                      min={0}
                      value={s.delay_hours}
                      onChange={(e) => updateStep(i, { delay_hours: Math.max(0, Number(e.target.value) || 0) })}
                      title="Wait hours"
                      style={{ width: 70, padding: "4px 8px" }}
                    />
                    <span>hours {i === 0 ? "after the trigger" : "after the previous email"}</span>
                  </div>
                  <div className="pm-panel" style={{ padding: 14, background: "var(--pm-card2)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 650 }}><Mail size={14} color="var(--pm-blue)" /> Email {i + 1}</span>
                      <button className="pm-btn ghost" onClick={() => removeStep(i)} style={{ color: "var(--pm-terra)", padding: "4px 8px" }} title="Remove step"><Trash2 size={13} /></button>
                    </div>
                    <div className="pm-field">
                      <label>Subject</label>
                      <input value={s.subject} onChange={(e) => updateStep(i, { subject: e.target.value })} placeholder="Your PROMUNCH cart is waiting" title="Subject" />
                    </div>
                    <div className="pm-field">
                      <label>Preview text</label>
                      <input value={s.preview_text ?? ""} onChange={(e) => updateStep(i, { preview_text: e.target.value || undefined })} placeholder="The grey line after the subject in the inbox" title="Preview text" />
                    </div>
                    <details style={{ marginBottom: 12 }} open={!!(s.subject_variants?.[0] || s.preview_variants?.[0])}>
                      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--pm-muted)" }}>A/B test (variant B)</summary>
                      <div style={{ marginTop: 8 }}>
                        <div className="pm-field">
                          <label>Variant B subject</label>
                          <input value={s.subject_variants?.[0] ?? ""} onChange={(e) => setVariantB(i, "subject_variants", e.target.value)} placeholder="Leave blank to reuse the subject above" title="Variant B subject" />
                        </div>
                        <div className="pm-field" style={{ marginBottom: 4 }}>
                          <label>Variant B preview text</label>
                          <input value={s.preview_variants?.[0] ?? ""} onChange={(e) => setVariantB(i, "preview_variants", e.target.value)} placeholder="Leave blank to reuse the preview above" title="Variant B preview text" />
                        </div>
                        <span className="pm-dim" style={{ fontSize: 11, display: "block" }}>Each customer gets A or B, split roughly 50/50. Results appear under A/B results below.</span>
                      </div>
                    </details>
                    <div className="pm-field">
                      <label>Format</label>
                      <select value={s.format ?? "designed"} onChange={(e) => updateStep(i, { format: e.target.value === "plain" ? "plain" : undefined })} title="Email format">
                        <option value="designed">Designed (PROMUNCH branded layout)</option>
                        <option value="plain">Plain (personal note, no banner)</option>
                      </select>
                    </div>
                    {s.format === "plain" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div className="pm-field">
                          <label>From name</label>
                          <input value={s.from_name ?? ""} onChange={(e) => updateStep(i, { from_name: e.target.value || undefined })} placeholder="Parth from PROMUNCH" title="From name" />
                        </div>
                        <div className="pm-field">
                          <label>Signature</label>
                          <textarea value={s.signature ?? ""} onChange={(e) => updateStep(i, { signature: e.target.value || undefined })} placeholder={"Parth\nFounder, PROMUNCH"} title="Signature" style={{ minHeight: 38, resize: "vertical" }} />
                        </div>
                      </div>
                    )}
                    <div className="pm-field" style={{ marginBottom: 0 }}>
                      <label>Body (HTML)</label>
                      <textarea
                        value={s.body_html}
                        onChange={(e) => updateStep(i, { body_html: e.target.value })}
                        title="Email body HTML"
                        style={{ minHeight: 120, fontFamily: "var(--pm-mono)", fontSize: 12.5, resize: "vertical" }}
                      />
                      <span className="pm-dim" style={{ fontSize: 11, marginTop: 4, display: "block" }}>{s.format === "plain" ? "Sent as a plain personal note" : "Wrapped in the PROMUNCH branded layout"} with an unsubscribe footer at send. Use {"{{first_name}}"} and {"{{checkout_url}}"} where relevant. Emails only go out 9am to 9pm IST, and wait if the customer got another marketing email in the last 16 hours.</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {variantStats.some((v) => v.variant !== "A") && (
        <Panel title="A/B results" caption="Sends, opens and clicks per subject variant. Opens are approximate (Apple Mail pre-loads images).">
          <table className="pm-table" style={{ width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr><th style={{ textAlign: "left" }}>Email</th><th style={{ textAlign: "left" }}>Variant</th><th style={{ textAlign: "right" }}>Sent</th><th style={{ textAlign: "right" }}>Open rate</th><th style={{ textAlign: "right" }}>Click rate</th></tr>
            </thead>
            <tbody>
              {variantStats.map((v) => (
                <tr key={`${v.step_index}:${v.variant}`}>
                  <td>Email {v.step_index + 1}</td>
                  <td>{v.variant}</td>
                  <td style={{ textAlign: "right" }}>{v.sends.toLocaleString("en-IN")}</td>
                  <td style={{ textAlign: "right" }}>{pct(v.open_rate)}</td>
                  <td style={{ textAlign: "right" }}>{pct(v.click_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
