"use client";

// Templates tab of the WhatsApp dashboard: list, guided builder, media-header
// upload and the submit / edit / delete-at-Meta flows. Built for a
// non-technical teammate: every Meta rule is checked live (template-rules.ts)
// and every Meta rejection or error is explained in plain English
// (template-errors.ts), with the raw Meta text tucked into "Details".

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowUp, Bold, Check, Code, Copy, CornerUpLeft, ExternalLink, FileText,
  Image as ImageIcon, Italic, Pencil, Phone, Plus, RefreshCw, Search, Send, Sparkles,
  Strikethrough, Trash2, Video, X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/pm/ConfirmDialog";
import { tagUrlForWhatsApp } from "@/lib/utm";
import {
  FOOTER_MAX, STOP_NOTICE, TEMPLATE_LANGUAGES, finalFooter, isMarketingCategory, issuesFor,
  languageLabel, mediaKindForHeader, nextVersionName, samplesArray, slugifyTemplateName,
  validateTemplate, varNumbers, type Issue,
} from "@/lib/whatsapp/template-rules";
import { explainRejection, explainTemplateError, type TemplateProblem } from "@/lib/whatsapp/template-errors";
import type { Template, TemplateButton } from "./types";
import { BRAND, inputStyle, cardStyle, primaryBtn, smallBtn, chip, chipOn, fmtBtn } from "./styles";
import { Modal, Field } from "./primitives";
import { WhatsAppPreview } from "./WhatsAppPreview";
import { MediaUploader } from "./MediaUploader";

/* ------------------------------------------------------------------------ */
/* Types                                                                      */
/* ------------------------------------------------------------------------ */

// Columns added by migration 20260929110000_wa_templates_v2.sql (optional so
// the page still works before it is applied).
type TemplateRow = Template & {
  quality_score?: string | null;
  rejected_reason_detail?: string | null;
  previous_category?: string | null;
  header_samples?: string[] | null;
  needs_media?: boolean | null;
  last_synced_at?: string | null;
};

type Btn = TemplateButton & { example?: string | string[] };

type Draft = {
  id?: string;
  /** new = never saved; draft = local draft; edit = already at Meta (resubmits via edit). */
  mode: "new" | "draft" | "edit";
  status?: string;
  title: string;
  name: string;
  nameTouched: boolean;
  language: string;
  category: string;
  header_type: "" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  header_text: string;
  header_media_url: string | null;
  header_media?: { mime: string; size: number } | null;
  body: string;
  footer: string;
  buttons: Btn[];
  bodySamples: Record<string, string>;
  headerSamples: Record<string, string>;
};

type SubmitResult = { ok?: boolean; error?: string; issues?: Issue[]; meta_error?: unknown; results?: { error?: string; meta_error?: unknown }[] };

/* ------------------------------------------------------------------------ */
/* Labels                                                                     */
/* ------------------------------------------------------------------------ */

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  approved: { label: "Approved", bg: "rgba(16,185,129,0.14)", color: "var(--pm-green)" },
  pending: { label: "In review", bg: "rgba(245,183,49,0.16)", color: "#92400e" },
  rejected: { label: "Rejected", bg: "rgba(239,68,68,0.12)", color: "var(--pm-terra)" },
  disabled: { label: "Paused", bg: "rgba(107,114,128,0.14)", color: "var(--pm-muted)" },
  draft: { label: "Draft", bg: "rgba(229,231,235,0.7)", color: "var(--pm-muted)" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, bg: "rgba(229,231,235,0.7)", color: "var(--pm-muted)" };

const QUALITY: Record<string, { label: string; color: string }> = {
  GREEN: { label: "Quality: good", color: "var(--pm-green)" },
  YELLOW: { label: "Quality: medium", color: "#92400e" },
  RED: { label: "Quality: low", color: "var(--pm-terra)" },
};

const CATEGORY_LABEL: Record<string, string> = {
  marketing: "Marketing", offer: "Marketing", utility: "Utility", authentication: "Authentication",
};

const HEADER_KINDS = ["", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const;
const HEADER_LABEL: Record<string, string> = { "": "No header", TEXT: "Text", IMAGE: "Image", VIDEO: "Video", DOCUMENT: "PDF" };

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try {
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `The server answered ${r.status}.` };
  }
}

async function fetchTemplates(): Promise<TemplateRow[]> {
  const r = await fetch("/api/whatsapp/templates");
  const j = await readJson(r);
  if (!r.ok || j.error) throw new Error(String(j.error ?? `Could not load templates (${r.status}).`));
  return (j.templates as TemplateRow[]) ?? [];
}

function emptyDraft(): Draft {
  return {
    mode: "new", title: "", name: "", nameTouched: false, language: "en", category: "marketing",
    header_type: "", header_text: "", header_media_url: null, body: "", footer: "", buttons: [],
    bodySamples: {}, headerSamples: {},
  };
}

