"use client";

// Kits tab: what goes in each creator box (Shopify variants + qty), and the
// rules that suggest a kit when a collab is added.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog, EmptyState, Panel, StatusBadge } from "@/components/pm";
import type { Kit, KitItem, KitRule } from "@/lib/influencers/types";
import { api, errText, QK } from "./api";
import { Field, Switch, useKitRules, useKits } from "./ui";
import s from "../influencers.module.css";

type KitDraft = Omit<Kit, "id"> & { id?: string };

const BLANK_KIT: KitDraft = { name: "", description: null, items: [], cogs: null, active: true };

function useCrud(base: string, key: readonly string[]) {
  const qc = useQueryClient();
  return useMutation({
    // POST to the list route; PATCH / DELETE to the /[id] route.
    mutationFn: (a: { method: "POST" | "PATCH" | "DELETE"; id?: string; body?: Record<string, unknown> }) =>
      api<Record<string, unknown>>(a.id ? `${base}/${encodeURIComponent(a.id)}` : base, {
        method: a.method,
        body: a.method === "DELETE" ? undefined : a.body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: QK.deals });
    },
  });
}

export function KitsTab() {
  const kits = useKits();
  const [editing, setEditing] = useState<KitDraft | null>(null);

  return (
    <>
      <Panel
        title="Kits"
        icon={<Package size={16} />}
        caption="A kit is the box a creator gets. Items are Shopify variant IDs with a quantity, so the Shopify order is built from them."
        more={
          !editing && (
            <button type="button" className="pm-btn primary sm" onClick={() => setEditing({ ...BLANK_KIT, items: [] })}>
              <Plus size={13} /> New kit
            </button>
          )
        }
      >
        {editing && !editing.id && <KitEditor initial={editing} onDone={() => setEditing(null)} />}
        {kits.isLoading ? (
          <p className={s.hint}>Loading kits…</p>
        ) : kits.error ? (
          <p className={s.err}>{errText(kits.error)}</p>
        ) : (kits.data ?? []).length === 0 && !editing ? (
          <EmptyState icon={<Package />} title="No kits yet" style={{ marginTop: 10 }}>
            Create your first kit, for example a Starter box with 4 packs.
          </EmptyState>
        ) : (
          <div style={{ marginTop: 10 }}>
            {(kits.data ?? []).map((k) =>
              editing?.id === k.id ? (
                <KitEditor key={k.id} initial={editing} onDone={() => setEditing(null)} />
              ) : (
                <div key={k.id} className={s.draftItem}>
                  <div className={s.row}>
                    <strong style={{ fontSize: 13.5 }}>{k.name}</strong>
                    <StatusBadge tone={k.active ? "green" : "gray"}>{k.active ? "In use" : "Hidden"}</StatusBadge>
                    {k.cogs != null && <span className={s.hint}>Cost ₹{k.cogs}</span>}
                    <span className={s.spacer} />
                    <button type="button" className="pm-btn ghost sm" onClick={() => setEditing({ ...k, items: [...k.items] })}>
                      Edit
                    </button>
                  </div>
                  {k.description && <p className={s.muted} style={{ margin: "4px 0 0" }}>{k.description}</p>}
                  <p className={s.hint} style={{ margin: "4px 0 0" }}>
                    {k.items.length ? k.items.map((i) => `${i.qty} × ${i.title}`).join(", ") : "No items"}
                  </p>
                </div>
              ),
            )}
          </div>
        )}
      </Panel>

      <div style={{ height: 16 }} />
      <RulesPanel kits={kits.data ?? []} />
    </>
  );
}

