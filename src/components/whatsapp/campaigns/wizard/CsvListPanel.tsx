"use client";

// Upload a CSV of phone numbers as this campaign's audience. New numbers are
// added as WhatsApp contacts (tagged with a list tag), existing contacts get
// the same tag. Opt-outs stay out: nobody's opt-in is changed for them.

import { useState } from "react";
import { FileUp } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "../api";
import { csvContacts, fmtInt, listTagFor, parseCsv, type CsvContact } from "../logic";
import s from "../campaigns.module.css";

export function CsvListPanel({
  tag,
  count,
  consent,
  onChange,
}: {
  tag: string | null;
  count: number;
  consent: boolean;
  onChange: (p: { csvTag?: string | null; csvCount?: number; csvConsent?: boolean }) => void;
}) {
  const toast = useToast();
  const [parsed, setParsed] = useState<{ file: string; contacts: CsvContact[]; skipped: number; headers: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.push({ kind: "error", text: "That file is over 5 MB. Split it into smaller lists." });
      return;
    }
    const text = await f.text();
    const { headers, rows } = parseCsv(text);
    const r = csvContacts(headers, rows);
    if (r.phoneCol < 0 || r.contacts.length === 0) {
      toast.push({ kind: "error", text: "We couldn't find phone numbers in that file. Add a column called Phone." });
      return;
    }
    setParsed({ file: f.name, contacts: r.contacts, skipped: r.skipped, headers });
    onChange({ csvTag: null, csvCount: 0 });
  }

  async function saveList() {
    if (!parsed) return;
    const listTag = listTagFor(parsed.file);
    setBusy(true);
    try {
      const imp = await api.importCsv(parsed.contacts, listTag);
      if (imp.error) throw new Error(imp.error);
      await api.tagList(listTag, parsed.contacts.map((c) => c.phone));
      onChange({ csvTag: listTag, csvCount: parsed.contacts.length });
      toast.push({ kind: "success", text: `List saved: ${fmtInt(parsed.contacts.length)} numbers (${fmtInt(imp.imported)} new contacts).` });
    } catch (e) {
      toast.push({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack}>
      <label className="pm2-btn sm" style={{ justifySelf: "start", cursor: "pointer" }}>
        <FileUp size={14} aria-hidden /> {parsed || tag ? "Choose another file" : "Choose a CSV file"}
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <p className={s.help} style={{ margin: 0 }}>
        One row per person, with a Phone column (Name is optional). Indian numbers can be 10 digits. Duplicates and bad numbers are skipped.
      </p>

      {parsed && (
        <div className={s.stack}>
          <div className={s.help}>
            <b>{parsed.file}</b>: {fmtInt(parsed.contacts.length)} numbers found{parsed.skipped ? `, ${fmtInt(parsed.skipped)} skipped` : ""}. First rows:
          </div>
          <table className={s.csvTable}>
            <thead><tr><th>Phone</th><th>Name</th></tr></thead>
            <tbody>
              {parsed.contacts.slice(0, 5).map((c) => (
                <tr key={c.phone}><td>+{c.phone}</td><td>{c.name ?? "–"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(parsed || tag) && (
        <label className={s.check}>
          <input type="checkbox" checked={consent} onChange={(e) => onChange({ csvConsent: e.target.checked })} />
          <span>These people agreed to hear from PROMUNCH on WhatsApp. (Required. Messaging people who didn&apos;t agree gets our number blocked.)</span>
        </label>
      )}

      {parsed && !tag && (
        <button type="button" className="pm2-btn sm pri" style={{ justifySelf: "start" }} disabled={!consent || busy} onClick={saveList}>
          {busy ? "Saving list…" : `Use these ${fmtInt(parsed.contacts.length)} people`}
        </button>
      )}
      {tag && (
        <div className={s.help}>
          Using list <b>{tag.replace(/^list:/, "")}</b>{count ? ` (${fmtInt(count)} numbers)` : ""}. Nothing is sent until you launch.
        </div>
      )}
    </div>
  );
}
