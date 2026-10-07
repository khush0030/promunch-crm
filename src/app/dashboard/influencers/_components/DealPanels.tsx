"use client";

// The four working panels inside the deal drawer: Brief, Shipping, Drafts,
// Post. Each one calls its own endpoint and refreshes the deal afterwards.

import { useState } from "react";
import { ExternalLink, FileText, Film, Package, Send, Sparkles, Upload } from "lucide-react";
import { ConfirmDialog, StatusBadge, type BadgeTone } from "@/components/pm";
import type { Brief, BriefContent, DealDetail, DraftSubmission } from "@/lib/influencers/types";
import { errText } from "./api";
import {
  Field,
  ListEditor,
  Section,
  dateTime,
  relDay,
  shortDate,
  toDateInput,
  useDealAction,
  useKits,
  useSettings,
} from "./ui";
import s from "../influencers.module.css";

// ── Brief ───────────────────────────────────────────────────────────────────

const BRIEF_TONE: Record<Brief["status"], BadgeTone> = {
  draft: "gold",
  approved: "blue",
  sent: "green",
  superseded: "gray",
};
const BRIEF_LABEL: Record<Brief["status"], string> = {
  draft: "Draft",
  approved: "Approved",
  sent: "Sent",
  superseded: "Replaced",
};

const EMPTY_CONTENT: BriefContent = {
  concept: "",
  hooks: [],
  script: "",
  talking_points: [],
  must_say: [],
  checklist: [],
  donts: [],
  format: { length_sec: null, aspect: null, stories: null },
  dates: { draft_due: null, go_live: null },
  usage_rights_text: null,
};

function normalize(c: Partial<BriefContent> | null | undefined): BriefContent {
  return {
    ...EMPTY_CONTENT,
    ...(c ?? {}),
    format: { ...EMPTY_CONTENT.format, ...(c?.format ?? {}) },
    dates: { ...EMPTY_CONTENT.dates, ...(c?.dates ?? {}) },
    hooks: c?.hooks ?? [],
    talking_points: c?.talking_points ?? [],
    must_say: c?.must_say ?? [],
    checklist: c?.checklist ?? [],
    donts: c?.donts ?? [],
  };
}

