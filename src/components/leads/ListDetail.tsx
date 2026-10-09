"use client";

// Steps 2 and 3 (one list): every business with ONE plain status and ONE
// button for what to do next with it. Ready -> Write email, Waiting ->
// Approve, No email -> Add email (opens the business). Tick several, or
// "Write emails for all ready", to write in one go.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, MailSearch, Plus, Sparkles, X } from "lucide-react";
import { ConfirmDialog } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { FINDABLE_STATUSES, STAGES, STAGE_ORDER, stageOf, type Stage } from "@/lib/leads/lead-status";
import s from "./b2b.module.css";
import { api, errText, nf, plural, useB2bRefresh } from "./api";
import StageTag from "./StageTag";
import SearchProgressCard from "./SearchProgressCard";
import WriteDialog from "./WriteDialog";
import FindEmailsDialog from "./FindEmailsDialog";
import AddToListDialog from "./AddToListDialog";
import type { ListLead, OutreachSettings, SearchProgress } from "./types";

const PAGE = 100;

export function useList(listId: string | null) {
  return useQuery({
    queryKey: ["b2b", "list", listId],
    enabled: !!listId,
    queryFn: () => api<{ list: { id: string; name: string; source_search_id: string | null }; leads: ListLead[] }>(`/api/leads/lists/${listId}`),
    refetchInterval: 20_000,
  });
}

function emailOf(l: ListLead): string | null {
  const cs = l.lead_contacts ?? [];
  return (cs.find((c) => c.is_primary && c.verify_status === "mx_ok") ?? cs.find((c) => c.verify_status === "mx_ok"))?.email ?? null;
}

