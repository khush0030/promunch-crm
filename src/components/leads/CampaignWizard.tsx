"use client";

// Campaign wizard — the one guided path from a list to sent emails.
// Four steps: 1 pick recipients (with bulk "find emails"), 2 choose the copy
// (existing template, blank, or AI-drafted with per-campaign product
// targeting), 3 per-lead preview of the exact rendered email, 4 launch.
// Quick campaigns create a one-shot sequence behind the scenes so sending,
// caps, replies and analytics all ride the existing sequence engine.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight,
  MailSearch, Rocket, Sparkles, X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { Contact, ListLead, ListSummary, SequenceRow, TemplateRow } from "./types";
import { PRODUCT_OPTIONS } from "./constants";
import { renderTemplate } from "@/lib/leads/templates";
import { useEscapeKey } from "./useEscapeKey";

const STEP_LABELS = ["Recipients", "Copy", "Preview", "Launch"];

type Settings = {
  daily_cap: number;
  paused: boolean;
  from_name: string;
  from_email: string;
  send_window_start?: number | null;
  send_window_end?: number | null;
};

type Variant = { label: string; subject: string; body: string };

function verifiedContact(lead: ListLead): Contact | null {
  const contacts = lead.lead_contacts ?? [];
  return (
    contacts.find((c) => c.is_primary && c.verify_status === "mx_ok") ??
    contacts.find((c) => c.verify_status === "mx_ok") ??
    null
  );
}

// "ready" = will actually be sent to; mirrors the enroll API's rules.
function readiness(lead: ListLead): "ready" | "in_sequence" | "no_email" | "blocked" {
  if (["replied", "bounced", "suppressed"].includes(lead.status)) return "blocked";
  if (!verifiedContact(lead)) return "no_email";
  if (lead.enrollment && ["active", "sending"].includes(lead.enrollment.status)) return "in_sequence";
  return "ready";
}

function leadVars(lead: ListLead) {
  const contact = verifiedContact(lead);
  return {
    name: contact?.role_hint ?? null,
    company: lead.name,
    city: lead.city,
    category: lead.category,
  };
}

