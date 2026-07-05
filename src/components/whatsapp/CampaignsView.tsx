"use client";

// Campaigns tab of the WhatsApp dashboard: campaign list + creation modal
// (segments, scheduling, AI personalization), per-campaign recipients view and
// the CSV contact importer. Extracted from dashboard/whatsapp/page.tsx (audit R5).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, Clock, FileText, Megaphone, Phone, Plus, RefreshCw,
  Send, Sparkles, Trash2, Upload, User as UserIcon, X,
} from "lucide-react";
import { explainWaError } from "./waErrors";
import { useToast } from "@/components/ui/Toast";
import { timeAgo } from "@/app/dashboard/whatsapp/format";
import type { Campaign, Template, Recipient, RecipientSummary } from "./types";
import {
  WA_GREEN, campaignStatusStyle, inputStyle, cardStyle, primaryBtn, smallBtn, chip,
} from "./styles";
import { Modal, Field } from "./primitives";
import { WhatsAppPreview } from "./WhatsAppPreview";

// Per-campaign "who did this actually go to" view. Groups by contact, shows each
// person's final status + flags anyone messaged more than once (duplicate).
function RecipientsModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [data, setData] = useState<{ summary: RecipientSummary; recipients: Recipient[] } | null>(null);
  const [filter, setFilter] = useState<"all" | "received" | "failed" | "duplicate">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/whatsapp/campaigns/${campaign.id}/recipients`)
      .then((r) => r.json()).then((j) => setData(j)).catch(() => {}).finally(() => setLoading(false));
  }, [campaign.id]);

  const sb = data?.summary;
  const rows = (data?.recipients ?? []).filter((r) =>
    filter === "all" ? true :
    filter === "received" ? ["sent", "delivered", "read"].includes(r.status) :
    filter === "failed" ? r.status === "failed" :
    r.duplicate);

  const statusColor = (s: string) => s === "read" ? "var(--pm-green)" : s === "delivered" ? "var(--pm-green)" : s === "sent" ? "#1d4ed8" : s === "failed" ? "var(--pm-terra)" : "var(--pm-muted)";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--pm-card)", borderRadius: 14, width: "min(720px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--pm-border)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--pm-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{campaign.name}</div>
            <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>Recipients &amp; delivery status</div>
          </div>
          <button type="button" title="Close" aria-label="Close" onClick={onClose} style={{ ...smallBtn, padding: "6px 9px" }}><X size={14} /></button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--pm-hint)" }}>Loading…</div>
        ) : !sb ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--pm-hint)" }}>No data.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, padding: "12px 20px", flexWrap: "wrap", borderBottom: "1px solid var(--pm-line)" }}>
              {[
                { k: "received", n: sb.received, l: "received", c: "var(--pm-green)" },
                { k: "read", n: sb.read, l: "read", c: "var(--pm-green)" },
                { k: "failed", n: sb.failed, l: "failed", c: "var(--pm-terra)" },
                { k: "duplicates", n: sb.duplicates, l: "got duplicates", c: sb.duplicates > 0 ? "var(--pm-terra)" : "var(--pm-muted)" },
                { k: "contacts", n: sb.contacts, l: "unique people", c: "var(--pm-ink)" },
              ].map((s) => (
                <div key={s.k} style={{ minWidth: 92 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.n.toLocaleString("en-IN")}</div>
                  <div style={{ fontSize: 11, color: "var(--pm-hint)" }}>{s.l}</div>
                </div>
              ))}
            </div>

            <div className="pm-chips" style={{ padding: "10px 20px 4px" }}>
              {(["all", "received", "failed", "duplicate"] as const).map((f) => (
                <button key={f} type="button" className={`pm-chip${filter === f ? " on" : ""}`} onClick={() => setFilter(f)} style={{ fontSize: 12 }}>
                  {f === "all" ? "All" : f === "received" ? "Received" : f === "failed" ? "Failed" : "Duplicates"}
                </button>
              ))}
            </div>

            <div style={{ overflowY: "auto", padding: "8px 20px 16px" }}>
              {rows.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--pm-hint)", fontSize: 13 }}>None.</div>
              ) : rows.map((r) => (
                <div key={r.contact_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--pm-line)" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.name || r.wa_id || "Unknown"}</span>
                    {r.name && r.wa_id && <span style={{ fontSize: 11, color: "var(--pm-hint)" }}> · {r.wa_id}</span>}
                    {r.error && (
                      <span style={{ display: "block", fontSize: 11, color: "var(--pm-terra)" }}>
                        {explainWaError(r.error) ?? r.error}
                      </span>
                    )}
                  </span>
                  {r.duplicate && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--pm-terra)", background: "var(--pm-terra-soft)", padding: "2px 7px", borderRadius: 20 }}>×{r.attempts} DUP</span>}
                  <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(r.status), textTransform: "capitalize", minWidth: 64, textAlign: "right" }}>{r.status}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CampaignsView() {
  const toast = useToast();
  const [list, setList] = useState<Campaign[]>([]);
  const [creating, setCreating] = useState(false);
  const [createSeg, setCreateSeg] = useState<string[] | null>(null);
  const [segs, setSegs] = useState<{ rfm_tier: string; customers: number; spend: number; avg_recency: number }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [recipientsFor, setRecipientsFor] = useState<Campaign | null>(null);
  const [recovery, setRecovery] = useState<
    { enrolled: number; recovered: number; delivered: number; retrying: number; missed: number; reached: number; reachRate: number } | null
  >(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/whatsapp/campaigns");
    const j = await r.json();
    setList(j.campaigns ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/whatsapp/segments").then((r) => r.json()).then((j) => setSegs(j.segments ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    const f = () => fetch("/api/whatsapp/cart-recovery").then((r) => r.json()).then((j) => setRecovery(j.stats ?? null)).catch(() => {});
    f();
    const t = setInterval(f, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function send(c: Campaign) {
    if (!confirm(`Send "${c.name}" now? This messages every matching opted-in contact and is billed by Meta.`)) return;
    setBusy(c.id);
    try {
      const r = await fetch(`/api/whatsapp/campaigns/${c.id}/send`, { method: "POST" });
      const j = await r.json();
      if (j.error) toast.push({ kind: "error", text: "Send failed: " + j.error });
      else
        toast.push({
          kind: "success",
          text: `Done — ${j.sent} sent, ${j.failed} failed${j.remaining ? `, ${j.remaining} remaining (click Resume to continue)` : ""}.`,
        });
      load();
    } finally { setBusy(null); }
  }
  async function remove(id: string) {
    if (!confirm("Delete campaign?")) return;
    await fetch(`/api/whatsapp/campaigns/${id}`, { method: "DELETE" });
    load();
  }
  async function unschedule(id: string) {
    await fetch(`/api/whatsapp/campaigns/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "draft", scheduled_at: null }),
    });
    load();
  }
  async function importContacts() {
    if (!confirm("Import all Shopify-synced contacts (with a phone number) into WhatsApp contacts? Existing contacts are left untouched.")) return;
    setImporting(true);
    try {
      const r = await fetch("/api/whatsapp/import-contacts", { method: "POST" });
      const j = await r.json();
      if (j.error) toast.push({ kind: "error", text: "Import failed: " + j.error });
      else
        toast.push({
          kind: "success",
          text: `Imported ${j.imported} new contact(s) · scanned ${j.scanned}, skipped ${j.skipped} (no valid phone / duplicate) · ${j.total_wa_contacts} WhatsApp contacts total.`,
        });
    } finally { setImporting(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)" }}>
          Broadcast an approved marketing template to opted-in WhatsApp contacts. Meta bills per message.
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <button type="button" onClick={importContacts} disabled={importing} style={smallBtn}>
            <Upload size={14} /> {importing ? "Importing…" : "From Shopify"}
          </button>
          <button type="button" onClick={() => setCsvOpen(true)} style={smallBtn}>
            <FileText size={14} /> Upload CSV
          </button>
          <button type="button" onClick={() => setCreating(true)} style={primaryBtn}><Plus size={14} /> New campaign</button>
        </div>
      </div>

      {recovery && recovery.enrolled > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Abandoned-cart recovery · last 30 days
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
            {[
              { n: recovery.reached, l: "Reached", hint: `${recovery.reachRate}% of ${recovery.enrolled} carts got a message`, color: "var(--pm-green)" },
              { n: recovery.recovered, l: "Recovered", hint: "checked out after the nudge", color: "var(--pm-green)" },
              { n: recovery.retrying, l: "Retrying", hint: "in-flight, not yet delivered", color: "var(--pm-gold)" },
              { n: recovery.missed, l: "Missed", hint: "deadline passed, never delivered", color: recovery.missed > 0 ? "var(--pm-terra)" : "var(--pm-hint)" },
            ].map((s) => (
              <div key={s.l} style={cardStyle}>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.6, color: s.color }}>{s.n.toLocaleString("en-IN")}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", marginTop: 2 }}>{s.l}</div>
                <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 3, lineHeight: 1.3 }}>{s.hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {segs.length > 0 && (() => {
        const byTier = Object.fromEntries(segs.map((s) => [s.rfm_tier, s]));
        return (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Customer segments
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10 }}>
              {SEGMENTS.map((seg) => {
                const rows = seg.tags.map((t) => byTier[t]).filter(Boolean);
                const customers = rows.reduce((a, r) => a + Number(r.customers), 0);
                const spend = rows.reduce((a, r) => a + Number(r.spend), 0);
                return (
                  <div key={seg.key} style={cardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{seg.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--pm-green)" }}>{customers.toLocaleString("en-IN")}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--pm-hint)", margin: "2px 0 8px" }}>{seg.hint}</div>
                    <div style={{ fontSize: 11, color: "var(--pm-muted)", marginBottom: 10 }}>
                      ₹{Math.round(spend).toLocaleString("en-IN")} lifetime spend
                    </div>
                    <button type="button" onClick={() => setCreateSeg([seg.key])} disabled={customers === 0} style={{ ...smallBtn, width: "100%", justifyContent: "center" }}>
                      <Megaphone size={12} /> Campaign
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 12 }}>
        {list.length === 0 && (
          <div style={{ gridColumn: "1/-1", padding: 32, textAlign: "center", color: "var(--pm-hint)", fontSize: 13 }}>
            No campaigns yet.
          </div>
        )}
        {list.map((c) => {
          const ss = campaignStatusStyle[c.status] ?? campaignStatusStyle.draft;
          const tags = c.audience_filter?.tags ?? [];
          return (
            <div key={c.id} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <span style={{
                  background: ss.bg, color: ss.color, fontSize: 11, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 999, textTransform: "capitalize",
                }}>{c.status}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8 }}>
                <Megaphone size={11} style={{ verticalAlign: -1 }} /> {c.template?.name ?? "— no template —"}
                {tags.length ? ` · tags: ${tags.join(", ")}` : " · all opted-in"}
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <span><strong>{c.sent_count}</strong> sent</span>
                <span><strong>{c.delivered_count}</strong> delivered</span>
                <span><strong>{c.read_count}</strong> read</span>
                {c.failed_count > 0 && <span style={{ color: "var(--pm-terra)" }}><strong>{c.failed_count}</strong> failed</span>}
              </div>
              {c.last_error && (() => {
                const friendly = explainWaError(c.last_error);
                return (
                  <div style={{ fontSize: 11, color: "var(--pm-terra)", marginBottom: 8 }}>
                    {friendly ?? c.last_error}
                    {friendly && <div style={{ color: "var(--pm-hint)", marginTop: 2 }}>{c.last_error}</div>}
                  </div>
                );
              })()}
              {c.status === "sending" && c.resume_at && new Date(c.resume_at).getTime() > Date.now() && (
                <div style={{ fontSize: 11, color: "#92400e", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={11} /> Meta&apos;s daily sending limit reached — paused, auto-resumes{" "}
                  {new Date(c.resume_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
              {c.status === "scheduled" && c.scheduled_at && (
                <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={11} /> {c.repeat_rule ? "Next" : "Scheduled for"} {new Date(c.scheduled_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
              {c.repeat_rule && (
                <div style={{ fontSize: 11, color: "var(--pm-green)", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <RefreshCw size={11} /> Repeats {c.repeat_rule}{c.repeat_until ? ` until ${new Date(c.repeat_until).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 10 }}>{timeAgo(c.created_at)} ago</div>
              <div style={{ display: "flex", gap: 6 }}>
                {(c.status === "draft" || c.status === "scheduled" || c.status === "failed") && (
                  <button type="button" onClick={() => send(c)} disabled={busy === c.id} style={primaryBtn}>
                    <Send size={13} /> {busy === c.id ? "Sending…" : "Send now"}
                  </button>
                )}
                {c.status === "scheduled" && (
                  <button type="button" onClick={() => unschedule(c.id)} style={smallBtn}>Unschedule</button>
                )}
                {c.status === "sending" && (
                  <button type="button" onClick={() => send(c)} disabled={busy === c.id} style={smallBtn}>
                    <RefreshCw size={12} /> {busy === c.id ? "Working…" : "Resume"}
                  </button>
                )}
                {(c.sent_count > 0 || c.failed_count > 0 || c.status === "completed" || c.status === "sending" || c.status === "cancelled") && (
                  <button type="button" onClick={() => setRecipientsFor(c)} style={smallBtn}>
                    <UserIcon size={12} /> Recipients
                  </button>
                )}
                <button type="button" title="Delete campaign" onClick={() => remove(c.id)} style={{ ...smallBtn, color: "var(--pm-terra)" }}><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {creating && <CampaignModal onClose={() => { setCreating(false); load(); }} />}
      {createSeg && <CampaignModal initialSegment={createSeg} onClose={() => { setCreateSeg(null); load(); }} />}
      {csvOpen && <CsvImportModal onClose={() => setCsvOpen(false)} />}
      {recipientsFor && <RecipientsModal campaign={recipientsFor} onClose={() => setRecipientsFor(null)} />}
    </div>
  );
}

// RFM segment presets → rfm:* tags written on wa_contacts by recompute_wa_rfm_tags()
// (nightly via wa-rfm-tick). Multi-select unions the tags, e.g. Loyal + VIP = repeat buyers.
const SEGMENTS: { key: string; label: string; hint: string; tags: string[] }[] = [
  { key: "vip", label: "VIP", hint: "₹3k+ spent or 5+ orders", tags: ["rfm:vip"] },
  { key: "loyal", label: "Loyal", hint: "2–4 orders, last ≤90d", tags: ["rfm:loyal"] },
  { key: "first", label: "First-time", hint: "single order so far", tags: ["rfm:new", "rfm:one_time"] },
  { key: "at_risk", label: "At-risk", hint: "lapsing, last 3–6 months", tags: ["rfm:at_risk"] },
  { key: "dormant", label: "Dormant", hint: "silent 6+ months", tags: ["rfm:dormant"] },
  // Prospects: opted-in phones with no purchase history yet (₹0 spend). Targeted by source tag.
  { key: "crm_import", label: "CRM contacts", hint: "imported, no order yet", tags: ["crm_import"] },
  { key: "order_phone", label: "Order phones", hint: "phone from an order, no spend matched", tags: ["order_phone"] },
  { key: "lead", label: "Leads", hint: "B2B / scraped prospects", tags: ["lead"] },
];

// Meta's daily marketing-message tier for our number (docs/WA_CAMPAIGN_HANDOFF.md).
// Used only for the multi-day estimate shown to staff; the engine enforces the
// real cap at send time via resume_at.
const DAILY_TIER = 380;

function CampaignModal({ onClose, initialSegment }: { onClose: () => void; initialSegment?: string[] }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [audienceMode, setAudienceMode] = useState<"all" | "segment" | "tags">(initialSegment?.length ? "segment" : "all");
  const [segSel, setSegSel] = useState<string[]>(initialSegment ?? []);
  const [tags, setTags] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [personalize, setPersonalize] = useState(false);
  const [brief, setBrief] = useState("");
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [scheduleAt, setScheduleAt] = useState("");
  const [repeatRule, setRepeatRule] = useState<"" | "daily" | "weekly" | "monthly">("");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/templates?status=approved")
      .then((r) => r.json()).then((j) => setTemplates(j.templates ?? []));
  }, []);

  const tpl = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);
  const varNames = useMemo(() => {
    if (!tpl) return [];
    const m = tpl.body.match(/\{\{(\d+)\}\}/g) ?? [];
    return Array.from(new Set(m.map((s) => s.replace(/[{}]/g, ""))));
  }, [tpl]);

  // Resolve the active audience to a flat tag list. Segments are stored as
  // rfm:* tags on wa_contacts; "all" = no filter (every opted-in contact).
  const effectiveTags = useMemo(() => {
    if (audienceMode === "segment") {
      const out = new Set<string>();
      for (const key of segSel) {
        const seg = SEGMENTS.find((s) => s.key === key);
        for (const t of seg?.tags ?? []) out.add(t);
      }
      return Array.from(out);
    }
    if (audienceMode === "tags") return tags.split(",").map((t) => t.trim()).filter(Boolean);
    return [];
  }, [audienceMode, segSel, tags]);

  useEffect(() => {
    const qs = effectiveTags.length ? `?tags=${encodeURIComponent(effectiveTags.join(","))}` : "";
    fetch(`/api/whatsapp/audience${qs}`).then((r) => r.json()).then((j) => setAudienceCount(j.count ?? 0));
  }, [effectiveTags]);

  const preview = useMemo(() => {
    if (!tpl) return "";
    return tpl.body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[n] || `{{${n}}}`);
  }, [tpl, vars]);

  // Pre-flight: catch the two mistakes that fail EVERY recipient (missing
  // media header → #132012, empty {{n}} values → #132000) before Meta does.
  // See docs/META_WHATSAPP_TEMPLATE_RULES.md.
  const isMediaHeader = tpl?.header_type === "IMAGE" || tpl?.header_type === "VIDEO" || tpl?.header_type === "DOCUMENT";
  const missingVars = varNames.filter((n) => !(vars[n] ?? "").trim());
  const checks: { ok: boolean; text: string }[] = !tpl ? [] : [
    ...(isMediaHeader ? [{
      ok: !!tpl.header_media_url,
      text: tpl.header_media_url
        ? `${tpl.header_type!.toLowerCase()} header attached`
        : `This template has a ${tpl.header_type!.toLowerCase()} header but no media file saved — every send would fail (Meta #132012). Re-upload it in the Templates tab, or hit Sync from Meta.`,
    }] : []),
    ...(varNames.length ? [{
      ok: missingVars.length === 0 || personalize,
      text: missingVars.length === 0
        ? "All template variables filled"
        : personalize
          ? "Empty variables will be filled per contact by AI"
          : `Fill ${missingVars.map((n) => `{{${n}}}`).join(", ")} — empty values fail at Meta (#132000).`,
    }] : []),
  ];
  const blocked = checks.some((c) => !c.ok);

  // Send the exact campaign message to one phone (usually your own) first —
  // the single most reliable deliverability check we have.
  async function sendTest() {
    if (!tpl) return;
    const digits = testPhone.replace(/\D/g, "");
    if (digits.length < 10) { toast.push({ kind: "error", text: "Enter a full phone number for the test." }); return; }
    const to = digits.length === 10 ? "91" + digits : digits;
    setTesting(true);
    try {
      const template: Record<string, unknown> = { name: tpl.name, language: tpl.language || "en", vars };
      if (tpl.header_media_url) {
        if (tpl.header_type === "IMAGE") template.header_image = { link: tpl.header_media_url };
        else if (tpl.header_type === "VIDEO") template.header_video = { link: tpl.header_media_url };
        else if (tpl.header_type === "DOCUMENT") template.header_document = { link: tpl.header_media_url };
      }
      const r = await fetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, kind: "template", template, sent_by: "campaign-test" }),
      });
      const jr = await r.json().catch(() => ({}));
      if (jr.error || jr.ok === false) {
        toast.push({ kind: "error", text: "Test failed: " + (explainWaError(jr.error) ?? jr.error ?? "unknown") });
      } else {
        toast.push({ kind: "success", text: `Test sent to +${to} — check the phone (header, media, links) before the real send.` });
      }
    } finally { setTesting(false); }
  }

  async function create(action: "draft" | "send" | "schedule") {
    if (!name.trim()) { toast.push({ kind: "error", text: "Campaign name required" }); return; }
    if (!templateId) { toast.push({ kind: "error", text: "Pick an approved template" }); return; }
    if (blocked && action !== "draft") {
      toast.push({ kind: "error", text: "Fix the pre-flight warnings first — this send would fail for every recipient." });
      return;
    }
    let scheduledIso: string | null = null;
    if (action === "schedule") {
      const ms = scheduleAt ? new Date(scheduleAt).getTime() : NaN;
      if (!ms) { toast.push({ kind: "error", text: "Pick a date & time to schedule." }); return; }
      if (ms <= Date.now()) { toast.push({ kind: "error", text: "Schedule time must be in the future." }); return; }
      scheduledIso = new Date(scheduleAt).toISOString();
    }
    setSaving(true);
    try {
      const audience_filter = effectiveTags.length ? { tags: effectiveTags } : {};
      const template_vars = personalize && brief.trim()
        ? { ...vars, _ai_brief: brief.trim() }
        : vars;
      const r = await fetch("/api/whatsapp/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, template_id: templateId, template_vars, audience_filter, scheduled_at: scheduledIso,
          repeat_rule: repeatRule || null,
          repeat_until: repeatRule && repeatUntil ? new Date(repeatUntil).toISOString() : null,
        }),
      });
      const j = await r.json();
      if (j.error) { toast.push({ kind: "error", text: j.error }); return; }
      if (action === "schedule") {
        toast.push({
          kind: "success",
          text: `Scheduled "${name}" for ${new Date(scheduledIso!).toLocaleString("en-IN")} — ≈${audienceCount ?? "?"} recipient(s). Auto-sends once the template is approved.`,
        });
        onClose(); return;
      }
      if (action === "send" && j.campaign?.id) {
        if (!confirm(`Send "${name}" to ≈${audienceCount ?? "?"} contact(s) now? Meta bills per message.`)) {
          onClose(); return;
        }
        const sr = await fetch(`/api/whatsapp/campaigns/${j.campaign.id}/send`, { method: "POST" });
        const sj = await sr.json();
        if (sj.error) toast.push({ kind: "error", text: "Send failed: " + sj.error });
        else
          toast.push({
            kind: "success",
            text: `Done — ${sj.sent} sent, ${sj.failed} failed${sj.remaining ? `, ${sj.remaining} remaining` : ""}.`,
          });
      }
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="New marketing campaign">
      <Field label="Campaign name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Diwali offer 2026" />
      </Field>
      <Field label="Template — approved marketing templates only">
        <select aria-label="Campaign template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setVars({}); }} style={inputStyle}>
          <option value="">— pick a template —</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
        </select>
      </Field>
      {templates.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--pm-terra)", marginBottom: 10 }}>
          No approved templates yet. Create one in the Templates tab and get it approved by Meta first.
        </div>
      )}
      {varNames.length > 0 && (
        <Field label="Template variables — tip: type {name} to insert each contact's name">
          {varNames.map((n) => (
            <input key={n} placeholder={`{{${n}}}`} value={vars[n] ?? ""}
              onChange={(e) => setVars({ ...vars, [n]: e.target.value })}
              style={{ ...inputStyle, marginBottom: 6 }} />
          ))}
        </Field>
      )}
      {tpl && (
        <div style={{ marginBottom: 10 }}>
          <WhatsAppPreview headerType={tpl.header_type} headerMediaUrl={tpl.header_media_url}
            headerText={tpl.header_text} body={preview} footer={tpl.footer} buttons={tpl.buttons} />
        </div>
      )}
      {tpl && checks.length > 0 && (
        <div style={{ border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, marginBottom: 10, background: "var(--pm-app)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Pre-flight checks</div>
          {checks.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, marginBottom: 4, color: c.ok ? "var(--pm-green)" : "var(--pm-terra)" }}>
              {c.ok ? <Check size={13} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
              <span style={{ color: c.ok ? "var(--pm-muted)" : "var(--pm-terra)" }}>{c.text}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>
            Even after these pass, Meta may skip contacts who hit their personal marketing cap (#131049) — those retry automatically on later days.
          </div>
        </div>
      )}
      {tpl && (
        <Field label="Test send — try it on your own WhatsApp before the real blast">
          <div style={{ display: "flex", gap: 8 }}>
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+91 98…" inputMode="tel" aria-label="Test phone number"
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
            <button type="button" onClick={sendTest} disabled={testing} style={{ ...smallBtn, flexShrink: 0 }}>
              <Phone size={13} /> {testing ? "Sending…" : "Send test"}
            </button>
          </div>
        </Field>
      )}
      {tpl && (
        <Field label="AI personalization (optional)">
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={personalize} onChange={(e) => setPersonalize(e.target.checked)} />
            <Sparkles size={13} style={{ color: WA_GREEN }} /> Personalize each message with AI
          </label>
          {personalize && (
            <div style={{ marginTop: 8 }}>
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3}
                style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
                placeholder="Brief for the AI — e.g. 'Recommend a snack based on the customer's tags; mention our Diwali 15% offer; keep it short and warm.'" />
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
                OpenAI fills the template variables per contact from this brief + their profile. The values above are the fallback if AI fails. Sending is slower — one AI call per contact.
              </div>
            </div>
          )}
        </Field>
      )}
      <Field label="Audience">
        <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={audienceMode === "all"} onChange={() => setAudienceMode("all")} /> Everyone
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={audienceMode === "segment"} onChange={() => setAudienceMode("segment")} /> By segment
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={audienceMode === "tags"} onChange={() => setAudienceMode("tags")} /> By tags
          </label>
        </div>
        {audienceMode === "segment" && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SEGMENTS.map((s) => {
                const on = segSel.includes(s.key);
                return (
                  <button key={s.key} type="button" title={s.hint}
                    onClick={() => setSegSel((prev) => on ? prev.filter((k) => k !== s.key) : [...prev, s.key])}
                    style={{
                      fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
                      border: `1px solid ${on ? "var(--pm-green)" : "var(--pm-border)"}`,
                      background: on ? "var(--pm-green)" : "transparent",
                      color: on ? "#fff" : "var(--pm-ink)", fontWeight: on ? 600 : 400,
                    }}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>
              {segSel.length
                ? SEGMENTS.filter((s) => segSel.includes(s.key)).map((s) => `${s.label}: ${s.hint}`).join("  ·  ")
                : "Pick one or more segments. Refreshed nightly from Shopify order history."}
            </div>
          </div>
        )}
        {audienceMode === "tags" && (
          <input value={tags} onChange={(e) => setTags(e.target.value)} style={inputStyle}
            placeholder="vip, repeat_buyer (comma-separated)" />
        )}
      </Field>
      <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 12 }}>
        ≈ <strong>{audienceCount ?? "…"}</strong> opted-in recipient(s) will receive this.
        {audienceCount != null && audienceCount > DAILY_TIER &&
          ` That's above Meta's ~${DAILY_TIER}/day tier for our number — the campaign auto-spreads over ≈${Math.ceil(audienceCount / DAILY_TIER)} days, resuming each day.`}
      </div>
      <Field label="When to send">
        <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={sendMode === "now"} onChange={() => setSendMode("now")} /> Send now
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={sendMode === "schedule"} onChange={() => setSendMode("schedule")} />
            <Clock size={13} /> Schedule for later
          </label>
        </div>
        {sendMode === "schedule" && (
          <>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} style={inputStyle} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>Repeat</span>
              <select value={repeatRule} onChange={(e) => setRepeatRule(e.target.value as typeof repeatRule)} style={{ ...inputStyle, width: "auto", flex: "0 0 auto" }}>
                <option value="">One-time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              {repeatRule && (
                <>
                  <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>until</span>
                  <input type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} style={{ ...inputStyle, width: "auto", flex: "0 0 auto" }} />
                  <span style={{ fontSize: 11, color: "var(--pm-hint)" }}>(blank = forever)</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
              Your local time. Fires within ~15 min of this slot. If the template isn't Meta-approved yet, it waits and auto-sends once it is.
              {repeatRule && " Each occurrence is a fresh send, so opted-in contacts get it every cycle."}
            </div>
          </>
        )}
      </Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={smallBtn}>Cancel</button>
        <button type="button" onClick={() => create("draft")} disabled={saving} style={smallBtn}>Save draft</button>
        {sendMode === "schedule" ? (
          <button type="button" onClick={() => create("schedule")} disabled={saving || blocked}
            title={blocked ? "Fix the pre-flight warnings first" : undefined} style={primaryBtn}>
            <Clock size={13} /> {saving ? "Working…" : "Schedule"}
          </button>
        ) : (
          <button type="button" onClick={() => create("send")} disabled={saving || blocked}
            title={blocked ? "Fix the pre-flight warnings first" : undefined} style={primaryBtn}>
            <Send size={13} /> {saving ? "Working…" : "Save & send"}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- */
/* CSV CONTACT IMPORT                                                 */
/* ----------------------------------------------------------------- */

// Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes ("")
// and embedded commas/newlines inside quoted fields.
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { endField(); endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length > 0) { endField(); endRow(); }
  const all = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  const headers = all.shift() ?? [];
  return { headers, rows: all };
}

function CsvImportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [phoneCol, setPhoneCol] = useState(-1);
  const [nameCol, setNameCol] = useState(-1);
  const [emailCol, setEmailCol] = useState(-1);
  const [importing, setImporting] = useState(false);

  function onFile(f: File) {
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: h, rows: r } = parseCSV(String(reader.result ?? ""));
      setHeaders(h);
      setRows(r);
      const find = (kws: string[]) => h.findIndex((x) => kws.some((k) => x.toLowerCase().includes(k)));
      setPhoneCol(find(["phone", "mobile", "whatsapp", "number", "contact"]));
      setNameCol(find(["first name", "full name", "name"]));
      setEmailCol(find(["email", "e-mail", "mail"]));
    };
    reader.readAsText(f);
  }

  async function doImport() {
    if (phoneCol < 0) { toast.push({ kind: "error", text: "Pick the phone-number column." }); return; }
    setImporting(true);
    try {
      const payload = rows.map((r) => ({
        phone: r[phoneCol] ?? "",
        name: nameCol >= 0 ? (r[nameCol] ?? "") : "",
        email: emailCol >= 0 ? (r[emailCol] ?? "") : "",
      }));
      const res = await fetch("/api/whatsapp/import-csv", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, tag: "csv_import" }),
      });
      const j = await res.json();
      if (j.error) toast.push({ kind: "error", text: "Import failed: " + j.error });
      else
        toast.push({
          kind: "success",
          text: `Imported ${j.imported} new contact(s) · scanned ${j.scanned}, skipped ${j.skipped} (no valid phone / duplicate) · ${j.total_wa_contacts} WhatsApp contacts total.`,
        });
      onClose();
    } finally { setImporting(false); }
  }

  const colSelect = (value: number, set: (n: number) => void, label: string, optional: boolean) => (
    <select aria-label={label} value={value} onChange={(e) => set(Number(e.target.value))} style={inputStyle}>
      <option value={-1}>{optional ? "— none —" : "— select —"}</option>
      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </select>
  );

  return (
    <Modal onClose={onClose} title="Upload contacts from CSV">
      <input type="file" accept=".csv,text/csv" aria-label="CSV file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        style={{ marginBottom: 12, fontSize: 13 }} />
      {headers.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 10 }}>
            {fileName} — {rows.length} row(s), {headers.length} column(s). Map the columns:
          </div>
          <Field label="Phone column (required)">{colSelect(phoneCol, setPhoneCol, "Phone column", false)}</Field>
          <Field label="Name column (optional)">{colSelect(nameCol, setNameCol, "Name column", true)}</Field>
          <Field label="Email column (optional)">{colSelect(emailCol, setEmailCol, "Email column", true)}</Field>
          <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 12 }}>
            Phone numbers are normalised automatically (10-digit Indian numbers get +91). Imported contacts are tagged
            <strong> csv_import</strong> and marked opted-in — only upload customers who agreed to WhatsApp messages.
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={smallBtn}>Cancel</button>
        <button type="button" onClick={doImport} disabled={importing || headers.length === 0} style={primaryBtn}>
          <Upload size={14} /> {importing ? "Importing…" : "Import"}
        </button>
      </div>
    </Modal>
  );
}