function KitEditor({ initial, onDone }: { initial: KitDraft; onDone: () => void }) {
  const crud = useCrud("/api/influencers/kits", QK.kits);
  const [k, setK] = useState<KitDraft>(initial);
  const [confirmDel, setConfirmDel] = useState(false);
  const setItem = (i: number, patch: Partial<KitItem>) =>
    setK({ ...k, items: k.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const valid = k.name.trim() && k.items.every((i) => i.variant_id.trim() && i.qty > 0);

  const save = () => {
    const body = {
      name: k.name.trim(),
      description: k.description?.trim() || null,
      items: k.items.map((i) => ({ variant_id: i.variant_id.trim(), title: i.title.trim(), qty: i.qty })),
      cogs: k.cogs,
      active: k.active,
    };
    crud.mutate(k.id ? { method: "PATCH", id: k.id, body } : { method: "POST", body }, { onSuccess: onDone });
  };

  return (
    <div className={s.section} style={{ marginTop: 10 }}>
      <div className={s.form}>
        <div className={s.grid2}>
          <Field label="Kit name *">
            <input className={s.input} value={k.name} onChange={(e) => setK({ ...k, name: e.target.value })} placeholder="Starter box" />
          </Field>
          <Field label="Cost to us (₹)" hint="Optional. Used for collab cost reports.">
            <input
              className={s.input}
              inputMode="decimal"
              value={k.cogs ?? ""}
              onChange={(e) => setK({ ...k, cogs: e.target.value.trim() === "" ? null : Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Description">
          <input className={s.input} value={k.description ?? ""} onChange={(e) => setK({ ...k, description: e.target.value })} />
        </Field>
        <div>
          <div className={s.label} style={{ marginBottom: 6 }}>Items</div>
          <div className={s.listEdit}>
            {k.items.map((it, i) => (
              <div key={i} className={s.listEditRow}>
                <input
                  className={s.input}
                  style={{ flex: "0 0 170px" }}
                  placeholder="Shopify variant ID"
                  value={it.variant_id}
                  onChange={(e) => setItem(i, { variant_id: e.target.value })}
                />
                <input className={s.input} placeholder="Product name" value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} />
                <input
                  className={s.input}
                  style={{ flex: "0 0 64px" }}
                  inputMode="numeric"
                  aria-label="Quantity"
                  value={it.qty}
                  onChange={(e) => setItem(i, { qty: Math.max(0, Number(e.target.value) || 0) })}
                />
                <button
                  type="button"
                  className="pm-btn ghost sm"
                  aria-label="Remove item"
                  onClick={() => setK({ ...k, items: k.items.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="pm-btn ghost sm"
                onClick={() => setK({ ...k, items: [...k.items, { variant_id: "", title: "", qty: 1 }] })}
              >
                + Add item
              </button>
            </div>
          </div>
        </div>
        <div className={s.row}>
          <Switch on={k.active} onChange={(v) => setK({ ...k, active: v })} label="Kit in use" />
          <span className={s.muted}>{k.active ? "In use: shows in Add collab" : "Hidden from Add collab"}</span>
        </div>
        <div className={s.actions}>
          <button type="button" className="pm-btn primary sm" disabled={!valid || crud.isPending} onClick={save}>
            {crud.isPending ? "Saving…" : "Save kit"}
          </button>
          <button type="button" className="pm-btn ghost sm" onClick={onDone}>
            Cancel
          </button>
          {k.id && (
            <button type="button" className="pm-btn ghost sm" style={{ color: "var(--pm-terra)", marginLeft: "auto" }} onClick={() => setConfirmDel(true)}>
              Delete kit
            </button>
          )}
          {crud.error && <span className={s.err}>{errText(crud.error)}</span>}
        </div>
      </div>
      {confirmDel && k.id && (
        <ConfirmDialog
          title={`Delete ${k.name}?`}
          body="If any collab already uses this kit, it is switched off instead of deleted, so those collabs keep it."
          confirmLabel="Delete kit"
          danger
          busy={crud.isPending}
          onClose={() => setConfirmDel(false)}
          onConfirm={() =>
            crud.mutate({ method: "DELETE", id: k.id }, { onSuccess: onDone, onSettled: () => setConfirmDel(false) })
          }
        />
      )}
    </div>
  );
}

type RuleDraft = { id?: string; priority: string; min_followers: string; max_followers: string; niche: string; kit_id: string };

const toDraft = (r?: KitRule): RuleDraft => ({
  id: r?.id,
  priority: r ? String(r.priority) : "10",
  min_followers: r?.min_followers != null ? String(r.min_followers) : "",
  max_followers: r?.max_followers != null ? String(r.max_followers) : "",
  niche: r?.niche ?? "",
  kit_id: r?.kit_id ?? "",
});

function RulesPanel({ kits }: { kits: Kit[] }) {
  const rules = useKitRules();
  const crud = useCrud("/api/influencers/kit-rules", QK.rules);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const kitName = (id: string) => kits.find((k) => k.id === id)?.name ?? "Unknown kit";
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
  const sorted = [...(rules.data ?? [])].sort((a, b) => a.priority - b.priority);

  const save = () => {
    if (!draft) return;
    const body = {
      priority: Number(draft.priority) || 0,
      min_followers: n(draft.min_followers),
      max_followers: n(draft.max_followers),
      niche: draft.niche.trim() || null,
      kit_id: draft.kit_id,
    };
    crud.mutate(draft.id ? { method: "PATCH", id: draft.id, body } : { method: "POST", body }, {
      onSuccess: () => setDraft(null),
    });
  };

  const editorRow = draft && (
    <tr>
      <td>
        <input className={s.input} style={{ width: 64 }} inputMode="numeric" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} aria-label="Priority" />
      </td>
      <td>
        <input className={s.input} inputMode="numeric" placeholder="Any" value={draft.min_followers} onChange={(e) => setDraft({ ...draft, min_followers: e.target.value })} aria-label="Min followers" />
      </td>
      <td>
        <input className={s.input} inputMode="numeric" placeholder="Any" value={draft.max_followers} onChange={(e) => setDraft({ ...draft, max_followers: e.target.value })} aria-label="Max followers" />
      </td>
      <td>
        <input className={s.input} placeholder="Any" value={draft.niche} onChange={(e) => setDraft({ ...draft, niche: e.target.value })} aria-label="Niche" />
      </td>
      <td>
        <select className={s.input} value={draft.kit_id} onChange={(e) => setDraft({ ...draft, kit_id: e.target.value })} aria-label="Kit">
          <option value="">Pick a kit</option>
          {kits.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button type="button" className="pm-btn primary sm" disabled={!draft.kit_id || crud.isPending} onClick={save}>
          Save
        </button>{" "}
        <button type="button" className="pm-btn ghost sm" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </td>
    </tr>
  );

  return (
    <Panel
      title="Kit rules"
      caption="When you add a collab, the first matching rule (lowest priority number) suggests the kit. Leave a field empty to match anything."
      more={
        !draft && (
          <button type="button" className="pm-btn sm" disabled={kits.length === 0} onClick={() => setDraft(toDraft())}>
            <Plus size={13} /> New rule
          </button>
        )
      }
    >
      {rules.error ? (
        <p className={s.err}>{errText(rules.error)}</p>
      ) : (
        <div className="pm-tablewrap" style={{ marginTop: 10 }}>
          <table className="pm-tbl">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Min followers</th>
                <th>Max followers</th>
                <th>Niche</th>
                <th>Kit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) =>
                draft?.id === r.id ? null : (
                  <tr key={r.id}>
                    <td>{r.priority}</td>
                    <td>{r.min_followers?.toLocaleString("en-IN") ?? "Any"}</td>
                    <td>{r.max_followers?.toLocaleString("en-IN") ?? "Any"}</td>
                    <td>{r.niche ?? "Any"}</td>
                    <td>{kitName(r.kit_id)}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button type="button" className="pm-btn ghost sm" disabled={!!draft} onClick={() => setDraft(toDraft(r))}>
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        className="pm-btn ghost sm"
                        aria-label="Delete rule"
                        disabled={crud.isPending}
                        onClick={() => crud.mutate({ method: "DELETE", id: r.id })}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ),
              )}
              {editorRow}
              {sorted.length === 0 && !draft && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--pm-hint)", padding: "24px 16px" }}>
                    {rules.isLoading ? "Loading…" : "No rules yet. Without rules you pick the kit by hand."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {crud.error && <p className={s.err}>{errText(crud.error)}</p>}
    </Panel>
  );
}
