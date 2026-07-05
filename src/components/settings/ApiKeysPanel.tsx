"use client";

// Settings → API keys. Owner-only: the server returns 403 for everyone except
// the configured secrets owner, and this panel renders a locked state for them.
// Values are write-only from here — the API only ever returns a masked tail.

import { useCallback, useEffect, useState } from "react";
import { Lock, Plus, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "./ApiKeysPanel.module.css";

type KeyRow = {
  name: string;
  label: string;
  group: string;
  hint: string;
  testable: boolean;
  custom: boolean;
  source: "dashboard" | "env" | "missing";
  masked: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

const SOURCE_LABEL: Record<KeyRow["source"], string> = {
  dashboard: "Connected · set from dashboard",
  env: "Connected · from environment",
  missing: "Not configured",
};

export function ApiKeysPanel() {
  const toast = useToast();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [restricted, setRestricted] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ name: string; ok: boolean; detail: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/api-keys", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      const j = await res.json().catch(() => ({}));
      setRestricted(j.error ?? "restricted");
      return;
    }
    const j = await res.json();
    setKeys(j.keys ?? []);
    setMigrationPending(Boolean(j.migrationPending));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runTest(name: string, value?: string) {
    setBusy(name);
    setTestNote(null);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      const j = await res.json();
      setTestNote({ name, ok: Boolean(j.ok), detail: j.detail ?? j.error ?? "" });
      return Boolean(j.ok);
    } finally {
      setBusy(null);
    }
  }

  async function save(name: string, value: string, opts?: { skipTest?: boolean }) {
    const row = keys?.find((k) => k.name === name);
    if (!opts?.skipTest && row?.testable) {
      const ok = await runTest(name, value);
      if (!ok) return; // testNote shows the failure; owner can Save anyway
    }
    setBusy(name);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.push({ kind: "error", text: j.error ?? "save failed" });
        return;
      }
      toast.push({ kind: "success", text: `${name} saved` });
      setEditing(null);
      setDraft("");
      setTestNote(null);
      load();
    } finally {
      setBusy(null);
    }
  }

  async function removeCustom(name: string) {
    if (!confirm(`Remove custom key ${name}?`)) return;
    const res = await fetch("/api/settings/api-keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      toast.push({ kind: "success", text: `${name} removed` });
      load();
    } else toast.push({ kind: "error", text: "delete failed" });
  }

  if (restricted) {
    return (
      <div className={styles.restricted}>
        <Lock size={26} />
        <b>API keys are locked to the workspace owner</b>
        <span>{restricted}</span>
      </div>
    );
  }
  if (!keys) return <div className={styles.restricted}>Loading…</div>;

  const groups = [...new Set(keys.map((k) => k.group))];

  return (
    <div>
      {migrationPending && (
        <div className={styles.banner}>
          Storage table missing — apply <code>20260705240000_app_secrets.sql</code> in the Supabase
          SQL editor to enable saving. Status below reflects environment keys only.
        </div>
      )}

      {groups.map((g) => (
        <div key={g} className={styles.group}>
          <div className={styles.groupLabel}>{g}</div>
          {keys
            .filter((k) => k.group === g)
            .map((k) => (
              <div key={k.name} className={styles.row}>
                <span
                  className={`${styles.dot} ${
                    k.source === "missing" ? styles.dotMissing : k.source === "env" ? styles.dotEnv : styles.dotOk
                  }`}
                  aria-hidden
                />
                <div className={styles.id}>
                  <div className={styles.label}>{k.label}</div>
                  <div className={styles.name}>{k.name}</div>
                  <div className={styles.hint}>{k.hint}</div>
                </div>
                <div className={styles.meta}>
                  <div className={styles.masked}>{k.masked ?? "—"}</div>
                  <div>{SOURCE_LABEL[k.source]}</div>
                  {k.updatedAt && <div>updated {new Date(k.updatedAt).toLocaleDateString("en-IN")}</div>}
                </div>
                <div className={styles.actions}>
                  {k.testable && (
                    <button type="button" className={styles.btn} disabled={busy === k.name} onClick={() => runTest(k.name)}>
                      <RefreshCw size={11} /> Test
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => {
                      setEditing(editing === k.name ? null : k.name);
                      setDraft("");
                      setTestNote(null);
                    }}
                  >
                    Replace
                  </button>
                  {k.custom && (
                    <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => removeCustom(k.name)}>
                      Remove
                    </button>
                  )}
                </div>

                {editing === k.name && (
                  <div className={styles.editor}>
                    <input
                      className={styles.input}
                      type="password"
                      placeholder={`Paste the new ${k.label} key`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className={styles.saveBtn}
                      disabled={draft.trim().length < 8 || busy === k.name}
                      onClick={() => save(k.name, draft.trim())}
                    >
                      {k.testable ? "Test & save" : "Save"}
                    </button>
                    {testNote?.name === k.name && !testNote.ok && (
                      <button type="button" className={styles.btn} onClick={() => save(k.name, draft.trim(), { skipTest: true })}>
                        Save anyway
                      </button>
                    )}
                  </div>
                )}
                {testNote?.name === k.name && (
                  <div className={`${styles.testNote} ${testNote.ok ? styles.testOk : styles.testFail}`}>{testNote.detail}</div>
                )}
              </div>
            ))}
        </div>
      ))}

      <div className={styles.group}>
        <div className={styles.groupLabel}>Add a custom key</div>
        <div className={styles.addRow}>
          <input
            className={`${styles.input} ${styles.addName}`}
            placeholder="KEY_NAME"
            value={newName}
            onChange={(e) => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
          />
          <input
            className={styles.input}
            type="password"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className={styles.saveBtn}
            disabled={!/^[A-Z][A-Z0-9_]{2,63}$/.test(newName) || newValue.trim().length < 8}
            onClick={async () => {
              await save(newName, newValue.trim(), { skipTest: true });
              setNewName("");
              setNewValue("");
            }}
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      <p className={styles.note}>
        Keys saved here take effect within a minute, no redeploy. WhatsApp, Slack and Amazon
        credentials run inside Supabase edge functions and are rotated there (Supabase secrets),
        not from this page. Every change is written to the audit log.
      </p>
    </div>
  );
}
