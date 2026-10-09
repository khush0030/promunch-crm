"use client";

// Step 6, Replies: who wrote back (and who was emailed / bounced). A reply
// stops any follow-ups. "Make it a deal" creates a deal (POST /api/deals) and
// links to it.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Handshake } from "lucide-react";
import { Tag } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import { api, errText, nf, shortDate } from "./api";
import StageTag from "./StageTag";
import type { Lead } from "./types";

type View = "replied" | "contacted" | "bounced";
const VIEWS: { key: View; label: string }[] = [
  { key: "replied", label: "Replied" },
  { key: "contacted", label: "Sent, no reply yet" },
  { key: "bounced", label: "Bounced" },
];

type DealLite = { id: string; company_domain?: string | null; contact_email?: string | null; source_ref?: string | null };

export function latestReply(l: Lead) {
  return [...(l.outreach_replies ?? [])].sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at))[0] ?? null;
}

export function useDealsLite() {
  return useQuery({
    queryKey: ["deals"],
    queryFn: () => api<{ deals: DealLite[] }>("/api/deals"),
    staleTime: 60_000,
  });
}

export function useDealFor() {
  const deals = useDealsLite().data?.deals;
  return useMemo(() => {
    const byRef = new Map<string, DealLite>();
    const byDomain = new Map<string, DealLite>();
    const byEmail = new Map<string, DealLite>();
    for (const d of deals ?? []) {
      if (d.source_ref) byRef.set(d.source_ref, d);
      if (d.company_domain) byDomain.set(d.company_domain.toLowerCase(), d);
      if (d.contact_email) byEmail.set(d.contact_email.toLowerCase(), d);
    }
    return (l: Lead): DealLite | null =>
      byRef.get(l.id) ||
      (l.domain && byDomain.get(l.domain.toLowerCase())) ||
      (l.lead_contacts ?? []).map((c) => byEmail.get(c.email.toLowerCase())).find(Boolean) ||
      null;
  }, [deals]);
}

/** POST /api/deals with the Deals contract; returns the new deal id. */
export async function makeDeal(l: Lead): Promise<string | null> {
  const reply = latestReply(l);
  const contact = (l.lead_contacts ?? []).find((c) => reply?.from_email && c.email.toLowerCase() === reply.from_email.toLowerCase())
    ?? (l.lead_contacts ?? []).find((c) => c.is_primary) ?? null;
  const r = await api<{ deal?: { id: string } }>("/api/deals", {
    body: {
      company: l.name,
      contact_name: reply?.from_name || contact?.person_name || null,
      contact_email: reply?.from_email || contact?.email || null,
      contact_phone: null,
      kind: "wholesale",
      stage: "talking",
      notes: (reply?.body_text || reply?.subject || "").replace(/\s+/g, " ").trim().slice(0, 1000) || null,
      source: "b2b_reply",
      source_ref: l.id,
    },
  });
  return r.deal?.id ?? null;
}

export default function RepliesView({
  initialView, counts, inFollowUps, onOpenLead,
}: {
  initialView?: View | null;
  counts: Record<string, number>;
  inFollowUps: number;
  onOpenLead: (lead: Lead) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<View>(initialView ?? "replied");
  const [making, setMaking] = useState<string | null>(null);
  const [made, setMade] = useState<Record<string, string | null>>({});
  const dealFor = useDealFor();
  const q = useQuery({
    queryKey: ["b2b", "replies", view],
    queryFn: async () => (await api<{ leads: Lead[] }>(`/api/leads?status=${view}&limit=100&order=recent`)).leads,
  });
  const rows = q.data ?? [];

  async function deal(l: Lead) {
    setMaking(l.id);
    try {
      const id = await makeDeal(l);
      setMade((m) => ({ ...m, [l.id]: id }));
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast.push({ kind: "success", text: `${l.name} is now a deal.` });
    } catch (e) {
      toast.push({ kind: "error", text: errText(e, "Could not make the deal") });
    } finally {
      setMaking(null);
    }
  }

  return (
    <div className={s.body}>
      <div className={s.chips} role="tablist" aria-label="Show">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={s.chip} data-on={view === v.key} onClick={() => setView(v.key)}>
            {v.label} <em>{nf(counts[v.key])}</em>
          </button>
        ))}
        {inFollowUps ? <Tag tone="teal" dot>{nf(inFollowUps)} with follow-ups planned</Tag> : null}
      </div>

      <section className={`${s.card} ${s.cardFlush}`}>
        {q.isLoading ? (
          <p className={s.muted} style={{ padding: "22px 0" }}>Loading…</p>
        ) : q.error ? (
          <p className={s.errNote} style={{ padding: "22px 0" }}>Could not load: {(q.error as Error).message}</p>
        ) : rows.length === 0 ? (
          <div className={s.empty}>
            <b>{view === "replied" ? "No replies yet" : view === "bounced" ? "No bounces" : "Nobody waiting on a reply"}</b>
            <p>
              {view === "replied"
                ? "When a business writes back, it shows up here and its follow-ups stop."
                : view === "bounced"
                  ? "Addresses that bounce are blocked, so they are never emailed again."
                  : "Approved emails show up here once they are sent."}
            </p>
          </div>
        ) : (
          rows.map((l) => {
            const reply = latestReply(l);
            const sentAt = (l.outreach_drafts ?? []).map((d) => d.sent_at).filter(Boolean).sort().pop() ?? null;
            const quote = reply?.body_text?.replace(/\s+/g, " ").trim();
            const existing = dealFor(l);
            const dealId = made[l.id] !== undefined ? made[l.id] : existing?.id ?? null;
            const hasDeal = made[l.id] !== undefined || !!existing;
            return (
              <div key={l.id} className={s.tplRow}>
                <div>
                  <button type="button" className={s.bizName} onClick={() => onOpenLead(l)}>{l.name}</button>
                  {view === "replied" && (quote || reply?.subject) ? (
                    <p className={s.quote} style={{ margin: "8px 0", whiteSpace: "normal" }}>{(quote || reply?.subject || "").slice(0, 260)}</p>
                  ) : null}
                  <span>
                    {[l.category, l.city].filter(Boolean).join(" · ")}
                    {sentAt ? ` · emailed ${shortDate(sentAt)}` : ""}
                    {reply ? ` · replied ${shortDate(reply.received_at)}` : ""}
                  </span>
                </div>
                <div style={{ flex: "none", alignItems: "flex-end", gap: 10 }}>
                  <StageTag status={l.status} />
                  {view === "replied" ? (
                    hasDeal ? (
                      <Link className={s.txtLink} href={dealId ? `/dashboard/deals?deal=${dealId}` : "/dashboard/deals"}>Open deal <ArrowRight /></Link>
                    ) : (
                      <button type="button" className="pm-btn primary" onClick={() => deal(l)} disabled={making !== null}>
                        <Handshake /> {making === l.id ? "Making…" : "Make it a deal"}
                      </button>
                    )
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