export default function CampaignWizard({
  listId, onClose, onDone,
}: {
  listId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  useEscapeKey(onClose);

  const [step, setStep] = useState(0);
  const [list, setList] = useState<ListSummary | null>(null);
  const [leads, setLeads] = useState<ListLead[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  // step 1 — recipients
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [initialised, setInitialised] = useState(false);
  const [finding, setFinding] = useState(false);
  const [findProgress, setFindProgress] = useState("");

  // step 2 — copy
  const [mode, setMode] = useState<"quick" | "sequence">("quick");
  const [campaignName, setCampaignName] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [sourceTemplateId, setSourceTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [aiPolish, setAiPolish] = useState(true);
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedSequenceId, setSelectedSequenceId] = useState("");

  // step 3 — preview
  const [previewIdx, setPreviewIdx] = useState(0);

  // step 4 — launch
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<{ enrolled: number; skipped: Record<string, number> } | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch(`/api/leads/lists/${listId}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "load failed");
    setList(json.list);
    setLeads(json.leads);
    return json.leads as ListLead[];
  }, [listId]);

  useEffect(() => {
    (async () => {
      try {
        const [freshLeads, tplRes, seqRes, setRes] = await Promise.all([
          loadList(),
          fetch("/api/leads/templates", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/leads/sequences", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/leads/settings", { cache: "no-store" }).then((r) => r.json()),
        ]);
        setTemplates(tplRes.templates ?? []);
        setSequences(((seqRes.sequences ?? []) as SequenceRow[]).filter((s) => s.status !== "archived"));
        setSettings(setRes.settings ?? null);
        // Everyone ready to receive an email starts selected.
        setChecked(new Set(freshLeads.filter((l) => readiness(l) === "ready").map((l) => l.id)));
        setInitialised(true);
      } catch (e) {
        toast.push({ kind: "error", text: `Campaign: ${e instanceof Error ? e.message : "unknown"}` });
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (list && !campaignName) {
      const day = new Date().toLocaleDateString([], { month: "short", day: "numeric" });
      setCampaignName(`${list.name} — ${day}`);
    }
  }, [list, campaignName]);

  const groups = useMemo(() => {
    const g = { ready: [] as ListLead[], in_sequence: [] as ListLead[], no_email: [] as ListLead[], blocked: [] as ListLead[] };
    for (const l of leads) g[readiness(l)].push(l);
    return g;
  }, [leads]);

  const recipients = useMemo(
    () => leads.filter((l) => checked.has(l.id) && (readiness(l) === "ready" || readiness(l) === "in_sequence")),
    [leads, checked],
  );

  function toggleLead(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function findEmails() {
    const targets = groups.no_email;
    if (!targets.length) return;
    setFinding(true);
    let found = 0;
    for (let i = 0; i < targets.length; i++) {
      setFindProgress(`${i + 1}/${targets.length}`);
      try {
        const res = await fetch(`/api/leads/${targets[i].id}/enrich`, { method: "POST" });
        const json = await res.json();
        if (res.ok && ((json.newUsable ?? 0) > 0 || (json.contactsFound ?? 0) > 0)) found++;
      } catch {
        // per-lead failure is fine; the summary toast covers it
      }
    }
    try {
      const fresh = await loadList();
      // Newly verified leads join the selection automatically.
      setChecked((prev) => {
        const next = new Set(prev);
        for (const l of fresh) {
          if (!verifiedContact(l)) continue;
          if (["replied", "bounced", "suppressed"].includes(l.status)) continue;
          if (l.enrollment && ["active", "sending"].includes(l.enrollment.status)) continue;
          next.add(l.id);
        }
        return next;
      });
    } catch { /* list reload failed; leave state as-is */ }
    setFinding(false);
    setFindProgress("");
    toast.push({
      kind: found ? "success" : "error",
      text: found
        ? `Verified emails found for ${found} of ${targets.length} leads. They are selected now.`
        : `Crawled ${targets.length} sites but no new verified emails turned up. You can add one by hand from the lead card.`,
    });
  }

  function applyTemplate(id: string) {
    setSourceTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject);
      setBodyText(t.body_text);
    } else {
      setSubject("");
      setBodyText("");
    }
  }

  async function generateAi() {
    const brief = aiBrief.trim() ||
      `Pitch ${products.length ? products.join(" and ") : "PROMUNCH snacks"} to ${list?.category ?? "these companies"} for bulk and corporate orders; offer a free sample box`;
    setAiBusy(true);
    setVariants([]);
    try {
      const res = await fetch("/api/leads/templates/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, products }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "generate failed");
      setVariants(json.variants ?? []);
    } catch (e) {
      toast.push({ kind: "error", text: `AI draft: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setAiBusy(false);
    }
  }

  const selectedSequence = sequences.find((s) => s.id === selectedSequenceId) ?? null;
  const previewSubjectRaw = mode === "quick" ? subject : selectedSequence?.steps[0]?.template_subject ?? "";
  const previewBodyRaw = mode === "quick" ? bodyText : selectedSequence?.steps[0]?.template_body ?? "";
  const previewPolish = mode === "quick" ? aiPolish : selectedSequence?.ai_polish ?? false;
  const previewLead = recipients[Math.min(previewIdx, Math.max(0, recipients.length - 1))] ?? null;

  const canNext =
    step === 0 ? recipients.length > 0
    : step === 1
      ? (mode === "quick"
          ? !!campaignName.trim() && !!subject.trim() && !!bodyText.trim()
          : !!selectedSequenceId)
    : true;

  async function launch() {
    setLaunching(true);
    try {
      let sequenceId = selectedSequenceId;
      if (mode === "quick") {
        // Reuse the source template untouched; otherwise save the edited copy
        // as a new template so the send engine has a row to render.
        const src = templates.find((t) => t.id === sourceTemplateId);
        let templateId = src && src.subject === subject && src.body_text === bodyText ? src.id : null;
        if (!templateId) {
          const tplRes = await fetch("/api/leads/templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: campaignName.trim().slice(0, 120), subject, body_text: bodyText }),
          });
          const tplJson = await tplRes.json();
          if (!tplRes.ok) throw new Error(tplJson.error || "template save failed");
          templateId = tplJson.template.id as string;
        }
        const seqRes = await fetch("/api/leads/sequences", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: campaignName.trim(),
            ai_polish: aiPolish,
            stop_on_reply: true,
            steps: [{ template_id: templateId, wait_days: 0 }],
          }),
        });
        const seqJson = await seqRes.json();
        if (!seqRes.ok) throw new Error(seqJson.error || "campaign create failed");
        sequenceId = seqJson.sequence.id as string;
      }

      const res = await fetch(`/api/leads/sequences/${sequenceId}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ list_id: listId, lead_ids: recipients.map((l) => l.id) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "enroll failed");
      setResult({ enrolled: json.enrolled, skipped: json.skipped ?? {} });
      onDone();
    } catch (e) {
      toast.push({ kind: "error", text: `Launch: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLaunching(false);
    }
  }

  const cap = settings?.daily_cap ?? 0;
  const days = cap > 0 ? Math.max(1, Math.ceil(recipients.length / cap)) : 1;

  return (
    <div className={styles.overlay} onClick={result ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Email this list"
        className={`pm-panel ${styles.modal} ${styles.modalXl}`}
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 20 }}
      >
        <div className={styles.modalHead}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Email “{list?.name ?? "…"}”</h3>
            {!result && (
              <div className={styles.wizSteps}>
                {STEP_LABELS.map((label, i) => (
                  <span key={label} className={`${styles.wizStep}${i === step ? ` ${styles.wizStepOn}` : ""}${i < step ? ` ${styles.wizStepDone}` : ""}`}>
                    {i < step ? <CheckCircle2 size={12} /> : <span className={styles.wizStepNum}>{i + 1}</span>}
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>

        {loading || !initialised ? (
          <div className="pm-empty">Loading the list…</div>
        ) : result ? (
          <LaunchedPanel result={result} mode={mode} onClose={onClose} />
        ) : (
          <>
            {step === 0 && (
              <div>
                <p className={styles.wizIntro}>
                  Tick who should get this campaign. Only leads with a <b>verified email</b> can
                  receive one — for the rest, “Find emails” re-crawls their website and verifies
                  anything it finds.
                </p>

                {groups.ready.length + groups.in_sequence.length === 0 && groups.no_email.length === 0 ? (
                  <div className="pm-empty">
                    Nothing sendable here: every lead has replied, bounced or is suppressed.
                  </div>
                ) : (
                  <div className={styles.recipScroll}>
                    {groups.ready.length > 0 && (
                      <RecipGroup
                        title={`Ready to email (${groups.ready.length})`}
                        hint="Verified email, never annoyed: not in another sequence, has not replied or bounced."
                        leads={groups.ready}
                        checked={checked}
                        onToggle={toggleLead}
                        onToggleAll={(on) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            groups.ready.forEach((l) => (on ? next.add(l.id) : next.delete(l.id)));
                            return next;
                          })
                        }
                      />
                    )}
                    {groups.in_sequence.length > 0 && (
                      <RecipGroup
                        title={`Already in another sequence (${groups.in_sequence.length})`}
                        hint="They are mid-way through other emails. Unticked by default so nobody gets two pitches at once — tick to include anyway."
                        leads={groups.in_sequence}
                        checked={checked}
                        onToggle={toggleLead}
                      />
                    )}
                    {groups.no_email.length > 0 && (
                      <div className={styles.recipGroup}>
                        <div className={styles.recipGroupHead}>
                          <span className={styles.recipGroupTitle}>No verified email yet ({groups.no_email.length})</span>
                          <button type="button" className="pm-btn" disabled={finding} onClick={findEmails}>
                            <MailSearch size={13} />{" "}
                            {finding ? `Finding ${findProgress}…` : `Find emails (${groups.no_email.length})`}
                          </button>
                        </div>
                        <div className={styles.recipGroupHint}>
                          We visit each company&apos;s website, pull addresses and verify their mail
                          server. Found ones join the selection automatically. No luck? Open the lead
                          from the list and add an email by hand.
                        </div>
                        {groups.no_email.map((l) => (
                          <div key={l.id} className={styles.recipRow}>
                            <span style={{ width: 16 }} />
                            <span className={styles.recipName}>{l.name}</span>
                            <span className="pm-dim">{[l.category, l.city].filter(Boolean).join(" · ")}</span>
                            <span className="pm-badge2 bg-gray">no email</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {groups.blocked.length > 0 && (
                      <div className={styles.recipGroup}>
                        <div className={styles.recipGroupHead}>
                          <span className={styles.recipGroupTitle}>Will be skipped ({groups.blocked.length})</span>
                        </div>
                        <div className={styles.recipGroupHint}>
                          Replied, bounced or unsubscribed leads are never emailed again by a campaign.
                        </div>
                        {groups.blocked.map((l) => (
                          <div key={l.id} className={`${styles.recipRow} ${styles.recipRowMuted}`}>
                            <span style={{ width: 16 }} />
                            <span className={styles.recipName}>{l.name}</span>
                            <span className={`pm-badge2 ${l.status === "replied" ? "bg-gold" : "bg-terra"}`}>{l.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div>
                <p className={styles.wizIntro}>
                  Choose what the {recipients.length} selected lead{recipients.length === 1 ? "" : "s"} receive:
                  a fresh one-off email, or drop them into a sequence you already built.
                </p>
                <div className={styles.wizModeRow}>
                  <label className={`${styles.enrollOption}${mode === "quick" ? ` ${styles.enrollOptionOn}` : ""}`}>
                    <input type="radio" name="mode" checked={mode === "quick"} onChange={() => setMode("quick")} />
                    <span><b>One email now</b><span className="pm-dim" style={{ display: "block", fontSize: 12 }}>Write it here (or AI-draft it). Sent once; replies land in Replies.</span></span>
                  </label>
                  <label className={`${styles.enrollOption}${mode === "sequence" ? ` ${styles.enrollOptionOn}` : ""}`}>
                    <input type="radio" name="mode" checked={mode === "sequence"} onChange={() => setMode("sequence")} />
                    <span><b>Existing sequence</b><span className="pm-dim" style={{ display: "block", fontSize: 12 }}>Intro + timed follow-ups you set up in the Sequences tab.</span></span>
                  </label>
                </div>

                {mode === "quick" ? (
                  <div className={styles.tplEditorGrid} style={{ marginTop: 14 }}>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="wiz-name">Campaign name <span className="pm-muted">(internal, shows in Analytics)</span></label>
                      <input id="wiz-name" className="input" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />

                      <div className={styles.fieldLabel} style={{ marginTop: 12 }}>
                        Product targeting <span className="pm-muted">(steers the AI draft for this campaign)</span>
                      </div>
                      <div className="pm-chips" style={{ flexWrap: "wrap" }}>
                        {PRODUCT_OPTIONS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`pm-chip${products.includes(p) ? " on" : ""}`}
                            onClick={() =>
                              setProducts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
                            }
                          >
                            {p}
                          </button>
                        ))}
                      </div>

                      <label className={styles.fieldLabel} htmlFor="wiz-src" style={{ marginTop: 12 }}>Start from</label>
                      <select id="wiz-src" className="input" value={sourceTemplateId} onChange={(e) => applyTemplate(e.target.value)}>
                        <option value="">Blank email</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>Template: {t.name}</option>
                        ))}
                      </select>

                      <div className={styles.wizAiBox}>
                        <div className={styles.fieldLabel} style={{ marginTop: 0 }}>Or let AI draft it</div>
                        <textarea
                          className="input"
                          rows={2}
                          placeholder={`e.g. Pitch ${products.length ? products.join(" and ") : "Edamame and Soya Crunchies"} as ${list?.category ?? "corporate"} gift hampers; offer a free sample box`}
                          value={aiBrief}
                          onChange={(e) => setAiBrief(e.target.value)}
                        />
                        <button type="button" className="pm-btn" style={{ marginTop: 8 }} disabled={aiBusy} onClick={generateAi}>
                          <Sparkles size={13} /> {aiBusy ? "Writing…" : variants.length ? "Regenerate" : "Draft 3 options"}
                        </button>
                        <div className={styles.recipGroupHint} style={{ marginTop: 6 }}>
                          Drafts are grounded in the PROMUNCH knowledge base and lead with your
                          selected products. Pick one, then edit it on the right.
                        </div>
                        {variants.map((v) => (
                          <div key={v.label} className={styles.variantCard}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <b style={{ fontSize: 12.5 }}>{v.label}</b>
                              <div className="pm-b7" style={{ fontSize: 12 }}>{v.subject}</div>
                              <div className="pm-dim" style={{ fontSize: 11.5, marginTop: 2 }}>
                                {v.body.slice(0, 120)}{v.body.length > 120 ? "…" : ""}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="pm-btn primary"
                              onClick={() => { setSubject(v.subject); setBodyText(v.body); setSourceTemplateId(""); }}
                            >
                              Use
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="wiz-subject">Subject</label>
                      <input
                        id="wiz-subject"
                        className="input"
                        placeholder="PROMUNCH for {company} gift hampers"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                      />
                      <label className={styles.fieldLabel} htmlFor="wiz-body" style={{ marginTop: 12 }}>Body</label>
                      <textarea
                        id="wiz-body"
                        className="input"
                        rows={12}
                        value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)}
                      />
                      <div className={styles.recipGroupHint} style={{ marginTop: 6 }}>
                        {"{name} {company} {city} {category}"} fill in per lead — you will see the
                        real result for every company in the next step.
                      </div>
                      <label className={styles.toggleCard} style={{ marginTop: 10 }}>
                        <input type="checkbox" checked={aiPolish} onChange={(e) => setAiPolish(e.target.checked)} />
                        <span className={styles.toggleCopy}>
                          <b>AI-personalise the opening line per company</b>
                          <span className={styles.toggleHint}>Rewrites the first 1–2 sentences using what we know from their website. Nothing else changes.</span>
                        </span>
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className={styles.enrollOptions} style={{ marginTop: 14 }}>
                    {sequences.length === 0 ? (
                      <div className="pm-empty" style={{ padding: 18 }}>
                        No sequences yet — pick “One email now”, or build one in the Sequences tab.
                      </div>
                    ) : (
                      sequences.map((s) => (
                        <label key={s.id} className={`${styles.enrollOption}${selectedSequenceId === s.id ? ` ${styles.enrollOptionOn}` : ""}`}>
                          <input type="radio" name="sequence" checked={selectedSequenceId === s.id} onChange={() => setSelectedSequenceId(s.id)} />
                          <span>
                            <b>{s.name}</b>
                            <span className="pm-dim" style={{ display: "block", fontSize: 12 }}>
                              {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                              {s.steps.length > 1 ? ` · waits ${s.steps.slice(1).map((st) => `${st.wait_days}d`).join(", ")}` : " (one-shot)"}
                              {" · "}first email: “{s.steps[0]?.template_subject ?? "?"}”
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div>
                <p className={styles.wizIntro}>
                  This is the exact email each company receives, variables filled in. Flip through
                  all {recipients.length} before launching.
                  {previewPolish ? " The opening line will additionally be AI-personalised per company at send time." : ""}
                </p>
                {previewLead ? (
                  <>
                    <div className={styles.previewNav}>
                      <button type="button" className="pm-btn" disabled={previewIdx <= 0} onClick={() => setPreviewIdx((i) => i - 1)} aria-label="Previous lead">
                        <ChevronLeft size={14} />
                      </button>
                      <select
                        className="input"
                        style={{ maxWidth: 320 }}
                        value={previewLead.id}
                        onChange={(e) => setPreviewIdx(recipients.findIndex((l) => l.id === e.target.value))}
                      >
                        {recipients.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                      <button type="button" className="pm-btn" disabled={previewIdx >= recipients.length - 1} onClick={() => setPreviewIdx((i) => i + 1)} aria-label="Next lead">
                        <ChevronRight size={14} />
                      </button>
                      <span className="pm-dim" style={{ fontSize: 12 }}>{previewIdx + 1} of {recipients.length}</span>
                    </div>
                    <div className={styles.tplPreview} style={{ marginTop: 10 }}>
                      <div className={styles.tplPreviewFrom}>
                        {settings ? `${settings.from_name} <${settings.from_email}>` : "PROMUNCH"} → {verifiedContact(previewLead)?.email ?? "?"}
                      </div>
                      <div className={styles.tplPreviewSubject}>
                        {renderTemplate(previewSubjectRaw || "(no subject)", leadVars(previewLead))}
                      </div>
                      {renderTemplate(previewBodyRaw || "(empty body)", leadVars(previewLead))
                        .split(/\n{2,}|\n/)
                        .filter(Boolean)
                        .map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                    </div>
                    {mode === "sequence" && selectedSequence && selectedSequence.steps.length > 1 && (
                      <div className={styles.recipGroupHint} style={{ marginTop: 8 }}>
                        Showing step 1 of {selectedSequence.steps.length}. Later steps go out{" "}
                        {selectedSequence.steps.slice(1).map((st) => `${st.wait_days} day${st.wait_days === 1 ? "" : "s"}`).join(", then ")} after,
                        and stop automatically for anyone who replies.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="pm-empty">No recipients selected.</div>
                )}
              </div>
            )}

            {step === 3 && (
              <div>
                <p className={styles.wizIntro}>Last check before anything is queued.</p>
                <div className={styles.wizSummary}>
                  <div className={styles.settingRow}><span>Recipients</span><b>{recipients.length} lead{recipients.length === 1 ? "" : "s"}</b></div>
                  <div className={styles.settingRow}><span>Campaign</span><b>{mode === "quick" ? campaignName : selectedSequence?.name}</b></div>
                  <div className={styles.settingRow}>
                    <span>Sends as</span>
                    <b>{settings ? `${settings.from_name} <${settings.from_email}>` : "—"}</b>
                  </div>
                  <div className={styles.settingRow}>
                    <span>Pace</span>
                    <b>
                      max {cap || "—"}/day inside the send window
                      {recipients.length > 0 && cap > 0 ? ` · done in ~${days} day${days === 1 ? "" : "s"}` : ""}
                    </b>
                  </div>
                  {settings?.paused && (
                    <div className={styles.settingRow}>
                      <span>Heads up</span>
                      <b style={{ color: "var(--pm-terra, #b4532f)" }}>Sending is paused in Settings — nothing goes out until you unpause.</b>
                    </div>
                  )}
                </div>
                <div className={styles.recipGroupHint} style={{ marginTop: 10 }}>
                  Anyone who replies is stopped automatically and appears in the Replies tab.
                  Bounces and unsubscribes are suppressed for good. Watch open and reply rates in
                  the Analytics tab.
                </div>
              </div>
            )}

            <div className={styles.actionRow}>
              {step > 0 && (
                <button type="button" className="pm-btn" onClick={() => setStep((s) => s - 1)} disabled={launching}>
                  <ArrowLeft size={13} /> Back
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="pm-btn" onClick={onClose} disabled={launching}>Cancel</button>
              {step < 3 ? (
                <button type="button" className="pm-btn primary" disabled={!canNext} onClick={() => { setPreviewIdx(0); setStep((s) => s + 1); }}>
                  {step === 0 ? `Continue with ${recipients.length} lead${recipients.length === 1 ? "" : "s"}` : "Continue"} <ArrowRight size={13} />
                </button>
              ) : (
                <button type="button" className="pm-btn primary" disabled={launching || recipients.length === 0} onClick={launch}>
                  <Rocket size={13} /> {launching ? "Launching…" : `Start sending to ${recipients.length}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RecipGroup({
  title, hint, leads, checked, onToggle, onToggleAll,
}: {
  title: string;
  hint: string;
  leads: ListLead[];
  checked: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll?: (on: boolean) => void;
}) {
  const allOn = leads.every((l) => checked.has(l.id));
  return (
    <div className={styles.recipGroup}>
      <div className={styles.recipGroupHead}>
        <span className={styles.recipGroupTitle}>{title}</span>
        {onToggleAll && (
          <label className={styles.recipAll}>
            <input type="checkbox" checked={allOn} onChange={(e) => onToggleAll(e.target.checked)} /> all
          </label>
        )}
      </div>
      <div className={styles.recipGroupHint}>{hint}</div>
      {leads.map((l) => {
        const contact = verifiedContact(l);
        return (
          <label key={l.id} className={styles.recipRow}>
            <input
              type="checkbox"
              checked={checked.has(l.id)}
              onChange={(e) => onToggle(l.id, e.target.checked)}
            />
            <span className={styles.recipName}>{l.name}</span>
            <span className="pm-dim mono" style={{ fontSize: 12 }}>{contact?.email}</span>
            {l.enrollment && ["active", "sending"].includes(l.enrollment.status) && (
              <span className="pm-badge2 bg-blue" title={l.enrollment.sequence_name ?? undefined}>in “{l.enrollment.sequence_name}”</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function LaunchedPanel({
  result, mode, onClose,
}: {
  result: { enrolled: number; skipped: Record<string, number> };
  mode: "quick" | "sequence";
  onClose: () => void;
}) {
  const skippedNote = Object.entries(result.skipped)
    .map(([reason, n]) => `${n} ${reason}`)
    .join(", ");
  return (
    <div style={{ textAlign: "center", padding: "26px 12px 10px" }}>
      <CheckCircle2 size={36} style={{ color: "var(--pm-green, #2f7d5b)" }} />
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: "10px 0 6px" }}>
        Campaign launched — {result.enrolled} lead{result.enrolled === 1 ? "" : "s"} queued
      </h3>
      {skippedNote && (
        <p className="pm-muted" style={{ fontSize: 12.5 }}>Skipped: {skippedNote}.</p>
      )}
      <div className={styles.guideTips} style={{ textAlign: "left", marginTop: 16 }}>
        <div className={styles.guideTipsTitle}>What happens now</div>
        <ul className={styles.guideTipList}>
          <li>Emails go out automatically inside the send window, respecting the daily cap. Nothing else for you to do.</li>
          <li>Replies stop that lead&apos;s {mode === "sequence" ? "sequence" : "campaign"} instantly and appear in the <b>Replies</b> tab.</li>
          <li>Open, click and reply rates build up in the <b>Analytics</b> tab under this campaign&apos;s name.</li>
          <li>Need to stop everything? <b>Settings → Pause</b>, or pause the sequence in the Sequences tab.</li>
        </ul>
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        <button type="button" className="pm-btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
