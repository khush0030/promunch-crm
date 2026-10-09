"use client";

// "Find more emails" for a selection: first the websites again (free, runs on
// the server), then, for admins only and after a cost confirm, the paid finder.
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import Dialog from "./Dialog";
import { api, errText, nf, plural, useB2bRefresh } from "./api";

type Provider = { provider: string; enabled: boolean; monthly_credit_cap: number; used_this_month: number };
const MAX_PAID = 20;
const CREDITS_PER_BUSINESS = 4; // 2 roles x up to 2 credits each

export default function FindEmailsDialog({
  leadIds, isAdmin, onClose,
}: {
  leadIds: string[];
  isAdmin: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const [busy, setBusy] = useState<"website" | "paid" | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const n = leadIds.length;
  const paidIds = leadIds.slice(0, MAX_PAID);

  useEffect(() => {
    if (!isAdmin) return;
    api<{ providers: Provider[] }>("/api/leads/buyers/providers")
      .then((j) => setProviders(j.providers))
      .catch(() => setProviders([]));
  }, [isAdmin]);
  const enabled = (providers ?? []).filter((p) => p.enabled);
  const left = enabled.reduce((a, p) => a + Math.max(0, p.monthly_credit_cap - p.used_this_month), 0);

  async function website() {
    setBusy("website");
    try {
      const r = await api<{ mode: string; queued?: number; noWebsite?: number; found?: number }>("/api/leads/find-emails", { body: { lead_ids: leadIds, step: "website" } });
      if (r.mode === "now") {
        toast.push({ kind: r.found ? "success" : "info", text: r.found ? `Found ${plural(r.found, "email")}. It is Ready now.` : "No email on their website." });
      } else {
        toast.push({
          kind: "success",
          text: `Checking ${plural(r.queued ?? 0, "website")} again on our server.${r.noWebsite ? ` ${plural(r.noWebsite, "business", "businesses")} ${r.noWebsite === 1 ? "has" : "have"} no website.` : ""}`,
        });
      }
      refresh();
      onClose();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function paid() {
    setBusy("paid");
    try {
      const r = await api<{ looked: number; found: number; credits: number; stopped: string | null }>("/api/leads/find-emails", { body: { lead_ids: paidIds, step: "paid" } });
      toast.push({
        kind: r.found ? "success" : "info",
        text: `Paid finder: ${plural(r.found, "email")} found for ${plural(r.looked, "business", "businesses")}, ${nf(r.credits)} credits used.${r.stopped ? ` Stopped: ${r.stopped}` : ""}`,
      });
      refresh();
      onClose();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog title={`Find more emails for ${plural(n, "business", "businesses")}`} onClose={onClose}>
      {!confirmPaid ? (
        <>
          <p>We look at their websites again. This is free and runs on our server, so you can close this page.</p>
          {isAdmin ? (
            <p className={s.hint}>
              Still nothing? The paid email finder looks up a named person (HR or purchasing) and only keeps checked addresses.
              {providers && !enabled.length ? " It is switched off; turn it on in Settings first." : null}
            </p>
          ) : null}
          <div className={s.dlgF}>
            <button type="button" className="pm-btn ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
            {isAdmin && enabled.length ? (
              <button type="button" className="pm-btn" onClick={() => setConfirmPaid(true)} disabled={!!busy}>Use the paid finder…</button>
            ) : null}
            <button type="button" className="pm-btn primary" onClick={website} disabled={!!busy}>
              {busy === "website" ? "Starting…" : "Check websites again"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            This uses paid credits: <b>up to {nf(paidIds.length * CREDITS_PER_BUSINESS)} credits</b> for {plural(paidIds.length, "business", "businesses")}
            {n > MAX_PAID ? ` (the first ${MAX_PAID} of your ${n})` : ""}. Lookups already done in the last 30 days are not charged again.
          </p>
          <p className={s.hint}>{nf(left)} credits left this month across {enabled.map((p) => p.provider).join(", ")}.</p>
          <div className={s.dlgF}>
            <button type="button" className="pm-btn ghost" onClick={() => setConfirmPaid(false)} disabled={!!busy}>Back</button>
            <button type="button" className="pm-btn primary" onClick={paid} disabled={!!busy || left <= 0}>
              {busy === "paid" ? "Looking up…" : "Yes, spend the credits"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