export function BriefPanel({ detail }: { detail: DealDetail }) {
  const { deal } = detail;
  const act = useDealAction(deal.id);
  const settings = useSettings();
  const briefs = [...detail.briefs].sort((a, b) => b.version - a.version);
  const [selId, setSelId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "err"; text: string; copyLink?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const portal = typeof window !== "undefined" ? `${window.location.origin}/c/${deal.code}` : `/c/${deal.code}`;
  const copyPortal = async () => {
    try {
      await navigator.clipboard.writeText(portal);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", portal);
    }
  };
  const sel = briefs.find((b) => b.id === selId) ?? briefs[0] ?? null;
  const base = `/api/influencers/deals/${deal.id}/brief`;
  const engineOn = settings.data?.engine_enabled ?? false;
  const closed = deal.stage === "cancelled" || deal.stage === "ghosted" || deal.stage === "completed";

  return (
    <Section
      title="Brief"
      icon={<FileText size={14} />}
      right={
        !closed && (
          <button
            type="button"
            className="pm-btn sm"
            disabled={act.isPending}
            onClick={() =>
              act.mutate(
                { url: `${base}/generate` },
                {
                  onSuccess: (d) => {
                    const b = d?.brief as Brief | undefined;
                    setSelId(b?.id ?? null);
                    setEditing(false);
                    setNotice({ tone: "ok", text: `New brief v${b?.version ?? ""} written. Read it, edit if needed, then approve.` });
                  },
                },
              )
            }
          >
            <Sparkles size={13} /> {act.isPending && act.variables?.url.endsWith("/generate") ? "Writing…" : briefs.length ? "Write a new version with AI" : "Generate with AI"}
          </button>
        )
      }
    >
      {act.error && <p className={s.err}>{errText(act.error)}</p>}
      {notice && (
        <div
          className={notice.tone === "warn" ? s.warn : undefined}
          role="status"
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 10px" }}
        >
          <span className={notice.tone === "ok" ? s.ok : notice.tone === "err" ? s.err : undefined} style={{ flex: 1, minWidth: 200 }}>
            {notice.text}
          </span>
          {notice.copyLink && (
            <button type="button" className="pm-btn sm" onClick={copyPortal}>
              {copied ? "Copied" : "Copy portal link"}
            </button>
          )}
          <button type="button" className="pm-btn ghost sm" onClick={() => setNotice(null)} aria-label="Dismiss">
            OK
          </button>
        </div>
      )}
      {!sel ? (
        <p className={s.hint} style={{ margin: 0 }}>
          No brief yet. Generate one with AI (it uses product facts from the PROMUNCH knowledge base), then edit, approve and send it.
        </p>
      ) : (
        <>
          <div className={s.row}>
            {briefs.length > 1 &&
              briefs.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`${s.chip} ${b.id === sel.id ? s.chipOn : ""}`}
                  onClick={() => {
                    setSelId(b.id);
                    setEditing(false);
                  }}
                >
                  v{b.version}
                </button>
              ))}
            <StatusBadge tone={BRIEF_TONE[sel.status]}>
              {briefs.length <= 1 ? `v${sel.version} · ` : ""}
              {BRIEF_LABEL[sel.status]}
            </StatusBadge>
            {sel.sent_at && <span className={s.hint}>Sent {dateTime(sel.sent_at)}</span>}
            {sel.sent_at &&
              (sel.acknowledged_at ? (
                <StatusBadge tone="green">Accepted {dateTime(sel.acknowledged_at)}</StatusBadge>
              ) : (
                <StatusBadge tone="gold">Not accepted yet</StatusBadge>
              ))}
          </div>

          {editing && sel.status === "draft" ? (
            <BriefEditor
              key={sel.id}
              initial={normalize(sel.content)}
              busy={act.isPending}
              onCancel={() => setEditing(false)}
              onSave={(content) =>
                act.mutate(
                  { url: `${base}/${sel.id}`, method: "PATCH", body: { content } },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
          ) : (
            <BriefView content={normalize(sel.content)} />
          )}

          {!editing && !closed && (
            <div className={s.actions} style={{ marginTop: 12 }}>
              {sel.status === "draft" && (
                <>
                  <button type="button" className="pm-btn ghost sm" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="pm-btn primary sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ url: `${base}/${sel.id}/approve` })}
                  >
                    Approve
                  </button>
                </>
              )}
              {(sel.status === "draft" || sel.status === "approved") && (
                <button
                  type="button"
                  className={`pm-btn sm ${sel.status === "approved" ? "primary" : ""}`}
                  disabled={sel.status !== "approved" || act.isPending}
                  title={sel.status !== "approved" ? "Approve the brief first" : undefined}
                  onClick={() => setConfirmSend(true)}
                >
                  <Send size={13} /> Send to creator
                </button>
              )}
              {sel.status === "draft" && <span className={s.hint}>Approve before sending.</span>}
            </div>
          )}
        </>
      )}

      {confirmSend && sel && (
        <ConfirmDialog
          title="Send this brief to the creator?"
          body={
            engineOn
              ? "The creator gets a WhatsApp message from the PROMUNCH number with a button to open their brief. This is a real message."
              : "Automatic messages are off in Settings, so no WhatsApp goes out. The brief is marked as sent and shows on the creator's portal page. Copy the portal link and share it yourself."
          }
          confirmLabel={engineOn ? "Send on WhatsApp" : "Mark as sent"}
          busy={act.isPending}
          onClose={() => setConfirmSend(false)}
          onConfirm={() =>
            act.mutate(
              { url: `${base}/${sel.id}/send` },
              {
                onSuccess: (d) => {
                  const wa = d?.whatsapp as string | undefined;
                  if (wa === "sent") setNotice({ tone: "ok", text: "Brief sent. The creator got a WhatsApp with a button to open it." });
                  else if (wa === "engine_off")
                    setNotice({
                      tone: "warn",
                      text: "Brief published on the portal, but no WhatsApp went out because automatic messages are off. Copy the link and share it yourself.",
                      copyLink: true,
                    });
                  else if (wa === "already_sent")
                    setNotice({ tone: "ok", text: "This brief was already sent. Nothing was sent again." });
                  else if (wa === "failed")
                    setNotice({
                      tone: "err",
                      text: `Brief published on the portal, but the WhatsApp failed${d?.whatsapp_error ? ` (${String(d.whatsapp_error)})` : ""}. Copy the link and share it yourself.`,
                      copyLink: true,
                    });
                  else setNotice({ tone: "ok", text: "Brief sent." });
                },
                onSettled: () => setConfirmSend(false),
              },
            )
          }
        />
      )}
    </Section>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={s.briefBlock}>
      <div className={s.flab}>{title}</div>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function BriefView({ content: c }: { content: BriefContent }) {
  const fmt = [
    c.format.length_sec ? `${c.format.length_sec} sec` : null,
    c.format.aspect,
    c.format.stories ? `${c.format.stories} stories` : null,
  ].filter(Boolean);
  return (
    <div>
      {c.concept && (
        <div className={s.briefBlock}>
          <div className={s.flab}>Concept</div>
          <p>{c.concept}</p>
        </div>
      )}
      <Bullets title="Hooks" items={c.hooks} />
      {c.script && (
        <div className={s.briefBlock}>
          <div className={s.flab}>Script</div>
          <p>{c.script}</p>
        </div>
      )}
      <Bullets title="Talking points" items={c.talking_points} />
      <Bullets title="Must say" items={c.must_say} />
      <Bullets title="Checklist" items={c.checklist} />
      <Bullets title="Please avoid" items={c.donts} />
      {(fmt.length > 0 || c.dates.draft_due || c.dates.go_live || c.usage_rights_text) && (
        <dl className={s.kv} style={{ marginTop: 10 }}>
          {fmt.length > 0 && (
            <>
              <dt>Format</dt>
              <dd>{fmt.join(" · ")}</dd>
            </>
          )}
          {c.dates.draft_due && (
            <>
              <dt>Draft due</dt>
              <dd>{c.dates.draft_due}</dd>
            </>
          )}
          {c.dates.go_live && (
            <>
              <dt>Go live</dt>
              <dd>{c.dates.go_live}</dd>
            </>
          )}
          {c.usage_rights_text && (
            <>
              <dt>Usage rights</dt>
              <dd>{c.usage_rights_text}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function BriefEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: BriefContent;
  busy: boolean;
  onSave: (c: BriefContent) => void;
  onCancel: () => void;
}) {
  const [c, setC] = useState<BriefContent>(initial);
  const set = <K extends keyof BriefContent>(k: K, v: BriefContent[K]) => setC((p) => ({ ...p, [k]: v }));
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div className={s.form} style={{ marginTop: 12 }}>
      <Field label="Concept">
        <textarea className={s.textarea} value={c.concept} onChange={(e) => set("concept", e.target.value)} />
      </Field>
      <Field label="Hooks (first 3 seconds)">
        <ListEditor items={c.hooks} onChange={(v) => set("hooks", v)} />
      </Field>
      <Field label="Script">
        <textarea className={s.textarea} rows={6} value={c.script} onChange={(e) => set("script", e.target.value)} />
      </Field>
      <Field label="Talking points">
        <ListEditor items={c.talking_points} onChange={(v) => set("talking_points", v)} />
      </Field>
      <Field label="Must say">
        <ListEditor items={c.must_say} onChange={(v) => set("must_say", v)} />
      </Field>
      <Field label="Checklist">
        <ListEditor items={c.checklist} onChange={(v) => set("checklist", v)} />
      </Field>
      <Field label="Please avoid">
        <ListEditor items={c.donts} onChange={(v) => set("donts", v)} />
      </Field>
      <div className={s.grid3}>
        <Field label="Length (seconds)">
          <input
            className={s.input}
            inputMode="numeric"
            value={c.format.length_sec ?? ""}
            onChange={(e) => set("format", { ...c.format, length_sec: n(e.target.value) })}
          />
        </Field>
        <Field label="Aspect">
          <input
            className={s.input}
            placeholder="9:16"
            value={c.format.aspect ?? ""}
            onChange={(e) => set("format", { ...c.format, aspect: e.target.value || null })}
          />
        </Field>
        <Field label="Stories">
          <input
            className={s.input}
            inputMode="numeric"
            value={c.format.stories ?? ""}
            onChange={(e) => set("format", { ...c.format, stories: n(e.target.value) })}
          />
        </Field>
      </div>
      <div className={s.grid2}>
        <Field label="Draft due (as shown to creator)">
          <input
            className={s.input}
            value={c.dates.draft_due ?? ""}
            placeholder="10 days after the box arrives"
            onChange={(e) => set("dates", { ...c.dates, draft_due: e.target.value || null })}
          />
        </Field>
        <Field label="Go live (as shown to creator)">
          <input
            className={s.input}
            value={c.dates.go_live ?? ""}
            onChange={(e) => set("dates", { ...c.dates, go_live: e.target.value || null })}
          />
        </Field>
      </div>
      <Field label="Usage rights text">
        <input
          className={s.input}
          value={c.usage_rights_text ?? ""}
          onChange={(e) => set("usage_rights_text", e.target.value || null)}
        />
      </Field>
      <div className={s.actions}>
        <button type="button" className="pm-btn primary sm" disabled={busy} onClick={() => onSave(c)}>
          {busy ? "Saving…" : "Save brief"}
        </button>
        <button type="button" className="pm-btn ghost sm" onClick={onCancel}>
          Discard changes
        </button>
      </div>
    </div>
  );
}

// ── Shipping ────────────────────────────────────────────────────────────────

export function ShippingPanel({ detail }: { detail: DealDetail }) {
  const { deal, address } = detail;
  const act = useDealAction(deal.id);
  const kits = useKits();
  const kit = (kits.data ?? []).find((k) => k.id === deal.kit_id) ?? null;
  const [editAddr, setEditAddr] = useState(false);
  const [confirmOrder, setConfirmOrder] = useState(false);
  const [confirmDelivered, setConfirmDelivered] = useState(false);
  const closed = deal.stage === "cancelled" || deal.stage === "ghosted" || deal.stage === "completed";

  const addrLine = address
    ? [address.name, address.line1, address.line2, address.city, address.state, address.pincode]
        .filter(Boolean)
        .join(", ")
    : "";
  const addrOk = !!(address?.line1 && address?.pincode);

  return (
    <Section title="Shipping" icon={<Package size={14} />}>
      {act.error && <p className={s.err}>{errText(act.error)}</p>}
      <dl className={s.kv}>
        <dt>Kit</dt>
        <dd>
          {deal.kit?.name ?? <span className={s.hint}>No kit picked</span>}
          {kit && kit.items.length > 0 && (
            <div className={s.hint}>{kit.items.map((i) => `${i.qty} × ${i.title}`).join(", ")}</div>
          )}
          {!deal.shopify_order_id && !closed && (kits.data?.length ?? 0) > 0 && (
            <select
              className={s.select}
              style={{ marginTop: 6 }}
              aria-label="Change kit"
              value={deal.kit_id ?? ""}
              disabled={act.isPending}
              onChange={(e) =>
                act.mutate({
                  url: `/api/influencers/deals/${deal.id}`,
                  method: "PATCH",
                  body: { kit_id: e.target.value || null },
                })
              }
            >
              <option value="">No kit</option>
              {(kits.data ?? [])
                .filter((k) => k.active || k.id === deal.kit_id)
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
            </select>
          )}
        </dd>
        <dt>Address</dt>
        <dd>
          {editAddr ? null : addrLine || <span className={s.hint}>No address yet</span>}
          {address?.phone && !editAddr && <div className={s.hint}>Phone {address.phone}</div>}
          {!editAddr && !deal.shopify_order_id && (
            <div>
              <button type="button" className="pm-btn ghost sm" style={{ marginTop: 4 }} onClick={() => setEditAddr(true)}>
                {address ? "Edit address" : "Add address"}
              </button>
            </div>
          )}
        </dd>
        {deal.shopify_order_id && (
          <>
            <dt>Shopify order</dt>
            <dd>
              {deal.shopify_order_name ?? deal.shopify_order_id}
              {deal.order_status_url && (
                <>
                  {" "}
                  <a href={deal.order_status_url} target="_blank" rel="noreferrer">
                    Track order <ExternalLink size={11} style={{ verticalAlign: -1 }} />
                  </a>
                </>
              )}
              {deal.dispatched_at && <div className={s.hint}>Created {dateTime(deal.dispatched_at)}</div>}
            </dd>
          </>
        )}
        {deal.delivered_at && (
          <>
            <dt>Arrived</dt>
            <dd>{dateTime(deal.delivered_at)}</dd>
          </>
        )}
        {deal.draft_due_at && (
          <>
            <dt>Draft due</dt>
            <dd>
              {shortDate(deal.draft_due_at)} ({relDay(deal.draft_due_at)})
            </dd>
          </>
        )}
      </dl>

      {editAddr && (
        <AddressForm
          initial={address}
          busy={act.isPending}
          onCancel={() => setEditAddr(false)}
          onSave={(a) =>
            act.mutate(
              { url: `/api/influencers/${deal.influencer_id}/address`, method: "PUT", body: a },
              { onSuccess: () => setEditAddr(false) },
            )
          }
        />
      )}

      {!closed && (
        <div className={s.actions} style={{ marginTop: 12 }}>
          <button
            type="button"
            className="pm-btn primary sm"
            disabled={!!deal.shopify_order_id || !deal.kit_id || !addrOk || act.isPending}
            title={
              deal.shopify_order_id
                ? "Order already created"
                : !deal.kit_id
                  ? "Pick a kit first"
                  : !addrOk
                    ? "Add the address first"
                    : undefined
            }
            onClick={() => setConfirmOrder(true)}
          >
            {deal.shopify_order_id ? "Order created" : "Create Shopify order"}
          </button>
          {deal.stage === "dispatched" && (
            <button type="button" className="pm-btn sm" disabled={act.isPending} onClick={() => setConfirmDelivered(true)}>
              Mark delivered
            </button>
          )}
          {!deal.shopify_order_id && (!deal.kit_id || !addrOk) && (
            <span className={s.hint}>Needs a kit and an address with pincode.</span>
          )}
        </div>
      )}

      {confirmOrder && (
        <ConfirmDialog
          title="Create the Shopify order?"
          body={
            <>
              This creates a free (₹0) order in Shopify tagged Influencer for {deal.kit?.name ?? "this kit"}, shipping to{" "}
              {addrLine}. The warehouse will pack and ship it like any other order. You can only do this once per collab.
            </>
          }
          confirmLabel="Create order"
          busy={act.isPending}
          onClose={() => setConfirmOrder(false)}
          onConfirm={() =>
            act.mutate(
              { url: `/api/influencers/deals/${deal.id}/dispatch` },
              { onSettled: () => setConfirmOrder(false) },
            )
          }
        />
      )}
      {confirmDelivered && (
        <ConfirmDialog
          title="Mark the box as delivered?"
          body={`Usually the creator confirms this on their portal page. Marking it here starts the draft clock: the draft becomes due in ${deal.draft_due_days} days.`}
          confirmLabel="Mark delivered"
          busy={act.isPending}
          onClose={() => setConfirmDelivered(false)}
          onConfirm={() =>
            act.mutate(
              { url: `/api/influencers/deals/${deal.id}`, method: "PATCH", body: { stage: "delivered" } },
              { onSettled: () => setConfirmDelivered(false) },
            )
          }
        />
      )}
    </Section>
  );
}

function AddressForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: DealDetail["address"];
  busy: boolean;
  onSave: (a: Record<string, string | null>) => void;
  onCancel: () => void;
}) {
  const [a, setA] = useState({
    name: initial?.name ?? "",
    line1: initial?.line1 ?? "",
    line2: initial?.line2 ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    pincode: initial?.pincode ?? "",
    phone: initial?.phone ?? "",
  });
  const f = (k: keyof typeof a, label: string, wide = false) => (
    <div style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <Field label={label}>
        <input className={s.input} value={a[k]} onChange={(e) => setA({ ...a, [k]: e.target.value })} />
      </Field>
    </div>
  );
  return (
    <div className={s.form} style={{ marginTop: 12 }}>
      <div className={s.grid2}>
        {f("name", "Name")}
        {f("phone", "Phone")}
        {f("line1", "Address line 1", true)}
        {f("line2", "Address line 2", true)}
        {f("city", "City")}
        {f("state", "State")}
        {f("pincode", "Pincode")}
      </div>
      <div className={s.actions}>
        <button
          type="button"
          className="pm-btn primary sm"
          disabled={busy}
          onClick={() =>
            onSave(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.trim() || null])))
          }
        >
          {busy ? "Saving…" : "Save address"}
        </button>
        <button type="button" className="pm-btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Drafts ──────────────────────────────────────────────────────────────────

const REVIEW_TONE: Record<DraftSubmission["review_status"], BadgeTone> = {
  pending: "gold",
  approved: "green",
  changes_requested: "terra",
};
const REVIEW_LABEL: Record<DraftSubmission["review_status"], string> = {
  pending: "Waiting for review",
  approved: "Approved",
  changes_requested: "Changes asked",
};

export function DraftsPanel({ detail }: { detail: DealDetail }) {
  const { deal } = detail;
  const drafts = [...detail.drafts].sort((a, b) => b.version - a.version);
  return (
    <Section
      title="Drafts"
      icon={<Film size={14} />}
      right={deal.revision_count > 0 ? <span className={s.hint}>{deal.revision_count} revision{deal.revision_count === 1 ? "" : "s"}</span> : null}
    >
      {drafts.length === 0 ? (
        <p className={s.hint} style={{ margin: 0 }}>
          No draft yet. The creator submits it from their portal page
          {deal.draft_due_at ? `, due ${shortDate(deal.draft_due_at)} (${relDay(deal.draft_due_at)})` : ""}.
        </p>
      ) : (
        drafts.map((d) => <DraftItem key={d.id} dealId={deal.id} draft={d} />)
      )}
    </Section>
  );
}

function DraftItem({ dealId, draft: d }: { dealId: string; draft: DraftSubmission }) {
  const act = useDealAction(dealId);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const review = (decision: "approved" | "changes_requested", n: string | null) =>
    act.mutate({
      url: `/api/influencers/deals/${dealId}/drafts/${d.id}/review`,
      body: { decision, note: n },
    });

  return (
    <div className={s.draftItem}>
      <div className={s.row}>
        <strong style={{ fontSize: 13 }}>Version {d.version}</strong>
        <StatusBadge tone={REVIEW_TONE[d.review_status]}>{REVIEW_LABEL[d.review_status]}</StatusBadge>
        <span className={s.hint}>Submitted {dateTime(d.submitted_at)}</span>
      </div>
      {d.url && (
        <p style={{ margin: "6px 0 0", fontSize: 12.5 }}>
          <a href={d.url} target="_blank" rel="noreferrer">
            Open draft link <ExternalLink size={11} style={{ verticalAlign: -1 }} />
          </a>
        </p>
      )}
      {d.signed_url ? (
        <video className={s.video} src={d.signed_url} controls preload="metadata" />
      ) : d.storage_path ? (
        <p className={s.hint} style={{ margin: "6px 0 0" }}>
          <Upload size={11} style={{ verticalAlign: -1 }} /> Uploaded video (preview link expired, reopen the drawer).
        </p>
      ) : null}
      {d.note && (
        <p className={s.muted} style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
          Creator note: {d.note}
        </p>
      )}
      {d.review_note && (
        <p className={s.muted} style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
          Our feedback{d.reviewed_at ? ` (${shortDate(d.reviewed_at)})` : ""}: {d.review_note}
        </p>
      )}

      {d.review_status === "pending" && !asking && (
        <div className={s.actions} style={{ marginTop: 8 }}>
          <button type="button" className="pm-btn primary sm" disabled={act.isPending} onClick={() => setConfirmApprove(true)}>
            Approve
          </button>
          <button type="button" className="pm-btn sm" disabled={act.isPending} onClick={() => setAsking(true)}>
            Request changes
          </button>
        </div>
      )}
      {asking && (
        <div className={s.form} style={{ marginTop: 8 }}>
          <Field label="What should the creator change? *" hint="The creator sees this note on their portal page.">
            <textarea className={s.textarea} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className={s.actions}>
            <button
              type="button"
              className="pm-btn primary sm"
              disabled={!note.trim() || act.isPending}
              onClick={() => review("changes_requested", note.trim())}
            >
              {act.isPending ? "Sending…" : "Send feedback"}
            </button>
            <button type="button" className="pm-btn ghost sm" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {act.error && <p className={s.err}>{errText(act.error)}</p>}
      {confirmApprove && (
        <ConfirmDialog
          title="Approve this draft?"
          body="The creator is told the draft is approved and can post it on the go-live date."
          confirmLabel="Approve draft"
          busy={act.isPending}
          onClose={() => setConfirmApprove(false)}
          onConfirm={() =>
            act.mutate(
              { url: `/api/influencers/deals/${dealId}/drafts/${d.id}/review`, body: { decision: "approved", note: null } },
              { onSettled: () => setConfirmApprove(false) },
            )
          }
        />
      )}
    </div>
  );
}

// ── Post ────────────────────────────────────────────────────────────────────

export function PostPanel({ detail }: { detail: DealDetail }) {
  const { deal } = detail;
  const act = useDealAction(deal.id);
  const [goLive, setGoLive] = useState(toDateInput(deal.go_live_at));
  const [postUrl, setPostUrl] = useState(deal.post_url ?? "");
  const [v24, setV24] = useState(deal.views_24h != null ? String(deal.views_24h) : "");
  const [v7, setV7] = useState(deal.views_7d != null ? String(deal.views_7d) : "");
  const [saved, setSaved] = useState(false);
  const closed = deal.stage === "cancelled" || deal.stage === "ghosted";
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

  const patch = (extra: Record<string, unknown> = {}) =>
    act.mutate(
      {
        url: `/api/influencers/deals/${deal.id}`,
        method: "PATCH",
        body: {
          go_live_at: goLive ? new Date(`${goLive}T12:00:00`).toISOString() : null,
          post_url: postUrl.trim() || null,
          views_24h: n(v24),
          views_7d: n(v7),
          ...extra,
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 1800);
        },
      },
    );

  return (
    <Section title="Post" icon={<ExternalLink size={14} />}>
      <div className={s.grid2}>
        <Field label="Go-live date">
          <input type="date" className={s.input} value={goLive} disabled={closed} onChange={(e) => setGoLive(e.target.value)} />
        </Field>
        <Field label="Post link">
          <input
            className={s.input}
            value={postUrl}
            disabled={closed}
            placeholder="https://www.instagram.com/reel/…"
            onChange={(e) => setPostUrl(e.target.value)}
          />
        </Field>
        <Field label="Views after 24 hours">
          <input className={s.input} inputMode="numeric" value={v24} disabled={closed} onChange={(e) => setV24(e.target.value)} />
        </Field>
        <Field label="Views after 7 days">
          <input className={s.input} inputMode="numeric" value={v7} disabled={closed} onChange={(e) => setV7(e.target.value)} />
        </Field>
      </div>
      {deal.post_url && (
        <p style={{ margin: "8px 0 0", fontSize: 12.5 }}>
          <a href={deal.post_url} target="_blank" rel="noreferrer">
            Open the live post <ExternalLink size={11} style={{ verticalAlign: -1 }} />
          </a>
          {deal.posted_at && <span className={s.hint}> · posted {dateTime(deal.posted_at)}</span>}
        </p>
      )}
      {!closed && (
        <div className={s.actions} style={{ marginTop: 10 }}>
          <button type="button" className="pm-btn sm" disabled={act.isPending} onClick={() => patch()}>
            {act.isPending ? "Saving…" : "Save"}
          </button>
          {deal.stage === "draft_approved" && (
            <button
              type="button"
              className="pm-btn primary sm"
              disabled={!postUrl.trim() || act.isPending}
              title={!postUrl.trim() ? "Paste the post link first" : undefined}
              onClick={() => patch({ stage: "posted" })}
            >
              Mark as posted
            </button>
          )}
          {deal.stage === "posted" && (
            <button type="button" className="pm-btn primary sm" disabled={act.isPending} onClick={() => patch({ stage: "completed" })}>
              Mark collab complete
            </button>
          )}
          {saved && <span className={s.ok}>Saved</span>}
          {act.error && <span className={s.err}>{errText(act.error)}</span>}
        </div>
      )}
    </Section>
  );
}
