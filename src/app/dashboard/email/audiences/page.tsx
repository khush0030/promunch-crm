"use client";

// Saved audiences (segments). Build with plain filters, see the live count,
// save for reuse on any campaign.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Callout, ConfirmDialog, PageHeader, Table } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { SegmentEditor, AudienceCount } from "@/components/email-studio/SegmentEditor";
import { useSegments, type SegmentsDto } from "@/components/email-studio/hooks";
import { sendJson, when } from "@/components/email-studio/api";
import { parseRules, type AudienceRules } from "@/lib/email-studio/segments";
import { QuickSegments, useSegmentCounts } from "@/components/customers/QuickSegments";
import s from "@/components/email-studio/studio.module.css";

type Saved = SegmentsDto["saved"][number];

export default function AudiencesPage() {
  const q = useSegments();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string | null; name: string; rules: AudienceRules } | null>(null);
  const [del, setDel] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useSegmentCounts();

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await sendJson(`/api/email-studio/segments/${editing.id}`, "PATCH", { name: editing.name, rules: editing.rules });
      else await sendJson("/api/email-studio/segments", "POST", { name: editing.name, rules: editing.rules });
      qc.invalidateQueries({ queryKey: ["email-studio-segments"] });
      toast.push({ kind: "success", text: `Saved "${editing.name}".` });
      setEditing(null);
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        crumb="Customers"
        title="Segments"
        summary={
          <>
            Saved groups of people to email. Each one only counts people with an email address who said yes
            {q.data ? <>: <b>{(q.data.saved ?? []).length} saved</b>, plus {(q.data.presets ?? []).length} quick ones</> : null}. Phone-only buyers get WhatsApp instead.
          </>
        }
        actions={
          <button type="button" className={`pm2-btn${editing ? "" : " pri"}`} onClick={() => setEditing({ id: null, name: "", rules: { conditions: [{ field: "total_orders", op: "gte", value: 1 }] } })}>
            <Plus size={14} /> New segment
          </button>
        }
      />
      <div className="pm2-body">
        {q.data?.savedError && <Callout tone="plain" title="Saved segments unavailable" body={q.data.savedError} />}

        {editing && (
          <div className="pm2-g21">
            <div className="pm2-panel" style={{ padding: 16, display: "grid", gap: 14 }}>
              <label className={s.field}>
                <span>Segment name</span>
                <input className={s.input} autoFocus placeholder="e.g. Diwali 2025 buyers" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              <SegmentEditor rules={editing.rules} onChange={(rules) => setEditing({ ...editing, rules })} />
              <div className={s.row}>
                <button type="button" className="pm2-btn pri" disabled={busy || !editing.name.trim()} onClick={save}>{busy ? "Saving…" : "Save segment"}</button>
                <button type="button" className="pm2-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
            <AudienceCount rules={editing.rules} />
          </div>
        )}

        <div className="pm2-panel">
          <Table<Saved>
            cols={[
              { h: "Segment", render: (r) => <b>{r.name}</b> },
              { h: "Who", render: (r) => <span className={s.hint}>{r.summary}</span> },
              { h: "People", num: true, render: (r) => (live.data?.saved[r.id] ?? r.last_count ?? "–").toLocaleString("en-IN") },
              { h: "Counted", render: (r) => (live.data?.saved[r.id] != null ? "Just now" : when(r.counted_at)) },
              {
                h: "",
                render: (r) => (
                  <span className={s.row} style={{ justifyContent: "flex-end" }}>
                    <button type="button" className={s.iconBtn} aria-label="Edit" onClick={() => setEditing({ id: r.id, name: r.name, rules: parseRules(r.rules) })}><Pencil /></button>
                    <button type="button" className={s.iconBtn} aria-label="Delete" onClick={() => setDel(r)}><Trash2 /></button>
                  </span>
                ),
              },
            ]}
            rows={q.data?.saved ?? []}
            rowKey={(r) => r.id}
            empty={<span className={s.hint}>No saved segments yet. The quick segments (Customers, VIPs, Lapsed, Engaged…) are always available when you build a campaign.</span>}
          />
        </div>

        <QuickSegments presets={q.data?.presets ?? []} />
      </div>
      {del && (
        <ConfirmDialog
          title={`Delete "${del.name}"?`}
          body="Campaigns that already went out are not affected."
          confirmLabel="Delete"
          danger
          busy={busy}
          onClose={() => setDel(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await sendJson(`/api/email-studio/segments/${del.id}`, "DELETE");
              qc.invalidateQueries({ queryKey: ["email-studio-segments"] });
              setDel(null);
            } catch (e) {
              toast.push({ kind: "error", text: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
