"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderPlus, ListPlus, Play, RefreshCw, Search } from "lucide-react";
import { Card, Callout, ConfirmDialog, KpiStrip, Kpi, Pill, Table } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { AudienceResponse, BrevoList, BrevoSegment, BrevoAttribute } from "@/app/api/brevo/audience/route";
import type { SyncResult } from "@/lib/brevo-sync";
import { getJson, sendJson, errorText, Note, field, inputStyle, int, dateTime, day, SectionView, ErrorCallout, useBrevoSettings, useInvalidate, settingsKey } from "./format";

const SKIP_LABEL: Record<string, string> = {
  no_consent: "never opted in to marketing",
  unsubscribed: "unsubscribed",
  suppressed: "on the do-not-email list",
  not_active: "bounced / inactive",
  anonymized: "anonymized (GDPR)",
  no_email: "no email",
};

export const audienceKey = ["brevo-audience"] as const;

export function AudienceTab() {
  const invalidate = useInvalidate();
  const settingsQ = useBrevoSettings();
  const q = useQuery({ queryKey: audienceKey, queryFn: () => getJson<AudienceResponse>("/api/brevo/audience") });
  const [preview, setPreview] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [testEmails, setTestEmails] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState<null | "live" | "test">(null);
  const [newFolder, setNewFolder] = useState("");
  const [newList, setNewList] = useState({ name: "", folderId: "" });
  const [filter, setFilter] = useState("");

  if (q.isLoading) return <div className="pm2-skel" />;
  if (q.isError || !q.data) return <ErrorCallout title="Couldn't load Brevo audience" error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const s = a.settings;
  const isOwner = settingsQ.data?.isOwner === true;

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: "ok", text: await fn() });
      await invalidate(audienceKey, settingsKey);
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const runPreview = (target: "test" | "live") =>
    act(`preview-${target}`, async () => {
      const r = await sendJson<SyncResult>("/api/brevo/audience/sync", "POST", { dryRun: true, previewTarget: target });
      setPreview(r);
      return `Preview ready (${target}). Nothing was sent to Brevo.`;
    });

  const runSync = () =>
    act("sync", async () => {
      const r = await sendJson<SyncResult>("/api/brevo/audience/sync", "POST", { dryRun: false });
      setPreview(r);
      return `Synced ${int(r.eligible)} contact${r.eligible === 1 ? "" : "s"} to "${r.listName}"${r.blocklisted ? `, ${r.blocklisted} blocklisted` : ""}. Brevo import job${r.processIds.length === 1 ? "" : "s"} ${r.processIds.map((p) => `#${p}`).join(", ")}.`;
    });

  const saveSettings = (patch: Record<string, unknown>, text: string) =>
    act("settings", async () => {
      await sendJson("/api/brevo/settings", "PUT", patch);
      return text;
    });

  const lists = a.lists.state === "ok" ? a.lists.data : [];
  const folders = a.folders.state === "ok" ? a.folders.data : [];
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const filteredLists = lists.filter((l) => !filter || l.name.toLowerCase().includes(filter.toLowerCase()));

  const listCols: TableCol<BrevoList>[] = [
    {
      h: "List",
      render: (l) => (
        <>
          {l.name}
          {(l.id === s.test_list_id || l.id === s.live_list_id) && (
            <>
              {" "}
              <Pill tone={l.id === s.live_list_id ? "warn" : "info"}>{l.id === s.live_list_id ? "CRM live sync" : "CRM test sync"}</Pill>
            </>
          )}
          <span className="sub">{folderName.get(l.folderId) ?? `Folder #${l.folderId}`}</span>
        </>
      ),
    },
    { h: "#", num: true, render: (l) => l.id },
    { h: "Contacts", num: true, render: (l) => int(l.uniqueSubscribers) },
    { h: "Blocklisted", num: true, render: (l) => int(l.totalBlacklisted) },
  ];
  const segCols: TableCol<BrevoSegment>[] = [
    { h: "Segment", render: (x) => x.segmentName },
    { h: "Category", render: (x) => x.categoryName },
    { h: "Updated", render: (x) => day(x.updatedAt) },
  ];
  const attrCols: TableCol<BrevoAttribute>[] = [
    { h: "Attribute", render: (x) => <code>{x.name}</code> },
    { h: "Type", render: (x) => x.type ?? x.category },
  ];

  return (
    <>
      {!s.migrated && (
        <Callout tone="sun" title="Database migration not applied" body="Apply promunch-email-agent/supabase/migrations/20260917100000_brevo_integration.sql in the Supabase SQL editor. Previews work; syncing needs it." />
      )}

      <Card
        title="CRM to Brevo sync"
        basis={s.sync_target === "live" ? "LIVE: every marketing-consented contact" : "TEST mode: only the test addresses"}
        right={<Pill tone={s.sync_target === "live" ? "warn" : "info"}>{s.sync_target === "live" ? "live" : "test mode"}</Pill>}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <KpiStrip cols={3}>
            <Kpi label="Last sync" value={s.last_sync_at ? dateTime(s.last_sync_at) : "never"} sub={s.last_sync_error ? "failed" : s.last_sync_count != null ? `${int(s.last_sync_count)} contacts` : "daily at 02:30 IST"} />
            <Kpi label="Target list" value={s.sync_target === "live" ? "PROMUNCH customers (CRM)" : "PROMUNCH TEST"} sub={`list #${(s.sync_target === "live" ? s.live_list_id : s.test_list_id) ?? "created on first sync"}`} />
            <Kpi label="Test addresses" value={int(s.test_emails.length)} sub={s.test_emails.join(", ")} />
          </KpiStrip>
          {s.last_sync_error && <Callout tone="crit" title="Last sync failed" body={s.last_sync_error} />}

          <div style={{ fontSize: 13.5, color: "var(--pm-muted)" }}>
            Only contacts who opted in to marketing (Shopify accepts marketing, or email consent SUBSCRIBED) are synced. Unsubscribed and do-not-email addresses are blocklisted in Brevo so no Brevo campaign reaches them.
            Attributes: FIRSTNAME, LASTNAME, CITY, STATE, ORDER_COUNT, TOTAL_SPENT, FIRST_ORDER_DATE, LAST_ORDER_DATE, RFM_SEGMENT, CHANNEL, CRM_ID.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => runPreview("test")}>
              <Search size={14} /> Preview test sync
            </button>
            <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => runPreview("live")}>
              <Search size={14} /> Preview live sync
            </button>
            {isOwner && (
              <button type="button" className="pm2-btn pri sm" disabled={busy != null || !s.migrated} onClick={runSync}>
                <Play size={14} /> {busy === "sync" ? "Syncing…" : `Sync now (${s.sync_target})`}
              </button>
            )}
            {isOwner && s.migrated && (
              <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => setConfirmLive(s.sync_target === "live" ? "test" : "live")}>
                {s.sync_target === "live" ? "Switch back to test mode" : "Switch to live audience"}
              </button>
            )}
          </div>

          {preview && (
            <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 12, fontSize: 13.5, display: "grid", gap: 6 }}>
              <strong>
                {preview.dryRun ? "Preview" : "Result"} ({preview.target}): {int(preview.eligible)} contact{preview.eligible === 1 ? "" : "s"} to &quot;{preview.listName}&quot;
              </strong>
              {Object.entries(preview.skipped).length > 0 && (
                <div>
                  Skipped: {Object.entries(preview.skipped).map(([k, v]) => `${int(v)} ${SKIP_LABEL[k] ?? k}`).join(" · ")}
                </div>
              )}
              {preview.attributesCreated.length > 0 && <div>Brevo attributes {preview.dryRun ? "to create" : "created"}: {preview.attributesCreated.join(", ")}</div>}
              {preview.sample.length > 0 && (
                <details>
                  <summary style={{ cursor: "pointer" }}>Sample rows</summary>
                  <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(preview.sample, null, 2)}</pre>
                </details>
              )}
            </div>
          )}

          {isOwner && s.migrated && (
            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ ...field, flex: "1 1 320px" }}>
                Test addresses (comma separated). Test sends and test-mode sync only use these.
                <input style={inputStyle} value={testEmails ?? s.test_emails.join(", ")} onChange={(e) => setTestEmails(e.target.value)} />
              </label>
              <button
                type="button"
                className="pm2-btn sm"
                disabled={busy != null || testEmails == null}
                onClick={() => saveSettings({ test_emails: (testEmails ?? "").split(/[,\s]+/).filter(Boolean) }, "Test addresses saved.").then(() => setTestEmails(null))}
              >
                Save
              </button>
            </div>
          )}
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        </div>
      </Card>

      <Card
        title="Lists"
        basis={`${lists.length} in Brevo`}
        right={<input style={{ ...inputStyle, width: 180, padding: "5px 8px" }} placeholder="Filter lists" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter lists" />}
      >
        <SectionView s={a.lists} gatedTitle="Lists unavailable">
          {() => <Table cols={listCols} rows={filteredLists} rowKey={(l) => l.id} card={(l) => ({ title: l.name, value: int(l.uniqueSubscribers), meta: folderName.get(l.folderId) ?? "" })} empty="No lists" />}
        </SectionView>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "end" }}>
          <label style={{ ...field, flex: "1 1 180px" }}>
            New list
            <input style={inputStyle} value={newList.name} onChange={(e) => setNewList((n) => ({ ...n, name: e.target.value }))} />
          </label>
          <label style={{ ...field, flex: "1 1 160px" }}>
            In folder
            <select style={inputStyle} value={newList.folderId} onChange={(e) => setNewList((n) => ({ ...n, folderId: e.target.value }))}>
              <option value="">Pick folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="pm2-btn sm"
            disabled={busy != null || !newList.name.trim() || !newList.folderId}
            onClick={() =>
              act("list", async () => {
                await sendJson("/api/brevo/audience", "POST", { kind: "list", name: newList.name, folderId: Number(newList.folderId) });
                setNewList({ name: "", folderId: "" });
                return "List created.";
              })
            }
          >
            <ListPlus size={14} /> Create list
          </button>
          <label style={{ ...field, flex: "1 1 180px" }}>
            New folder
            <input style={inputStyle} value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
          </label>
          <button
            type="button"
            className="pm2-btn sm"
            disabled={busy != null || !newFolder.trim()}
            onClick={() =>
              act("folder", async () => {
                await sendJson("/api/brevo/audience", "POST", { kind: "folder", name: newFolder });
                setNewFolder("");
                return "Folder created.";
              })
            }
          >
            <FolderPlus size={14} /> Create folder
          </button>
        </div>
      </Card>

      <div className="pm2-g2">
        <Card title="Segments" basis="built in Brevo">
          <SectionView s={a.segments} gatedTitle="Segments unavailable">
            {(segs) => <Table cols={segCols} rows={segs} rowKey={(x) => x.id} card={(x) => ({ title: x.segmentName, meta: x.categoryName })} empty="No segments" />}
          </SectionView>
        </Card>
        <Card title="Contact attributes" basis="fields you can personalise with">
          <SectionView s={a.attributes} gatedTitle="Attributes unavailable">
            {(attrs) => <Table cols={attrCols} rows={attrs} rowKey={(x) => x.name} card={(x) => ({ title: x.name, meta: x.type ?? x.category })} empty="No attributes" />}
          </SectionView>
        </Card>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="pm2-btn sm ghost" onClick={() => q.refetch()}>
          <RefreshCw size={14} /> Reload audience
        </button>
      </div>

      {confirmLive && (
        <ConfirmDialog
          title={confirmLive === "live" ? "Switch to the live audience?" : "Switch back to test mode?"}
          body={
            confirmLive === "live"
              ? "The next sync puts every marketing-consented CRM contact into Brevo, order events start reaching real customers (if events are on), and campaigns can go to any list. Run \"Preview live sync\" first."
              : "Sync and events go back to the test addresses only, and campaigns can only be sent to the PROMUNCH TEST list. Contacts already in Brevo stay there."
          }
          confirmLabel={confirmLive === "live" ? "Go live" : "Back to test mode"}
          danger={confirmLive === "live"}
          busy={busy === "settings"}
          onConfirm={async () => {
            await saveSettings({ sync_target: confirmLive }, confirmLive === "live" ? "Live. The next sync uses the real audience." : "Back in test mode.");
            setConfirmLive(null);
          }}
          onClose={() => setConfirmLive(null)}
        />
      )}
    </>
  );
}
