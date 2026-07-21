"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Mail, ShoppingCart, Star, RotateCcw, Sparkles, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PageHead } from "@/components/pm";

type TemplateRow = {
  key: string;
  name: string;
  category: string;
  description: string;
  steps: number;
  needsSetup: boolean;
};

const CATEGORY_ORDER = ["recover", "welcome", "retain", "engage", "deliverability"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  recover: "Recover lost sales",
  welcome: "Welcome & convert",
  retain: "Retain & grow",
  engage: "Engage & seasonal",
  deliverability: "Protect deliverability",
};
const CATEGORY_STYLE: Record<string, { bg: string; fg: string; icon: React.ReactNode }> = {
  recover: { bg: "var(--pm-terra-soft)", fg: "var(--pm-terra)", icon: <ShoppingCart size={16} /> },
  welcome: { bg: "var(--pm-green-soft)", fg: "var(--pm-green)", icon: <Star size={16} /> },
  retain: { bg: "var(--pm-blue-soft)", fg: "var(--pm-blue)", icon: <RotateCcw size={16} /> },
  engage: { bg: "var(--pm-gold-soft)", fg: "var(--pm-gold)", icon: <Sparkles size={16} /> },
  deliverability: { bg: "var(--pm-terra-soft)", fg: "var(--pm-terra)", icon: <ShieldCheck size={16} /> },
};

export default function NewFlowPage() {
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/flows/from-template")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => setTemplates([]));
  }, []);

  async function create(payload: { templateKey?: string; blank?: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/flows/from-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.flow) throw new Error(data.error || "Failed to create");
      toast.push({ kind: "success", text: "Flow created as a draft. Review and edit before activating." });
      router.push(`/dashboard/flows/${data.flow.id}`);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Create failed" });
      setBusy(false);
    }
  }

  const backLink = (
    <Link href="/dashboard/flows" className="more" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--pm-muted)", fontSize: 12 }}>
      <ArrowLeft size={14} /> Back to flows
    </Link>
  );

  return (
    <div className="pm-page">
      <PageHead back={backLink} title="Create a flow" subtitle="Start from a proven template or build your own. Every template is a draft you can edit before it sends." />

      {/* Start from scratch */}
      <button
        className="pm-panel"
        onClick={() => create({ blank: true })}
        disabled={busy}
        style={{ textAlign: "left", width: "100%", cursor: "pointer", border: "1px dashed var(--pm-green)", background: "var(--pm-green-soft)", display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}
      >
        <span style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--pm-green)", color: "#fff", flex: "none" }}><Plus size={18} /></span>
        <span>
          <span style={{ display: "block", fontSize: 14, fontWeight: 650, color: "var(--pm-green)" }}>Start from scratch</span>
          <span className="pm-dim" style={{ fontSize: 12 }}>Pick a trigger, then add your own email and wait steps.</span>
        </span>
      </button>

      {CATEGORY_ORDER.map((cat) => {
        const rows = templates.filter((t) => t.category === cat);
        if (rows.length === 0) return null;
        const cs = CATEGORY_STYLE[cat];
        return (
          <div key={cat} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.02em" }}>{CATEGORY_LABELS[cat]}</span>
              <span style={{ flex: 1, height: 1, background: "var(--pm-line)" }} />
              <span className="pm-dim" style={{ fontSize: 11 }}>{rows.length} template{rows.length === 1 ? "" : "s"}</span>
            </div>
            <div className="pm-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 13 }}>
              {rows.map((t) => (
                <button
                  key={t.key}
                  className="pm-panel"
                  onClick={() => create({ templateKey: t.key })}
                  disabled={busy}
                  style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 9, padding: 15 }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: cs.bg, color: cs.fg, flex: "none" }}>{cs.icon}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 650 }}>{t.name}</span>
                  </span>
                  <span className="pm-muted" style={{ fontSize: 11.5, lineHeight: 1.45, flex: 1 }}>{t.description}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="pm-dim" style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}><Mail size={11} /> {t.steps} email{t.steps === 1 ? "" : "s"}</span>
                    {t.needsSetup && <span className="pm-chip" style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 7, background: "var(--pm-card2)", border: "1px solid var(--pm-border)", color: "var(--pm-muted)" }}>Needs setup</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
