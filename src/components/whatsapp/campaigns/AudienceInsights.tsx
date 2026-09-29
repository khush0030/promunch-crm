"use client";

// Everything that used to crowd the top of the Campaigns tab, folded into one
// collapsible section: audience quality, daily budget, customer groups,
// cart-recovery results and the Shopify phone import.

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Megaphone, Upload } from "lucide-react";
import { Card, ConfirmDialog } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import AudienceHealthPanel from "../AudienceHealthPanel";
import { api, errorMessage, qk, request, useQuota, useSegments } from "./api";
import { SEGMENTS, fmtInt } from "./logic";
import s from "./campaigns.module.css";

type Recovery = {
  enrolled: number; recovered: number; selfReturned: number; delivered: number; retrying: number; missed: number;
  reached: number; reachRate: number; recoveryRate: number;
};

export function AudienceInsights() {
  const [open, setOpen] = useState(false);
  return (
    <details className={s.insights} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span>Audience insights</span>
        <span className="pm2-btn sm ghost" aria-hidden>
          {open ? "Hide" : "Show"} <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
        </span>
      </summary>
      {open && (
        <div className={s.insightsBody}>
          <AudienceHealthPanel />
          <div className="pm2-g2">
            <BudgetCard />
            <RecoveryCard />
          </div>
          <SegmentsCard />
          <ShopifyImport />
        </div>
      )}
    </details>
  );
}

function BudgetCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: q } = useQuota();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(next: number | null) {
    setBusy(true);
    try {
      await api.setBudget(next);
      toast.push({ kind: "success", text: next == null ? "Daily limit cleared. Meta's own limit applies." : `Daily limit set to ${fmtInt(next)} people. Live within a minute.` });
      setVal("");
      await qc.invalidateQueries({ queryKey: qk.quota });
    } catch (e) {
      toast.push({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Daily sending limit" basis="people per 24 hours, all WhatsApp templates">
      <div className={s.stack}>
        <div className={s.help}>
          Now: <b>{q?.limit != null ? fmtInt(q.limit) : "not set"}</b>
          {q?.limit_source === "manual" ? " (our own cap)" : q?.limit_source === "meta" ? " (Meta's tier)" : ""}. Campaigns
          pace themselves to this and continue every day until everyone is reached. Raise it slowly while Meta standing stays good.
        </div>
        <form
          className={s.inline}
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.floor(Number(val));
            if (n >= 1) save(n);
            else toast.push({ kind: "error", text: "Enter a number of 1 or more." });
          }}
        >
          <label className={s.field} style={{ flex: "0 1 160px" }}>
            <span className={s.label}>New limit</span>
            <input className={s.input} type="number" min={1} max={100000} inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value)} placeholder={String(q?.limit ?? 250)} />
          </label>
          <button type="submit" className="pm2-btn sm pri" disabled={busy || !val} style={{ alignSelf: "end" }}>
            Save
          </button>
          {q?.limit_source === "manual" && (
            <button type="button" className="pm2-btn sm" disabled={busy} onClick={() => save(null)} style={{ alignSelf: "end" }}>
              Use Meta&apos;s limit
            </button>
          )}
        </form>
      </div>
    </Card>
  );
}

function RecoveryCard() {
  const { data } = useQuery({
    queryKey: ["wa-cart-recovery"],
    queryFn: async () => (await request<{ stats: Recovery | null }>("/api/whatsapp/cart-recovery")).stats,
    staleTime: 60_000,
  });
  return (
    <Card title="Cart recovery" basis="last 30 days, runs by itself">
      {!data ? (
        <div className="pm2-empty">No cart-recovery results yet.</div>
      ) : (
        <div>
          <div className={s.bdRow}><span>Carts that got a reminder</span><b>{fmtInt(data.reached)} of {fmtInt(data.enrolled)}</b></div>
          <div className={s.bdRow}><span>Bought after the reminder</span><b>{fmtInt(data.recovered)} ({data.recoveryRate}%)</b></div>
          <div className={s.bdRow}><span>Came back on their own</span><b>{fmtInt(data.selfReturned)}</b></div>
          <div className={s.bdRow}><span>Still trying</span><b>{fmtInt(data.retrying)}</b></div>
          <div className={s.bdRow}><span>Missed</span><b>{fmtInt(data.missed)}</b></div>
        </div>
      )}
    </Card>
  );
}

function SegmentsCard() {
  const { data: segs = [] } = useSegments();
  const byTier = Object.fromEntries(segs.map((x) => [x.rfm_tier, x]));
  return (
    <Card title="Customer groups" basis="from Shopify orders, refreshed nightly">
      <div className={s.optionGrid}>
        {SEGMENTS.map((seg) => {
          const rows = seg.tags.map((t) => byTier[t]).filter(Boolean);
          const people = rows.reduce((a, r) => a + Number(r.customers), 0);
          const spend = rows.reduce((a, r) => a + Number(r.spend), 0);
          return (
            <div key={seg.key} className={s.option} style={{ cursor: "default" }}>
              <div className={s.optionTitle}>
                {seg.label} <span className="pm2-num" style={{ marginLeft: "auto" }}>{fmtInt(people)}</span>
              </div>
              <div className={s.optionHint}>{seg.hint}{spend ? ` · ₹${fmtInt(spend)} spent` : ""}</div>
              {people > 0 && (
                <Link className="pm2-btn sm" href={`/dashboard/whatsapp/campaigns/new?segment=${seg.key}`} style={{ justifySelf: "start" }}>
                  <Megaphone size={14} aria-hidden /> New campaign
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ShopifyImport() {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const j = await request<{ imported?: number; scanned?: number; skipped?: number }>("/api/whatsapp/import-contacts", { method: "POST" });
      toast.push({ kind: "success", text: `Added ${fmtInt(j.imported ?? 0)} new WhatsApp contacts from ${fmtInt(j.scanned ?? 0)} Shopify customers. Existing contacts were left as they were.` });
      setConfirm(false);
    } catch (e) {
      toast.push({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Bring in Shopify phone numbers" basis="rarely needed">
      <div className={s.inline} style={{ justifyContent: "space-between" }}>
        <div className={s.help} style={{ flex: "1 1 280px" }}>
          Adds customers who ordered with a phone number. They count as &quot;imported&quot;: Meta blocks most marketing to people who never messaged us, so don&apos;t send them promos until they reply.
        </div>
        <button type="button" className="pm2-btn sm" onClick={() => setConfirm(true)}>
          <Upload size={14} aria-hidden /> Import from Shopify
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Import Shopify phone numbers?"
          body="New numbers are added as WhatsApp contacts. Existing contacts are not changed. Nothing is sent."
          confirmLabel="Import"
          busy={busy}
          onClose={() => setConfirm(false)}
          onConfirm={run}
        />
      )}
    </Card>
  );
}
