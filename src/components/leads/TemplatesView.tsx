"use client";

// Templates tab: library grid + editor with variable chips, a live preview on
// a sample lead, and "Draft with AI" (brief -> 3 variants to keep).

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { TemplateRow } from "./types";
import { renderTemplate, TEMPLATE_VARIABLES } from "@/lib/leads/templates";

const SAMPLE_VARS = { name: "the team", company: "Wrapped & Co.", city: "Mumbai", category: "corporate gifting" };

type EditorState = { id: string | null; name: string; subject: string; body_text: string };
const EMPTY: EditorState = { id: null, name: "", subject: "", body_text: "" };

export default function TemplatesView({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/templates", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "load failed");
      setTemplates(json.templates ?? []);
    } catch (e) {
      toast.push({ kind: "error", text: `Templates: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  function insertVariable(v: string) {
    const el = bodyRef.current;
    if (!el || !editor) return;
    const start = el.selectionStart ?? editor.body_text.length;
    const end = el.selectionEnd ?? start;
    const next = editor.body_text.slice(0, start) + v + editor.body_text.slice(end);
    setEditor({ ...editor, body_text: next });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + v.length;
    });
  }

  async function save() {
    if (!editor) return;
    if (!editor.name.trim() || !editor.subject.trim() || !editor.body_text.trim()) {
      toast.push({ kind: "error", text: "Name, subject and body are all required." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(editor.id ? `/api/leads/templates/${editor.id}` : "/api/leads/templates", {
        method: editor.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editor.name, subject: editor.subject, body_text: editor.body_text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "save failed");
      toast.push({ kind: "success", text: "Template saved." });
      setEditor(null);
      load();
      onChanged();
    } catch (e) {
      toast.push({ kind: "error", text: `Save: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: TemplateRow) {
    if (!confirm(`Delete template “${t.name}”?`)) return;
    const res = await fetch(`/api/leads/templates/${t.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      toast.push({ kind: "error", text: json.error || "delete failed" });
      return;
    }
    toast.push({ kind: "success", text: json.archived ? "Template archived (a sequence still uses it)." : "Template deleted." });
    load();
    onChanged();
  }

  if (loading) return <div className="pm-empty">Loading…</div>;

  return (
    <div>
      <div className={styles.tplToolbar}>
        <button type="button" className="pm-btn" onClick={() => setShowAi(true)}>
          <Sparkles size={14} /> Draft with AI
        </button>
        <button type="button" className="pm-btn primary" onClick={() => setEditor(EMPTY)}>
          <Plus size={14} /> New template
        </button>
      </div>

      {templates.length === 0 && !editor ? (
        <div className={styles.getStarted}>
          <div className={styles.getStartedTitle}>No templates yet</div>
          <p className={styles.getStartedText}>
            Templates are the emails your sequences send. Write one by hand with variables like{" "}
            {"{company}"} and {"{city}"}, or describe your pitch and let AI draft three options to pick from.
          </p>
          <div className={styles.getStartedActions}>
            <button type="button" className="pm-btn primary" onClick={() => setShowAi(true)}>
              <Sparkles size={14} /> Draft with AI
            </button>
            <button type="button" className="pm-btn" onClick={() => setEditor(EMPTY)}>Write by hand</button>
          </div>
        </div>
      ) : (
        <div className={styles.listGrid}>
          {templates.map((t) => (
            <button
              type="button"
              key={t.id}
              className={styles.listCard}
              onClick={() => setEditor({ id: t.id, name: t.name, subject: t.subject, body_text: t.body_text })}
            >
              <div className={styles.listCardTop}>
                <span className={styles.listCardName}>{t.name}</span>
                {t.used_in_sequences > 0 && (
                  <span className="pm-badge2 bg-blue">{t.used_in_sequences} sequence{t.used_in_sequences === 1 ? "" : "s"}</span>
                )}
              </div>
              <div className="pm-b7" style={{ fontSize: 12.5 }}>{t.subject}</div>
              <div className="pm-dim" style={{ fontSize: 12, lineHeight: 1.45 }}>
                {t.body_text.slice(0, 110)}{t.body_text.length > 110 ? "…" : ""}
              </div>
            </button>
          ))}
        </div>
      )}

      {editor && (
        <div className={styles.overlay} onClick={() => setEditor(null)}>
          <div className={`pm-card ${styles.modal} ${styles.modalXl}`} onClick={(e) => e.stopPropagation()} style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
              {editor.id ? "Edit template" : "New template"}
            </h3>
            <div className={styles.tplEditorGrid}>
              <div>
                <label className={styles.fieldLabel} htmlFor="tpl-name">Name</label>
                <input
                  id="tpl-name"
                  className="input"
                  placeholder="Gifting intro v1"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                />
                <label className={styles.fieldLabel} htmlFor="tpl-subject" style={{ marginTop: 12 }}>Subject</label>
                <input
                  id="tpl-subject"
                  className="input"
                  placeholder="PROMUNCH for {company} gift hampers"
                  value={editor.subject}
                  onChange={(e) => setEditor({ ...editor, subject: e.target.value })}
                />
                <label className={styles.fieldLabel} htmlFor="tpl-body" style={{ marginTop: 12 }}>Body</label>
                <textarea
                  id="tpl-body"
                  ref={bodyRef}
                  className="input"
                  rows={12}
                  value={editor.body_text}
                  onChange={(e) => setEditor({ ...editor, body_text: e.target.value })}
                />
                <div className={styles.varChips}>
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button type="button" key={v} className={styles.varChip} onClick={() => insertVariable(v)}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className={styles.fieldLabel}>Preview with a sample lead</div>
                <div className={styles.tplPreview}>
                  <div className={styles.tplPreviewFrom}>Parth from PROMUNCH → hello@wrappedco.in</div>
                  <div className={styles.tplPreviewSubject}>
                    {renderTemplate(editor.subject || "(no subject)", SAMPLE_VARS)}
                  </div>
                  {renderTemplate(editor.body_text || "(empty body)", SAMPLE_VARS)
                    .split(/\n{2,}|\n/)
                    .filter(Boolean)
                    .map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                </div>
                <p className="pm-muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  Variables fill in per lead at send time. With AI polish on, the first paragraph is
                  additionally personalised from the lead&apos;s website.
                </p>
              </div>
            </div>
            <div className={styles.actionRow}>
              {editor.id && (
                <button
                  type="button"
                  className="pm-btn ghost"
                  onClick={() => { const t = templates.find((x) => x.id === editor.id); if (t) remove(t); }}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="pm-btn" onClick={() => setEditor(null)}>Cancel</button>
              <button type="button" className="pm-btn primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAi && (
        <AiDraftModal
          onClose={() => setShowAi(false)}
          onUse={(v) => {
            setShowAi(false);
            setEditor({ id: null, name: v.label, subject: v.subject, body_text: v.body });
          }}
        />
      )}
    </div>
  );
}

function AiDraftModal({
  onClose, onUse,
}: {
  onClose: () => void;
  onUse: (v: { label: string; subject: string; body: string }) => void;
}) {
  const toast = useToast();
  const [brief, setBrief] = useState("");
  const [variants, setVariants] = useState<{ label: string; subject: string; body: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!brief.trim()) return;
    setBusy(true);
    setVariants([]);
    try {
      const res = await fetch("/api/leads/templates/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "generate failed");
      setVariants(json.variants ?? []);
    } catch (e) {
      toast.push({ kind: "error", text: `AI draft: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`pm-card ${styles.modal} ${styles.modalLg}`} onClick={(e) => e.stopPropagation()} style={{ padding: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Draft with AI</h3>
        <p className="pm-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Describe the pitch; you get three template options grounded in the PROMUNCH knowledge base.
          Pick one, then edit it like any template.
        </p>
        <textarea
          className="input"
          rows={3}
          placeholder="e.g. Pitch Diwali gift hampers with Edamame and Soya Crunchies to corporate gifting companies; offer a free sample box"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <div className={styles.actionRow}>
          <button type="button" className="pm-btn" onClick={onClose}>Close</button>
          <button type="button" className="pm-btn primary" disabled={busy || !brief.trim()} onClick={generate}>
            <Sparkles size={13} /> {busy ? "Writing…" : variants.length ? "Regenerate" : "Generate 3 options"}
          </button>
        </div>
        {busy && <div className="pm-empty" style={{ marginTop: 12 }}>Writing three angles…</div>}
        {variants.map((v) => (
          <div key={v.label} className={styles.variantCard}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{v.label}</b>
              <div className="pm-b7" style={{ fontSize: 12.5, marginTop: 2 }}>{v.subject}</div>
              <div className="pm-dim" style={{ fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap" }}>{v.body}</div>
            </div>
            <button type="button" className="pm-btn primary" onClick={() => onUse(v)}>Use this</button>
          </div>
        ))}
      </div>
    </div>
  );
}
