"use client";

// Who this campaign went to and what happened to each message, with a status
// filter and a CSV download (built in the browser).

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Card, Chips, Pill, Table } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { Recipient } from "../../types";
import { classifyWaError } from "../../waErrors";
import { errorMessage, useRecipients } from "../api";
import { fmtInt, fmtIst, toCsv } from "../logic";

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
  const rows = useMemo(() => (q.data?.recipients ?? []).map((r) => ({ ...r, kind: kindOf(r) })), [q.data]);
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { all: rows.length, read: 0, delivered: 0, sent: 0, held: 0, failed: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);
  const shown = kind === "all" ? rows : rows.filter((r) => r.kind === kind);

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
    { h: "Name", render: (r) => r.name || "No name" },
    { h: "Number", render: (r) => (r.wa_id ? `+${r.wa_id}` : "–") },
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
          <Chips
            ariaLabel="Filter recipients"
            value={kind}
            onChange={(k) => setKind(k as Kind)}
            items={(["all", "read", "delivered", "sent", "held", "failed"] as Kind[]).map((k) => ({
              key: k,
              label: k === "all" ? "Everyone" : LABEL[k].text,
              count: counts[k],
            }))}
          />
          <Table
            cols={cols}
            rows={shown.slice(0, 500)}
            rowKey={(r) => r.contact_id}
            card={(r) => ({ title: r.name || (r.wa_id ? `+${r.wa_id}` : "No name"), value: LABEL[r.kind].text, meta: fmtIst(r.at) })}
            empty={rows.length ? "Nobody in this group." : "Nobody has been messaged yet."}
          />
          {shown.length > 500 && <div className="pm2-empty">Showing the first 500. Download the CSV for everyone.</div>}
        </div>
      )}
    </Card>
  );
}
