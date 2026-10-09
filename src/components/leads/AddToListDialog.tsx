"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import Dialog from "./Dialog";
import { api, errText, plural, useB2bRefresh } from "./api";
import { listName, useLists } from "./ListsView";

// "Add to list": put the ticked businesses into another list, or a new one.
export default function AddToListDialog({ leadIds, currentListId, onClose }: { leadIds: string[]; currentListId: string | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const lists = (useLists().data ?? []).filter((l) => l.id !== currentListId);
  const [target, setTarget] = useState<string>("__new");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      if (target === "__new") {
        await api("/api/leads/lists", { body: { name: name.trim(), lead_ids: leadIds } });
      } else {
        await api(`/api/leads/lists/${target}/members`, { body: { lead_ids: leadIds } });
      }
      toast.push({ kind: "success", text: `Added ${plural(leadIds.length, "business", "businesses")}.` });
      refresh();
      onClose();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Add ${plural(leadIds.length, "business", "businesses")} to a list`} onClose={onClose}>
      <p>They stay in this list too. A business is never emailed twice, whichever lists it is in.</p>
      <div className={s.field}>
        <label htmlFor="atl-target">List</label>
        <select id="atl-target" className={s.sel} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="__new">A new list…</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{listName(l.name)}</option>)}
        </select>
      </div>
      {target === "__new" ? (
        <div className={s.field}>
          <label htmlFor="atl-name">Name of the new list</label>
          <input id="atl-name" className={s.in} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Best gifting leads" />
        </div>
      ) : null}
      <div className={s.dlgF}>
        <button type="button" className="pm-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pm-btn primary" onClick={add} disabled={busy || (target === "__new" && !name.trim())}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </Dialog>
  );
}