function draftFrom(t: TemplateRow, asNewName?: string): Draft {
  const bs: Record<string, string> = {};
  if (Array.isArray(t.variables)) for (const v of t.variables) if (v?.name) bs[String(v.name)] = String(v.sample ?? "");
  const hs: Record<string, string> = {};
  (t.header_samples ?? []).forEach((s, i) => { hs[String(i + 1)] = String(s ?? ""); });
  const buttons: Btn[] = (t.buttons ?? []).map((b) => {
    const raw = b as Btn & { example?: string | string[] };
    if (raw.type === "URL") {
      const ex = Array.isArray(raw.example) ? raw.example[0] : raw.example;
      return { type: "URL", text: raw.text, url: raw.url, example: ex ?? "" };
    }
    return { ...raw } as Btn;
  });
  // Anything with a Meta id exists at Meta (even rows an old bug flipped to draft).
  const submitted = !!t.meta_template_id;
  const copy = asNewName !== undefined;
  const ht = (t.header_type ?? "") as Draft["header_type"];
  return {
    id: copy ? undefined : t.id,
    mode: copy ? "new" : submitted ? "edit" : "draft",
    status: copy ? "draft" : t.status,
    title: copy ? asNewName : t.name,
    name: copy ? asNewName : t.name,
    nameTouched: true,
    language: t.language ?? "en",
    category: t.category === "authentication" ? "utility" : t.category,
    header_type: HEADER_KINDS.includes(ht) ? ht : "",
    header_text: t.header_text ?? "",
    header_media_url: t.header_media_url ?? null,
    body: t.body ?? "",
    footer: t.footer ?? "",
    buttons,
    bodySamples: bs,
    headerSamples: hs,
  };
}

// Strip the STOP notice we add automatically, so re-opening a synced
// marketing template doesn't show it twice in the editable footer.
function editableFooter(category: string, footer: string): string {
  if (!isMarketingCategory(category)) return footer;
  if (footer === STOP_NOTICE) return "";
  const suffix = ` · ${STOP_NOTICE}`;
  return footer.endsWith(suffix) ? footer.slice(0, -suffix.length) : footer;
}

function buttonsForApi(buttons: Btn[]): Btn[] {
  return buttons.map((b) => {
    if (b.type === "URL") {
      const dynamic = (b.url ?? "").includes("{{");
      const ex = Array.isArray(b.example) ? b.example[0] : b.example;
      return dynamic && ex ? { type: "URL", text: b.text.trim(), url: b.url.trim(), example: ex.trim() } : { type: "URL", text: b.text.trim(), url: b.url.trim() };
    }
    if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: b.phone_number.trim() };
    return { type: "QUICK_REPLY", text: b.text.trim() };
  });
}

/* ------------------------------------------------------------------------ */
/* Small presentational bits                                                  */
/* ------------------------------------------------------------------------ */

function StatusPill({ status }: { status: string }) {
  const s = statusOf(status);
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>
      {s.label}
    </span>
  );
}

