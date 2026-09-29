"use client";

// Who this campaign went to and what happened to each message, with a status
// filter and a CSV download (built in the browser).

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Card, Chips, Pill, Table } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { Recipient } from "../../types";
import { classifyWaError } from "../../waErrors";
import { errorMessage, useRecipients } from "../api";
import { fmtInt, fmtIst, toCsv } from "../logic";
import s from "../campaigns.module.css";

const PAGE_SIZE = 50;

// "+91 98765 43210" style, so a nameless row is still recognisable.
export function prettyPhone(waId: string | null | undefined): string {
  const d = String(waId ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

export function recipientName(r: Pick<Recipient, "name" | "wa_id">): string {
  const n = (r.name ?? "").trim();
  if (n) return n;
  const p = prettyPhone(r.wa_id);
  return p ? `${p} (no name)` : "No name";
}

type Kind = "all" | "read" | "delivered" | "sent" | "held" | "failed";

function kindOf(r: Recipient): Exclude<Kind, "all"> {
  if (r.status === "read") return "read";
  if (r.status === "delivered") return "delivered";
  if (r.status === "sent" || r.status === "queued") return "sent";
  return classifyWaError(r.error).key === "cap" ? "held" : "failed";
}

const LABEL: Record<Exclude<Kind, "all">, { text: string; tone: "good" | "info" | "neu" | "warn" | "crit" }> = {
  read: { text: "Read", tone: "good" },
  delivered: { text: "Delivered", tone: "info" },
  sent: { text: "Sent", tone: "neu" },
  held: { text: "Held back by Meta", tone: "warn" },
  failed: { text: "Didn't arrive", tone: "crit" },
};

export function RecipientsCard({ id, name, live }: { id: string; name: string; live: boolean }) {
  const q = useRecipients(id, live);
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => (q.data?.recipients ?? []).map((r) => ({ ...r, kind: kindOf(r) })), [q.data]);
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { all: rows.length, read: 0, delivered: 0, sent: 0, held: 0, failed: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);
  const needle = search.trim().toLowerCase();
  const needleDigits = needle.replace(/\D/g, "");
  const shown = rows.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (!needle || (r.name ?? "").toLowerCase().includes(needle) || (needleDigits.length >= 3 && (r.wa_id ?? "").includes(needleDigits))),
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const pageRows = shown.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE);

  function download() {
    const csv = toCsv(
      ["Name", "WhatsApp number", "Result", "Reason", "Attempts", "Last update (IST)"],
      shown.map((r) => [
        r.name ?? "",
        r.wa_id ? `+${r.wa_id}` : "",
        LABEL[r.kind].text,
        r.kind === "failed" || r.kind === "held" ? classifyWaError(r.error).title : "",
        r.attempts,
        fmtIst(r.at),
      ]),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign"}-recipients-${kind}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const cols: TableCol<(typeof rows)[number]>[] = [
    { h: "Name", render: (r) => recipientName(r) },
    { h: "Number", render: (r) => prettyPhone(r.wa_id) || "–" },
    {
      h: "Result",
      render: (r) => (
        <>
          <Pill tone={LABEL[r.kind].tone}>{LABEL[r.kind].text}</Pill>
          {r.duplicate && <Pill tone="crit" tip="This person got the message more than once.">Twice</Pill>}
        </>
      ),
    },
    { h: "Why", render: (r) => (r.kind === "failed" || r.kind === "held" ? classifyWaError(r.error).title : "") },
    { h: "When", render: (r) => fmtIst(r.at) },
  ];

  return (
    <Card
      title="Recipients"
      basis={q.data ? `${fmtInt(q.data.summary.contacts)} people` : undefined}
      right={
        <button type="button" className="pm2-btn sm" onClick={download} disabled={!shown.length}>
          <Download size={14} aria-hidden /> Download CSV
        </button>
      }
    >
      {q.isError ? (
        <div className="pm2-empty">{errorMessage(q.error)}</div>
      ) : q.isLoading ? (
        <div className="pm2-empty">Loading recipients…</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div className={s.recTools}>
            <div className={s.searchBox}>
              <Search aria-hidden />
              <input
                className={s.input}
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search name or number"
                aria-label="Search recipients"
              />
            </div>
          </div>
          <Chips
            ariaLabel="Filter recipients"
            value={kind}
            onChange={(k) => {
              setKind(k as Kind);
              setPage(0);
            }}
            items={(["all", "read", "delivered", "sent", "held", "failed"] as Kind[]).map((k) => ({
              key: k,
              label: k === "all" ? "Everyone" : LABEL[k].text,
              count: counts[k],
            }))}
          />
          <Table
            cols={cols}
            rows={pageRows}
            rowKey={(r) => r.contact_id}
            card={(r) => ({ title: recipientName(r), value: LABEL[r.kind].text, meta: fmtIst(r.at) })}
            empty={rows.length ? (needle ? "Nobody matches that search." : "Nobody in this group.") : "Nobody has been messaged yet."}
          />
          {shown.length > PAGE_SIZE && (
            <div className={s.pager}>
              <span>
                Showing {fmtInt(cur * PAGE_SIZE + 1)} to {fmtInt(Math.min(shown.length, (cur + 1) * PAGE_SIZE))} of {fmtInt(shown.length)}
              </span>
              <span className={s.pagerBtns}>
                <button type="button" className="pm2-btn sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
                  <ChevronLeft size={14} aria-hidden /> Previous
                </button>
                <button type="button" className="pm2-btn sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
                  Next <ChevronRight size={14} aria-hidden />
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
