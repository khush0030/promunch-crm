"use client";

// Send the exact campaign message to your own phone before launching. Uses the
// engine's real component builder; creates no contact, no ledger row, no claim.

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Card } from "@/components/pm";
import { HelpTip } from "@/components/guide";
import { classifyWaError } from "../../waErrors";
import { api, type TestSendResult } from "../api";
import { TechDetails } from "../bits";
import { normalizeTestNumber, rememberNumber, SAMPLE_NAME } from "../logic";
import s from "../campaigns.module.css";

const STORE_KEY = "wa-campaign-test-numbers";

function loadNumbers(): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}
function saveNumbers(list: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* private window: just don't remember */
  }
}

export function TestSendPanel({
  draft,
  disabledReason,
}: {
  draft: { template_id: string; template_vars: Record<string, string>; header_media_url: string | null; name: string } | null;
  disabledReason: string | null;
}) {
  const [phone, setPhone] = useState("");
  const [testName, setTestName] = useState(SAMPLE_NAME);
  // Only ever rendered client-side (the review step), so reading storage in the initialiser is safe.
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : loadNumbers()));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(TestSendResult & { to: string }) | null>(null);
  const [inputErr, setInputErr] = useState<string | null>(null);


  async function send(raw = phone) {
    const to = normalizeTestNumber(raw);
    if (!to) {
      setInputErr("Enter a full mobile number, e.g. 98765 43210.");
      return;
    }
    if (!draft) return;
    setInputErr(null);
    setBusy(true);
    setResult(null);
    const r = await api.testSend({ to, draft, test_name: testName.trim() || undefined });
    setResult({ ...r, to });
    setBusy(false);
    if (r.ok) {
      const next = rememberNumber(recent, to);
      setRecent(next);
      saveNumbers(next);
    }
  }

  const info = result && !result.ok ? classifyWaError(`${result.error_code ?? ""} ${result.error ?? ""}`) : null;

  return (
    <Card title="Send yourself a test" basis="strongly recommended" right={<HelpTip term="test_send" />}>
      <div className={s.stack}>
        <p className={s.help} style={{ margin: 0 }}>
          Check the picture, the text and every button on your own phone. A test doesn&apos;t count as a campaign message and never blocks the real send.
        </p>
        <form
          className={s.row2}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label className={s.field}>
            <span className={s.label}>WhatsApp number</span>
            <input className={`${s.input} ${inputErr ? s.inputErr : ""}`} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" autoComplete="tel" />
            {inputErr && <span className={s.err}>{inputErr}</span>}
          </label>
          <label className={s.field}>
            <span className={s.label}>Name to use for {"{name}"}</span>
            <input className={s.input} value={testName} onChange={(e) => setTestName(e.target.value)} />
          </label>
          <div className={s.inline} style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="pm2-btn sm pri" disabled={busy || !draft || !!disabledReason}>
              <Send size={14} aria-hidden /> {busy ? "Sending test…" : "Send test"}
            </button>
            {recent.map((n) => (
              <button key={n} type="button" className={s.miniChip} disabled={busy || !draft || !!disabledReason} onClick={() => { setPhone(n); send(n); }}>
                +{n}
              </button>
            ))}
          </div>
        </form>
        {disabledReason && <div className={s.help}>{disabledReason}</div>}
        {result?.ok && (
          <div className={s.help} role="status" style={{ color: "var(--pm-green)" }}>
            <CheckCircle2 size={14} aria-hidden style={{ verticalAlign: -2 }} /> Test sent to +{result.to}. Open WhatsApp and check it looks right.
          </div>
        )}
        {result && !result.ok && info && (
          <div className={s.danger} role="alert">
            <b>The test didn&apos;t go through: {info.key === "unknown" ? "something went wrong" : info.title.toLowerCase()}.</b>
            <div>{info.key === "unknown" ? result.explanation?.cause ?? result.error ?? "No reason was given." : info.msg}</div>
            {info.action && <div style={{ marginTop: 4 }}>What to do: {info.action}</div>}
            {info.key === "cap" && <div style={{ marginTop: 4 }}>Meta is holding back marketing to this number today. Try a different number, or try again tomorrow.</div>}
            <TechDetails>
              {[result.error_code != null ? `code ${result.error_code}` : null, result.error_class, result.error].filter(Boolean).join(" · ")}
            </TechDetails>
          </div>
        )}
      </div>
    </Card>
  );
}