function IssueList({ issues, tone }: { issues: Issue[]; tone: "error" | "warning" }) {
  if (!issues.length) return null;
  const color = tone === "error" ? "var(--pm-terra)" : "#92400e";
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 10px" }}>
      {issues.map((i, k) => (
        <li key={k} style={{ fontSize: 12, color, display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 3 }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{i.message}{i.fix ? <span style={{ color: "var(--pm-muted)" }}> {i.fix}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

function FieldIssues({ errors, warnings, field }: { errors: Issue[]; warnings: Issue[]; field: string }) {
  return (
    <>
      <IssueList issues={issuesFor(errors, field)} tone="error" />
      <IssueList issues={issuesFor(warnings, field)} tone="warning" />
    </>
  );
}

function ProblemBox({ problem, onClose }: { problem: TemplateProblem; onClose?: () => void }) {
  return (
    <div role="alert" style={{ border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.06)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--pm-terra)" }}>{problem.title}</div>
        {onClose && <button type="button" onClick={onClose} aria-label="Dismiss" style={{ ...smallBtn, padding: "2px 6px" }}><X size={12} /></button>}
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{problem.explanation}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}><strong>What to do:</strong> {problem.howToFix}</div>
      {problem.raw && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 11, color: "var(--pm-muted)", cursor: "pointer" }}>Details from Meta</summary>
          <div style={{ fontSize: 11, color: "var(--pm-muted)", marginTop: 4, wordBreak: "break-word" }}>{problem.raw}</div>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Main view                                                                  */
/* ------------------------------------------------------------------------ */

export default function TemplatesView() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<TemplateProblem | null>(null);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<TemplateProblem | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const templatesQ = useQuery({
    queryKey: ["wa-templates"],
    queryFn: fetchTemplates,
    // While anything is in Meta review, re-read every minute so approvals
    // picked up by the wa-template-sync cron land on screen by themselves.
    refetchInterval: (q) => ((q.state.data ?? []).some((t) => t.status === "pending") ? 60_000 : false),
  });
  const list = useMemo(() => templatesQ.data ?? [], [templatesQ.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["wa-templates"] });

  // Toast when a template leaves review (from the cron sync, the auto sync
  // below, or a manual sync).
  const prevStatus = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!templatesQ.data) return;
    const prev = prevStatus.current;
    const next = new Map(templatesQ.data.map((t) => [`${t.name}:${t.language}`, t.status]));
    if (prev) {
      for (const t of templatesQ.data) {
        if (prev.get(`${t.name}:${t.language}`) !== "pending") continue;
        if (t.status === "approved") toast.push({ kind: "success", text: `"${t.name}" was approved by Meta and is ready to send.` });
        else if (t.status === "rejected") toast.push({ kind: "error", text: `"${t.name}" was rejected by Meta. Open it to see why and how to fix it.` });
      }
    }
    prevStatus.current = next;
  }, [templatesQ.data, toast]);

  // On open: if anything is still in Meta review, sync once right away.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current || !templatesQ.data) return;
    autoSynced.current = true;
    if (!templatesQ.data.some((t) => t.status === "pending")) return;
    (async () => {
      try {
        const r = await fetch("/api/whatsapp/templates/sync", { method: "POST" });
        const j = await readJson(r);
        if (r.ok && j.ok !== false) refresh();
      } catch { /* silent: the manual button reports errors */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatesQ.data]);

  /* ---------------- builder derived state ---------------- */

  const draftForRules = editing ? {
    name: editing.name,
    language: editing.language,
    category: editing.category,
    header_type: editing.header_type || null,
    header_text: editing.header_type === "TEXT" ? editing.header_text : null,
    header_media_url: editing.header_media_url,
    header_media: editing.header_media ?? null,
    body: editing.body,
    footer: editing.footer,
    buttons: editing.buttons,
    body_samples: editing.bodySamples,
    header_samples: editing.headerSamples,
  } : null;
  const validation = draftForRules ? validateTemplate(draftForRules) : { errors: [], warnings: [] };
  const errors = [...validation.errors, ...serverIssues.filter((s) => !validation.errors.some((e) => e.message === s.message))];
  const warnings = validation.warnings;

  const takenNames = useMemo(() => new Set(list.map((t) => t.name)), [list]);
  const nameClash = !!editing && editing.mode === "new" && takenNames.has(editing.name);

  /* ---------------- builder actions ---------------- */

  function update(patch: Partial<Draft>) {
    setEditing((cur) => (cur ? { ...cur, ...patch } : cur));
    setServerIssues([]);
  }

  function open(d: Draft) {
    setEditing(d);
    setSubmitProblem(null);
    setServerIssues([]);
  }

  // ?new=1 (from the campaign wizard's "Create a new template"): open the
  // builder straight away, then drop the flag so a reload doesn't reopen it.
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current || searchParams.get("new") !== "1") return;
    openedFromLink.current = true;
    open(emptyDraft());
    router.replace("/dashboard/whatsapp?tab=templates");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function openExisting(t: TemplateRow) {
    const d = draftFrom(t);
    d.footer = editableFooter(d.category, d.footer);
    open(d);
  }

  function duplicate(t: TemplateRow) {
    const d = draftFrom(t, nextVersionName(t.name, takenNames));
    d.footer = editableFooter(d.category, d.footer);
    open(d);
  }

  function wrapBody(mark: string) {
    if (!editing) return;
    const el = bodyRef.current;
    const src = editing.body;
    if (!el) { update({ body: src + mark + "text" + mark }); return; }
    const s = el.selectionStart ?? src.length;
    const e = el.selectionEnd ?? src.length;
    const sel = src.slice(s, e) || "text";
    update({ body: src.slice(0, s) + mark + sel + mark + src.slice(e) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + mark.length, s + mark.length + sel.length); });
  }

  function insertVariable() {
    if (!editing) return;
    const next = (varNumbers(editing.body).pop() ?? 0) + 1;
    const el = bodyRef.current;
    const token = `{{${next}}}`;
    const at = el?.selectionStart ?? editing.body.length;
    update({ body: editing.body.slice(0, at) + token + editing.body.slice(at) });
  }

  function setButtons(buttons: Btn[]) { update({ buttons }); }
  function updateButton(i: number, patch: Partial<Btn>) {
    if (!editing) return;
    const cur = [...editing.buttons];
    cur[i] = { ...cur[i], ...patch } as Btn;
    setButtons(cur);
  }
  function moveButtonUp(i: number) {
    if (!editing || i === 0) return;
    const cur = [...editing.buttons];
    [cur[i - 1], cur[i]] = [cur[i], cur[i - 1]];
    setButtons(cur);
  }

  async function saveDraft() {
    if (!editing || editing.mode === "edit") return;
    if (!editing.name) { toast.push({ kind: "error", text: "Give the template a title first." }); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          name: editing.name,
          language: editing.language,
          category: editing.category,
          header_type: editing.header_type || null,
          header_text: editing.header_type === "TEXT" ? editing.header_text : null,
          header_media_url: mediaKindForHeader(editing.header_type) ? editing.header_media_url : null,
          body: editing.body,
          footer: editing.footer || null,
          buttons: editing.buttons.length ? buttonsForApi(editing.buttons) : null,
          variables: varNumbers(editing.body).map((n) => ({ name: String(n), sample: editing.bodySamples[String(n)] ?? "" })),
          header_samples: editing.header_type === "TEXT" ? samplesArray(editing.header_text, editing.headerSamples) : null,
        }),
      });
      const j = await readJson(r);
      if (!r.ok || j.error) { toast.push({ kind: "error", text: String(j.error ?? "Could not save the draft.") }); return; }
      toast.push({ kind: "success", text: "Draft saved. It stays here until you submit it to Meta." });
      setEditing(null);
      refresh();
    } catch {
      toast.push({ kind: "error", text: "Could not reach the server. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  async function submitToMeta() {
    if (!editing) return;
    setConfirmSubmit(false);
    setSubmitProblem(null);
    setServerIssues([]);
    setBusy(true);
    try {
      const isMedia = !!mediaKindForHeader(editing.header_type);
      const r = await fetch("/api/whatsapp/templates/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: editing.mode === "edit" ? "edit" : "create",
          name: editing.name,
          category: editing.category,
          language: editing.language,
          header_format: editing.header_type || undefined,
          header_text: editing.header_type === "TEXT" ? editing.header_text : undefined,
          header_media_url: isMedia ? editing.header_media_url : undefined,
          body: editing.body,
          footer: editing.footer || undefined,
          body_samples: samplesArray(editing.body, editing.bodySamples),
          header_samples: editing.header_type === "TEXT" ? samplesArray(editing.header_text, editing.headerSamples) : [],
          buttons: editing.buttons.length ? buttonsForApi(editing.buttons) : undefined,
        }),
      });
      const j = (await readJson(r)) as SubmitResult;
      if (!r.ok || j.ok === false || j.error) {
        if (Array.isArray(j.issues) && j.issues.length) {
          setServerIssues(j.issues);
          setSubmitProblem({
            title: "Please fix the items marked in red",
            explanation: "The template was checked again on our server before sending it to Meta, and it found problems.",
            howToFix: "Fix each item listed next to its field, then submit again.",
            raw: null, known: true,
          });
        } else {
          const first = j.results?.[0];
          const meta = (j.meta_error ?? first?.meta_error) as Parameters<typeof explainTemplateError>[0] | undefined;
          setSubmitProblem(explainTemplateError(meta ?? j.error ?? first?.error ?? `Error ${r.status}`));
        }
        return;
      }
      toast.push({
        kind: "success",
        text: editing.mode === "edit"
          ? "Changes sent to Meta for review. We check for the result every 15 minutes."
          : "Sent to Meta for review. Most templates are reviewed within a few hours. We check for the result every 15 minutes.",
      });
      setEditing(null);
      refresh();
    } catch {
      setSubmitProblem(explainTemplateError("Could not reach the server. Check your internet connection and try again."));
    } finally { setBusy(false); }
  }

  async function syncFromMeta() {
    setSyncing(true);
    try {
      const r = await fetch("/api/whatsapp/templates/sync", { method: "POST" });
      const j = await readJson(r);
      if (!r.ok || j.ok === false) {
        const p = explainTemplateError(String(j.error ?? `Error ${r.status}`));
        toast.push({ kind: "error", text: `Could not refresh from Meta. ${p.title}. ${p.howToFix}` });
        return;
      }
      const synced = (j.synced as { status: string }[]) ?? [];
      toast.push({ kind: "success", text: `Refreshed ${synced.length} template(s) from Meta. ${synced.filter((s) => s.status === "approved").length} approved.` });
      refresh();
    } catch {
      toast.push({ kind: "error", text: "Could not reach the server. Check your connection and try again." });
    } finally { setSyncing(false); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteProblem(null);
    try {
      const r = await fetch(`/api/whatsapp/templates/${deleting.id}`, { method: "DELETE" });
      const j = await readJson(r);
      if (!r.ok || j.ok === false) {
        setDeleteProblem(explainTemplateError((j.meta_error as Parameters<typeof explainTemplateError>[0]) ?? String(j.error ?? `Error ${r.status}`)));
        return;
      }
      toast.push({ kind: "success", text: `Deleted "${deleting.name}".` });
      setDeleting(null);
      refresh();
    } catch {
      setDeleteProblem(explainTemplateError("Could not reach the server. Check your internet connection and try again."));
    } finally { setDeleteBusy(false); }
  }

  async function attachMissingMedia(t: TemplateRow, url: string | null) {
    if (!url) return;
    try {
      const r = await fetch(`/api/whatsapp/templates/${t.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ header_media_url: url, needs_media: false }),
      });
      const j = await readJson(r);
      if (!r.ok || j.error) { toast.push({ kind: "error", text: String(j.error ?? "Could not save the file.") }); return; }
      toast.push({ kind: "success", text: `"${t.name}" can now be used in campaigns.` });
      refresh();
    } catch {
      toast.push({ kind: "error", text: "Could not reach the server. Check your connection and try again." });
    }
  }

  /* ---------------- list filtering ---------------- */

  const filtered = list.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || (t.body ?? "").toLowerCase().includes(q);
  });
  const counts = list.reduce<Record<string, number>>((m, t) => { m[t.status] = (m[t.status] ?? 0) + 1; return m; }, {});

  /* ---------------- builder preview values ---------------- */

  const bodyVars = editing ? varNumbers(editing.body) : [];
  const headerVars = editing && editing.header_type === "TEXT" ? varNumbers(editing.header_text) : [];
  const fill = (s: string, samples: Record<string, string>) => s.replace(/\{\{(\d+)\}\}/g, (_, n) => samples[n] || `{{${n}}}`);
  const shownFooter = editing ? finalFooter(editing.category, editing.footer) : null;
  const approvedEdit = editing?.mode === "edit" && editing.status === "approved";
  const canSubmit = !!editing && errors.length === 0 && !nameClash && !busy;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)", maxWidth: 520 }}>
          Build a message template, send it to Meta for approval, then use it in campaigns once it shows Approved.
          We check Meta for review results every 15 minutes.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={syncFromMeta} disabled={syncing} style={smallBtn}>
            <RefreshCw size={14} /> {syncing ? "Refreshing..." : "Refresh from Meta"}
          </button>
          <button type="button" onClick={() => open(emptyDraft())} style={primaryBtn}>
            <Plus size={14} /> New template
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <Search size={14} style={{ position: "absolute", left: 9, top: 10, color: "var(--pm-hint)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates"
            aria-label="Search templates" style={{ ...inputStyle, paddingLeft: 28 }} />
        </div>
        {["all", "approved", "pending", "rejected", "disabled", "draft"].map((s) => (
          <button key={s} type="button" onClick={() => setStatusFilter(s)}
            style={{ ...chip, ...(statusFilter === s ? chipOn : {}) }}>
            {s === "all" ? `All (${list.length})` : `${statusOf(s).label} (${counts[s] ?? 0})`}
          </button>
        ))}
      </div>

      {templatesQ.isError && (
        <ProblemBox problem={{
          title: "Could not load templates",
          explanation: templatesQ.error instanceof Error ? templatesQ.error.message : "Unknown error.",
          howToFix: "Refresh the page. If it keeps happening, tell the owner.", raw: null, known: false,
        }} />
      )}
      {templatesQ.isLoading && <div style={{ fontSize: 13, color: "var(--pm-muted)" }}>Loading templates...</div>}
      {!templatesQ.isLoading && filtered.length === 0 && !templatesQ.isError && (
        <div style={{ fontSize: 13, color: "var(--pm-muted)", padding: "20px 0" }}>
          {list.length === 0 ? "No templates yet. Click New template to build your first one." : "No templates match your search."}
        </div>
      )}

      {/* Cards */}
      <div className="pm-autogrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
        {filtered.map((t) => {
          const q = QUALITY[String(t.quality_score ?? "").toUpperCase()];
          const kind = mediaKindForHeader(t.header_type);
          const rejected = t.status === "rejected" ? explainRejection(t.rejection_reason, t.rejected_reason_detail) : null;
          const atMeta = !!t.meta_template_id;
          return (
            <div key={t.id} style={{ ...cardStyle, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ fontWeight: 700, wordBreak: "break-all" }}>{t.name}</div>
                <StatusPill status={t.status} />
              </div>
              <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>{CATEGORY_LABEL[t.category] ?? t.category}</span>
                <span>{languageLabel(t.language)}</span>
                {q && <span style={{ color: q.color, fontWeight: 600 }}>{q.label}</span>}
              </div>
              {t.previous_category && t.previous_category !== t.category && (
                <div style={{ fontSize: 11, color: "#92400e", marginBottom: 6 }}>
                  Meta changed this from {CATEGORY_LABEL[t.previous_category] ?? t.previous_category} to {CATEGORY_LABEL[t.category] ?? t.category}.
                </div>
              )}
              {kind === "image" && t.header_media_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.header_media_url} alt="" style={{ width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
              )}
              {kind === "video" && t.header_media_url && (
                <video src={t.header_media_url} muted preload="metadata" style={{ width: "100%", maxHeight: 140, borderRadius: 8, marginBottom: 6, background: "#000" }} />
              )}
              {kind === "document" && (
                <div style={{ fontSize: 12, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}><FileText size={13} /> PDF header</div>
              )}
              {t.header_type === "TEXT" && t.header_text && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t.header_text}</div>}
              <div style={{ fontSize: 13, color: "var(--pm-ink)", whiteSpace: "pre-wrap", lineHeight: 1.4, maxHeight: 160, overflow: "hidden" }}>{t.body}</div>
              {t.footer && <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>{t.footer}</div>}

              {kind && (t.needs_media || !t.header_media_url) && t.status !== "draft" && (
                <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: "rgba(245,183,49,0.12)" }}>
                  <div style={{ fontSize: 12, color: "#92400e", marginBottom: 6 }}>
                    We don&apos;t have this template&apos;s {kind === "document" ? "PDF" : kind} yet, so campaigns can&apos;t send it.
                    Upload the file to use when sending. This does not resubmit it to Meta.
                  </div>
                  <MediaUploader kind={kind} value={null} onChange={(url) => attachMissingMedia(t, url)} />
                </div>
              )}

              {rejected && (
                <div style={{ marginTop: 8 }}>
                  <ProblemBox problem={rejected} />
                </div>
              )}
              {t.status === "pending" && (
                <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>
                  In Meta review. Usually minutes to a few hours; this page updates by itself.
                </div>
              )}
              {t.status === "disabled" && (
                <div style={{ fontSize: 11, color: "var(--pm-terra)", marginTop: 6 }}>
                  Meta paused this template, usually because customers blocked or reported it. Soften the wording and use Edit &amp; resubmit.
                </div>
              )}

              <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 10, flexWrap: "wrap" }}>
                {t.status === "approved" && (
                  <Link href={`/dashboard/whatsapp/campaigns/new?template=${t.id}`} style={{ ...primaryBtn, textDecoration: "none" }}>
                    <Send size={12} /> Use in campaign
                  </Link>
                )}
                <button type="button" onClick={() => openExisting(t)} style={smallBtn}>
                  <Pencil size={12} /> {atMeta ? "Edit & resubmit" : "Edit draft"}
                </button>
                <button type="button" onClick={() => duplicate(t)} style={smallBtn} title="Copy into a new template with a _v2 style name">
                  <Copy size={12} /> Duplicate as new version
                </button>
                <button type="button" onClick={() => { setDeleteProblem(null); setDeleting(t); }} aria-label={`Delete ${t.name}`}
                  style={{ ...smallBtn, color: "var(--pm-terra)" }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete confirm */}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          danger
          busy={deleteBusy}
          confirmLabel={deleting.meta_template_id ? "Delete at Meta and here" : "Delete draft"}
          onClose={() => { if (!deleteBusy) { setDeleting(null); setDeleteProblem(null); } }}
          onConfirm={confirmDelete}
          body={
            <div style={{ fontSize: 13 }}>
              {deleting.meta_template_id ? (
                <>
                  <p style={{ margin: "0 0 8px" }}>This deletes the template at Meta as well as here. Campaigns can no longer send it.</p>
                  <p style={{ margin: "0 0 8px" }}>Meta does not let you reuse the name <strong>{deleting.name}</strong> for about 30 days. To change a template, Edit &amp; resubmit is usually better.</p>
                </>
              ) : (
                <p style={{ margin: "0 0 8px" }}>This draft was never sent to Meta, so it is only removed from this list.</p>
              )}
              {deleteProblem && <ProblemBox problem={deleteProblem} />}
            </div>
          }
        />
      )}

      {/* Builder */}
      {editing && (
        <Modal onClose={() => { if (!busy) setEditing(null); }}
          title={editing.mode === "edit" ? `Edit & resubmit: ${editing.name}` : editing.mode === "draft" ? "Edit draft" : "New template"}>

          {editing.mode === "edit" && (
            <div style={{ fontSize: 12, background: "var(--pm-app)", border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              {approvedEdit ? (
                <>Editing an approved template sends it back to Meta for review. Meta allows about <strong>1 edit a day and 10 edits a month</strong>,
                  and the category can&apos;t change. It shows as In review until Meta approves the change, and campaigns can&apos;t use it in the meantime.
                  To keep the current version sending, use Duplicate as new version instead.</>
              ) : (
                <>This fixes the template at Meta under the same name and sends it for review again. Name and language can&apos;t change.</>
              )}
            </div>
          )}

          {/* Title / name */}
          {editing.mode === "edit" ? (
            <Field label="Template name">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{editing.name} <span style={{ color: "var(--pm-muted)", fontWeight: 400 }}>({languageLabel(editing.language)})</span></div>
            </Field>
          ) : (
            <Field label="Title (for your team)">
              <input value={editing.title} placeholder="Diwali offer 2026"
                onChange={(e) => update({ title: e.target.value, ...(editing.nameTouched ? {} : { name: slugifyTemplateName(e.target.value) }) })}
                style={inputStyle} />
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                Name at Meta:
                <input value={editing.name} aria-label="Name at Meta"
                  onChange={(e) => update({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"), nameTouched: true })}
                  style={{ ...inputStyle, width: "auto", flex: "1 1 180px", padding: "4px 8px", fontSize: 12 }} />
              </div>
              {nameClash && (
                <IssueList tone="error" issues={[{ field: "name", message: "A template with this name already exists.", fix: `Try ${nextVersionName(editing.name, takenNames)}.` }]} />
              )}
              <FieldIssues errors={errors} warnings={warnings} field="name" />
            </Field>
          )}

          {/* Category cards */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 4 }}>Type of message</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            {([
              { key: "marketing", title: "Marketing", text: "Offers, launches and reminders to buy. We add a STOP line automatically." },
              { key: "utility", title: "Utility", text: "Order and delivery updates the customer expects. No offers or discounts." },
            ] as const).map((c) => {
              const on = c.key === "marketing" ? isMarketingCategory(editing.category) : editing.category === "utility";
              const locked = approvedEdit && !on;
              return (
                <button key={c.key} type="button" disabled={locked}
                  onClick={() => update({ category: c.key === "marketing" && editing.category === "offer" ? "offer" : c.key })}
                  style={{
                    textAlign: "left", padding: 10, borderRadius: 10, cursor: locked ? "not-allowed" : "pointer",
                    border: `1.5px solid ${on ? BRAND : "var(--pm-border)"}`, background: on ? "rgba(185,28,74,0.05)" : "var(--pm-card)",
                    opacity: locked ? 0.5 : 1, color: "var(--pm-ink)",
                  }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                    {on && <Check size={13} color={BRAND} />}{c.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--pm-muted)", marginTop: 2 }}>{c.text}</div>
                </button>
              );
            })}
          </div>
          <FieldIssues errors={errors} warnings={warnings} field="category" />

          {/* Language */}
          {editing.mode !== "edit" && (
            <Field label="Language the message is written in">
              <select value={editing.language} onChange={(e) => update({ language: e.target.value })} style={inputStyle}>
                {!TEMPLATE_LANGUAGES.some((l) => l.code === editing.language) && <option value={editing.language}>{editing.language}</option>}
                {TEMPLATE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <FieldIssues errors={errors} warnings={warnings} field="language" />
            </Field>
          )}

          {/* Live preview */}
          <div style={{ position: "sticky", top: -20, zIndex: 5, background: "var(--pm-card)", padding: "4px 0 10px", marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--pm-muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={12} /> Preview: what the customer sees
            </div>
            <WhatsAppPreview headerType={editing.header_type || null} headerMediaUrl={editing.header_media_url}
              headerText={fill(editing.header_text, editing.headerSamples)}
              body={fill(editing.body, editing.bodySamples)} footer={shownFooter} buttons={editing.buttons} />
            {editing.buttons.some((b) => b.type === "URL" && b.url) && (
              <div style={{ fontSize: 11, color: "var(--pm-muted)", marginTop: 6 }}>
                {editing.buttons.map((b, i) => {
                  if (b.type !== "URL" || !b.url) return null;
                  const dynamic = b.url.includes("{{");
                  const ex = Array.isArray(b.example) ? b.example[0] : b.example;
                  const shown = dynamic ? (ex || b.url) : tagUrlForWhatsApp(b.url, { medium: "template_button", campaign: editing.name });
                  return (
                    <div key={i} style={{ wordBreak: "break-all" }}>
                      &quot;{b.text || "Link"}&quot; opens: {shown}
                      {dynamic && <span> (example; the end changes for each customer)</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Header */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 4 }}>Header (optional)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {HEADER_KINDS.map((k) => (
              <button key={k || "none"} type="button"
                onClick={() => update({
                  header_type: k,
                  header_media_url: k && k !== "TEXT" && k === editing.header_type ? editing.header_media_url : null,
                  header_media: null,
                })}
                style={{ ...chip, ...(editing.header_type === k ? chipOn : {}) }}>
                {k === "IMAGE" && <ImageIcon size={13} />}{k === "VIDEO" && <Video size={13} />}
                {k === "DOCUMENT" && <FileText size={13} />}{HEADER_LABEL[k]}
              </button>
            ))}
          </div>
          {editing.header_type === "TEXT" && (
            <div style={{ marginBottom: 6 }}>
              <input value={editing.header_text} onChange={(e) => update({ header_text: e.target.value })}
                placeholder="A new flavour is here" style={inputStyle} />
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
                Up to 60 characters, one line, no emojis. You can use one {"{{1}}"}.
              </div>
              {headerVars.map((n) => (
                <div key={`h${n}`} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, width: 38, color: BRAND }}>{`{{${n}}}`}</span>
                  <input value={editing.headerSamples[String(n)] ?? ""} placeholder="Example value"
                    onChange={(e) => update({ headerSamples: { ...editing.headerSamples, [String(n)]: e.target.value } })}
                    style={{ ...inputStyle, marginBottom: 0 }} />
                </div>
              ))}
            </div>
          )}
          {mediaKindForHeader(editing.header_type) && (
            <MediaUploader
              kind={mediaKindForHeader(editing.header_type)!}
              value={editing.header_media_url}
              onChange={(url, media) => update({ header_media_url: url, header_media: media ? { mime: media.mime, size: media.size } : null })}
            />
          )}
          <FieldIssues errors={errors} warnings={warnings} field="header" />
          <FieldIssues errors={errors} warnings={warnings} field="header_samples" />

          {/* Body */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 4, marginTop: 6 }}>Message</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => wrapBody("*")} title="Bold  *text*" style={fmtBtn}><Bold size={14} /></button>
            <button type="button" onClick={() => wrapBody("_")} title="Italic  _text_" style={fmtBtn}><Italic size={14} /></button>
            <button type="button" onClick={() => wrapBody("~")} title="Strikethrough  ~text~" style={fmtBtn}><Strikethrough size={14} /></button>
            <button type="button" onClick={() => wrapBody("```")} title="Monospace  ```text```" style={fmtBtn}><Code size={14} /></button>
            <button type="button" onClick={insertVariable} style={{ ...smallBtn, padding: "4px 8px" }} title="Insert a personalised value such as the customer's name">
              <Plus size={12} /> Personalised value
            </button>
            <span style={{ marginLeft: "auto", fontSize: 11, color: editing.body.length > 1024 ? "var(--pm-terra)" : "var(--pm-hint)" }}>
              {editing.body.length}/1024
            </span>
          </div>
          <textarea ref={bodyRef} value={editing.body} onChange={(e) => update({ body: e.target.value })} rows={6}
            placeholder="Hi {{1}}, our new Peri Peri Crunchies just dropped. Grab a pack before they sell out."
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
          <FieldIssues errors={errors} warnings={warnings} field="body" />
          {bodyVars.length > 0 && (
            <div style={{ border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, marginBottom: 10, background: "var(--pm-app)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Example values for Meta&apos;s reviewer</div>
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 8 }}>
                Only examples. The real value of each {"{{n}}"} (like the customer&apos;s name) is filled in when a campaign sends.
              </div>
              {bodyVars.map((n) => (
                <div key={`b${n}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, width: 38, color: BRAND }}>{`{{${n}}}`}</span>
                  <input value={editing.bodySamples[String(n)] ?? ""} placeholder={n === 1 ? "Aarav" : "Example value"}
                    onChange={(e) => update({ bodySamples: { ...editing.bodySamples, [String(n)]: e.target.value } })}
                    style={{ ...inputStyle, marginBottom: 0 }} />
                </div>
              ))}
              <FieldIssues errors={errors} warnings={warnings} field="body_samples" />
            </div>
          )}

          {/* Footer */}
          <Field label="Footer (optional): small grey line under the message">
            <input value={editing.footer} onChange={(e) => update({ footer: e.target.value })}
              placeholder="Your Munchy Pal" style={inputStyle} />
            {isMarketingCategory(editing.category) && (
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
                Marketing messages always end with &quot;{STOP_NOTICE}&quot;. Customers will see: <strong>{shownFooter}</strong>
                {" "}({(shownFooter ?? "").length}/{FOOTER_MAX})
              </div>
            )}
            <FieldIssues errors={errors} warnings={warnings} field="footer" />
          </Field>

          {/* Buttons */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 6 }}>
            Buttons (optional): up to 2 links, 1 call button, 10 in total
          </div>
          {editing.buttons.map((b, i) => {
            const dynamic = b.type === "URL" && (b.url ?? "").includes("{{");
            return (
              <div key={i} style={{ border: "1px solid var(--pm-border)", borderRadius: 8, padding: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: BRAND, width: 46 }}>
                    {b.type === "URL" ? "Link" : b.type === "PHONE_NUMBER" ? "Call" : "Reply"}
                  </span>
                  <input value={b.text} placeholder="Button label" aria-label={`Button ${i + 1} label`}
                    onChange={(e) => updateButton(i, { text: e.target.value })}
                    style={{ ...inputStyle, marginBottom: 0, flex: "0 0 130px" }} />
                  {b.type === "URL" && (
                    <input value={b.url} placeholder="https://promunch.in/..." aria-label={`Button ${i + 1} link`}
                      onChange={(e) => updateButton(i, { url: e.target.value } as Partial<Btn>)}
                      style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                  )}
                  {b.type === "PHONE_NUMBER" && (
                    <input value={b.phone_number} placeholder="+919876543210" aria-label={`Button ${i + 1} phone number`}
                      onChange={(e) => updateButton(i, { phone_number: e.target.value } as Partial<Btn>)}
                      style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                  )}
                  {i > 0 && (
                    <button type="button" onClick={() => moveButtonUp(i)} aria-label="Move button up" style={{ ...smallBtn, padding: "4px 6px" }}><ArrowUp size={12} /></button>
                  )}
                  <button type="button" onClick={() => setButtons(editing.buttons.filter((_, j) => j !== i))}
                    aria-label="Remove button" style={{ ...smallBtn, padding: "4px 6px", color: "var(--pm-terra)" }}><X size={12} /></button>
                </div>
                {dynamic && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: "var(--pm-muted)", width: 176 }}>Example link for Meta</span>
                    <input value={Array.isArray(b.example) ? b.example[0] ?? "" : b.example ?? ""}
                      placeholder={`${(b.url ?? "").replace("{{1}}", "")}abc123`} aria-label={`Button ${i + 1} example link`}
                      onChange={(e) => updateButton(i, { example: e.target.value } as Partial<Btn>)}
                      style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                  </div>
                )}
                <FieldIssues errors={errors} warnings={warnings} field={`buttons.${i}`} />
              </div>
            );
          })}
          <IssueList issues={errors.filter((e) => e.field === "buttons")} tone="error" />
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <button type="button" style={smallBtn} onClick={() => setButtons([...editing.buttons, { type: "URL", text: "Shop now", url: "" }])}><ExternalLink size={13} /> Link</button>
            <button type="button" style={smallBtn} onClick={() => setButtons([...editing.buttons, { type: "QUICK_REPLY", text: "" }])}><CornerUpLeft size={13} /> Quick reply</button>
            <button type="button" style={smallBtn} onClick={() => setButtons([...editing.buttons, { type: "PHONE_NUMBER", text: "Call us", phone_number: "" }])}><Phone size={13} /> Call</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 12 }}>
            Links to our store get tracking added automatically, so orders they bring in show under Revenue from WhatsApp.
            For a link that changes per customer, end it with {"{{1}}"}, for example https://promunch.in/{"{{1}}"}.
          </div>

          {/* Checklist */}
          <div style={{ border: `1px solid ${errors.length ? "rgba(239,68,68,0.35)" : "rgba(16,185,129,0.35)"}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
            {errors.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--pm-green)", display: "flex", gap: 6, alignItems: "center" }}>
                <Check size={13} /> Passes every check we know of. Ready to send to Meta.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-terra)" }}>Fix {errors.length} thing{errors.length === 1 ? "" : "s"} before submitting</div>
                <IssueList issues={errors} tone="error" />
              </>
            )}
            {warnings.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginTop: 4 }}>Worth checking (won&apos;t block submitting)</div>
                <IssueList issues={warnings} tone="warning" />
              </>
            )}
          </div>

          {submitProblem && <ProblemBox problem={submitProblem} onClose={() => setSubmitProblem(null)} />}

          <div style={{ display: "flex", gap: 8, marginTop: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" onClick={() => setEditing(null)} disabled={busy} style={smallBtn}>Cancel</button>
            {editing.mode !== "edit" && (
              <button type="button" onClick={saveDraft} disabled={busy || !editing.name} style={smallBtn}>Save draft</button>
            )}
            <button type="button" onClick={() => setConfirmSubmit(true)} disabled={!canSubmit}
              title={errors.length ? "Fix the items in the checklist first" : undefined}
              style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}>
              <Send size={13} /> {busy ? "Sending..." : editing.mode === "edit" ? "Resubmit to Meta" : "Submit to Meta"}
            </button>
          </div>
        </Modal>
      )}

      {confirmSubmit && editing && (
        <ConfirmDialog
          title={editing.mode === "edit" ? "Resubmit this template to Meta?" : "Send this template to Meta for approval?"}
          confirmLabel={editing.mode === "edit" ? "Resubmit" : "Submit"}
          busy={busy}
          onClose={() => setConfirmSubmit(false)}
          onConfirm={submitToMeta}
          body={
            <div style={{ fontSize: 13 }}>
              Meta usually reviews templates within a few hours. Nothing is sent to customers now; you can use the
              template in a campaign once it shows Approved.
              {approvedEdit && <> This counts toward Meta&apos;s limit of about 1 edit a day and 10 a month.</>}
            </div>
          }
        />
      )}
    </div>
  );
}