export default function ListDetail({
  listId, searches, settings, isAdmin, initialStage, onOpenLead, onApprove, onDeleted,
}: {
  listId: string;
  searches: SearchProgress[];
  settings: OutreachSettings | null;
  isAdmin: boolean;
  initialStage?: Stage | null;
  onOpenLead: (lead: ListLead) => void;
  onApprove: (batchId: string | null) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const q = useList(listId);
  const [stage, setStage] = useState<Stage | "all">(initialStage ?? "all");
  const [text, setText] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | "write" | "find" | "add" | "delete">(null);
  const [writeIds, setWriteIds] = useState<string[]>([]);
  const [findIds, setFindIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const leads = useMemo(() => q.data?.leads ?? [], [q.data]);
  const counts = useMemo(() => {
    const c: Partial<Record<Stage, number>> = {};
    for (const l of leads) {
      const st = stageOf(l.status);
      c[st] = (c[st] ?? 0) + 1;
    }
    return c;
  }, [leads]);
  const needle = text.trim().toLowerCase();
  const shown = leads.filter(
    (l) =>
      (stage === "all" || stageOf(l.status) === stage) &&
      (!needle || l.name.toLowerCase().includes(needle) || (l.domain ?? "").includes(needle) || (emailOf(l) ?? "").includes(needle)),
  );
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const selected = [...sel].map((id) => byId.get(id)).filter((l): l is ListLead => !!l);
  const selReady = selected.filter((l) => l.status === "ready").map((l) => l.id);
  const selFindable = selected.filter((l) => (FINDABLE_STATUSES as string[]).includes(l.status)).map((l) => l.id);
  const readyIds = leads.filter((l) => l.status === "ready").map((l) => l.id);
  const search = searches.find((x) => x.list_id === listId && x.active);
  const waitingN = counts.waiting ?? 0;
  const noEmailN = counts.no_email ?? 0;
  const writeFor = (ids: string[]) => { setWriteIds(ids); setDialog("write"); };

  const toggle = (id: string) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function deleteList() {
    setDeleting(true);
    try {
      await api(`/api/leads/lists/${listId}`, { method: "DELETE" });
      toast.push({ kind: "success", text: "List deleted. The businesses and their history are kept." });
      refresh();
      onDeleted();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setDeleting(false);
    }
  }

  if (q.isLoading) return <div className={s.body}><p className={s.muted}>Loading businesses…</p></div>;
  if (q.error) return <div className={s.body}><p className={s.errNote}>Could not load this list: {(q.error as Error).message}</p></div>;

  return (
    <div className={s.body}>
      {search ? (
        <section className={`${s.card} ${s.cardFlush}`}><SearchProgressCard search={search} /></section>
      ) : null}

      <section className={s.card}>
        <div className={s.listGuide}>
          {readyIds.length ? (
            <>
              <p><b>{plural(readyIds.length, "business is", "businesses are")} ready to email.</b> Tick the ones you want (or write for all of them). The AI writes one email each, then you approve.</p>
              <button type="button" className="pm-btn primary" disabled={!!settings?.paused} onClick={() => writeFor(readyIds)}>
                <Sparkles /> Write emails for all {nf(readyIds.length)} ready
              </button>
            </>
          ) : waitingN ? (
            <>
              <p><b>{plural(waitingN, "email waits", "emails wait")} for your approval.</b> Read each one, approve it or skip it.</p>
              <button type="button" className="pm-btn primary" onClick={() => onApprove(null)}><Check /> Approve emails <ArrowRight /></button>
            </>
          ) : noEmailN ? (
            <p><b>No one here is ready yet.</b> Open a business marked No email and add an address you found, or use Find more emails. It turns Ready once it has one.</p>
          ) : (
            <p><b>Everyone in this list has been handled.</b> Find more businesses for a new list.</p>
          )}
        </div>
      </section>

      <div className={s.chips} role="tablist" aria-label="Show">
        <button type="button" role="tab" aria-selected={stage === "all"} className={s.chip} data-on={stage === "all"} onClick={() => setStage("all")}>
          Everyone <em>{nf(leads.length)}</em>
        </button>
        {STAGE_ORDER.filter((st) => (counts[st] ?? 0) > 0).map((st) => (
          <button key={st} type="button" role="tab" aria-selected={stage === st} className={s.chip} data-on={stage === st} onClick={() => setStage(st)}>
            {STAGES[st].label} <em>{nf(counts[st])}</em>
          </button>
        ))}
      </div>

      <section className={`${s.card} ${s.cardFlush}`}>
        <div className={s.toolbar} style={{ padding: "18px 0 10px" }}>
          <input className={s.search} placeholder="Search by name, website or email" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search businesses" />
          <span className={s.sp} />
          {readyIds.length ? (
            <button type="button" className="pm-btn" onClick={() => setSel(new Set(readyIds))}>
              Select all ready ({nf(readyIds.length)})
            </button>
          ) : null}
        </div>

        {shown.length === 0 ? (
          <div className={s.empty}>
            <b>{leads.length ? "Nobody matches" : search ? "Businesses will appear here as they are found" : "This list is empty"}</b>
            <p>{leads.length ? "Try another filter or search." : "Find businesses, or add some from another list."}</p>
          </div>
        ) : (
          <>
            <div className={`${s.biz} ${s.bizHead}`} aria-hidden>
              <span />
              <span>Business</span>
              <span>Email</span>
              <span>Status</span>
              <span />
            </div>
            {shown.slice(0, limit).map((l) => {
              const email = emailOf(l);
              const findable = (FINDABLE_STATUSES as string[]).includes(l.status);
              return (
                <div key={l.id} className={s.biz}>
                  <input type="checkbox" className={s.check} checked={sel.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} />
                  <div className={s.bizM}>
                    <button type="button" className={s.bizName} onClick={() => onOpenLead(l)}>{l.name}</button>
                    <span>
                      {[l.city, l.domain].filter(Boolean).join(" · ")}
                      {l.fit_score != null ? ` · fit ${l.fit_score}/100` : ""}
                    </span>
                  </div>
                  <span className={s.bizEmail}>{email ?? <span className={s.muted}>No email found</span>}</span>
                  <StageTag status={l.status} />
                  <span className={s.bizAct}>
                    {l.status === "ready" ? (
                      <button type="button" className="pm-btn primary" disabled={!!settings?.paused} onClick={() => writeFor([l.id])}>
                        <Sparkles /> Write email
                      </button>
                    ) : l.status === "drafted" ? (
                      <button type="button" className="pm-btn" onClick={() => onApprove(null)}>
                        <Check /> Approve
                      </button>
                    ) : findable ? (
                      <button type="button" className="pm-btn" onClick={() => onOpenLead(l)}>
                        <Plus /> Add email
                      </button>
                    ) : (
                      <button type="button" className="pm-btn ghost" onClick={() => onOpenLead(l)}>Open</button>
                    )}
                  </span>
                </div>
              );
            })}
            {shown.length > limit ? (
              <div className={s.more}>
                <button type="button" className="pm-btn" onClick={() => setLimit((x) => x + PAGE)}>Show {nf(Math.min(PAGE, shown.length - limit))} more</button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <div className={s.row}>
        <span className={s.sp} />
        <button type="button" className={s.txtLink} style={{ color: "var(--tag-red-ink)" }} onClick={() => setDialog("delete")}>Delete this list</button>
      </div>

      {sel.size > 0 ? (
        <div className={s.actbar} role="region" aria-label="Selection">
          <div className={s.abM}>
            <b>{plural(sel.size, "business", "businesses")} selected</b>
            <span>{nf(selReady.length)} ready to write · {nf(selFindable.length)} without an email</span>
          </div>
          <button type="button" className="pm-btn primary" disabled={!selReady.length || !!settings?.paused} onClick={() => writeFor(selReady)} title={settings?.paused ? "Sending is paused in Settings" : undefined}>
            <Sparkles /> Write emails for {nf(selReady.length)}
          </button>
          {selFindable.length ? (
            <button type="button" className="pm-btn" onClick={() => { setFindIds(selFindable); setDialog("find"); }}>
              <MailSearch /> Find more emails ({nf(selFindable.length)})
            </button>
          ) : null}
          <button type="button" className="pm-btn" onClick={() => setDialog("add")}>Add to list</button>
          <button type="button" className="pm-btn" onClick={() => setSel(new Set())} aria-label="Clear selection"><X /></button>
        </div>
      ) : null}

      {dialog === "write" ? (
        <WriteDialog
          leadIds={writeIds}
          listId={listId}
          settings={settings}
          onClose={() => setDialog(null)}
          onDone={(batchId) => { setDialog(null); setSel(new Set()); onApprove(batchId); }}
        />
      ) : null}
      {dialog === "find" ? (
        <FindEmailsDialog leadIds={findIds} isAdmin={isAdmin} onClose={() => { setDialog(null); setSel(new Set()); q.refetch(); }} />
      ) : null}
      {dialog === "add" ? <AddToListDialog leadIds={[...sel]} currentListId={listId} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title="Delete this list?"
          body={search ? "Its search is still finding businesses; deleting the list stops it. The businesses already found and their email history are kept." : "The businesses and their email history are kept; only the list goes."}
          confirmLabel="Delete list"
          danger
          busy={deleting}
          onConfirm={deleteList}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
