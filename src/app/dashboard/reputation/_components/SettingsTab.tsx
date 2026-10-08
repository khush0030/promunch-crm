"use client";

// Settings: which sources we listen to, what counts as a mention, and who
// gets a WhatsApp when something serious shows up. Admins change it; everyone
// else sees it read-only. Every source ships off and alerts ship off.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccess } from "@/components/shell/useAccess";
import { Plus, X } from "lucide-react";
import type {
  AsinSuggestion,
  CompetitorAsin,
  OrmSettings,
  OrmSettingsResponse,
  OrmSource,
  OrmSourceKey,
} from "@/lib/orm/types";
import { api, errText, QK } from "./api";
import { dateTime, Mark, relTime, Switch, useOrmSettings, type Tone } from "./ui";
import s from "../reputation.module.css";

export function SettingsTab() {
  const q = useOrmSettings();
  const access = useAccess();
  if (q.isLoading) return <p className={s.hint}>Loading settings…</p>;
  if (q.error || !q.data) return <p className={s.err}>{errText(q.error) ?? "Could not load settings."}</p>;
  return <SettingsForm data={q.data} canEdit={!!access?.admin} />;
}

const lines = (t: string) =>
  t
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const urlLines = (t: string) =>
  t
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

function every(min: number): string {
  if (min % 10080 === 0) return min === 10080 ? "once a week" : `every ${min / 10080} weeks`;
  if (min % 1440 === 0) return min === 1440 ? "once a day" : `every ${min / 1440} days`;
  if (min % 60 === 0) return min === 60 ? "every hour" : `every ${min / 60} hours`;
  return `every ${min} minutes`;
}

const LAST_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "Working", tone: "good" },
  error: { label: "Error", tone: "crit" },
  skipped: { label: "Skipped", tone: "neu" },
  not_connected: { label: "Needs API key", tone: "warn" },
  budget: { label: "Paused, monthly budget used", tone: "warn" },
};

type Form = {
  keywords: string;
  exclude: string;
  alertIds: string;
  asins: string;
  perAsin: number;
  budget: number;
  feeds: string;
  channelId: string;
  digestDow: number;
  digestHour: number;
  spikeThreshold: number;
  spikeWindow: number;
  competitors: CompetitorAsin[];
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "am" : "pm"}`;

function formOf(st: OrmSettings, sources: OrmSource[]): Form {
  const cfg = (k: OrmSourceKey) => sources.find((x) => x.key === k)?.config ?? {};
  const feeds = cfg("rss").feeds;
  return {
    keywords: st.keywords.join(", "),
    exclude: st.exclude_keywords.join(", "),
    alertIds: st.alert_wa_ids.join(", "),
    asins: st.amazon_asins.join(", "),
    perAsin: st.amazon_reviews_per_asin,
    budget: st.apify_monthly_budget_usd,
    feeds: Array.isArray(feeds) ? (feeds as string[]).join("\n") : "",
    channelId: typeof cfg("youtube").channel_id === "string" ? (cfg("youtube").channel_id as string) : "",
    digestDow: st.weekly_digest_dow,
    digestHour: st.weekly_digest_hour_ist,
    spikeThreshold: st.spike_threshold,
    spikeWindow: st.spike_window_days,
    competitors: st.competitor_asins.map((c) => ({ ...c })),
  };
}

function SettingsForm({ data, canEdit }: { data: OrmSettingsResponse; canEdit: boolean }) {
  const qc = useQueryClient();
  const initial = formOf(data.settings, data.sources);
  const [f, setF] = useState<Form>(initial);
  const [saved, setSaved] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<OrmSettingsResponse>("/api/orm/settings", { method: "PATCH", body }),
    onSuccess: (res) => {
      qc.setQueryData<OrmSettingsResponse>(QK.settings, (old) => ({ ...old, ...res }));
      qc.invalidateQueries({ queryKey: ["orm", "summary"] });
    },
  });

  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const saveForm = () =>
    save.mutate(
      {
        keywords: lines(f.keywords),
        exclude_keywords: lines(f.exclude),
        alert_wa_ids: lines(f.alertIds),
        amazon_asins: lines(f.asins),
        amazon_reviews_per_asin: Math.round(f.perAsin),
        apify_monthly_budget_usd: f.budget,
        weekly_digest_dow: f.digestDow,
        weekly_digest_hour_ist: f.digestHour,
        spike_threshold: Math.round(f.spikeThreshold),
        spike_window_days: Math.round(f.spikeWindow),
        competitor_asins: f.competitors,
        sources: {
          rss: { config: { feeds: urlLines(f.feeds) } },
          youtube: { config: { channel_id: f.channelId.trim() } },
        },
      },
      {
        onSuccess: (res) => {
          setF(formOf(res.settings, res.sources));
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      },
    );

  const toggleSource = (key: OrmSourceKey, enabled: boolean) => save.mutate({ sources: { [key]: { enabled } } });
  const st = data.settings;

  return (
    <div className={s.settings}>
      {!canEdit && (
        <p className={s.note}>Only admins can change these settings. You can still see what is switched on.</p>
      )}

      <div className={s.secH}>
        <div>
          <h2>Sources</h2>
          <p>Where we look for reviews and mentions. Each one is off until you switch it on.</p>
        </div>
      </div>
      <div className={s.card}>
        {data.sources.map((src) => (
          <SourceRow
            key={src.key}
            src={src}
            canEdit={canEdit}
            busy={save.isPending}
            onToggle={(v) => toggleSource(src.key, v)}
          >
            <SourceConfig
              k={src.key}
              f={f}
              set={set}
              canEdit={canEdit}
              settings={st}
              suggestions={data.asin_suggestions ?? []}
            />
          </SourceRow>
        ))}
      </div>

      <div className={s.secH}>
        <div>
          <h2>What counts as a mention</h2>
          <p>A post from outside our own pages only enters the feed when it contains one of these words.</p>
        </div>
      </div>
      <div className={`${s.card} ${s.cardPad}`}>
        <div className={s.g2}>
          <Field label="Brand words" hint="Separate with commas. Not case sensitive.">
            <textarea
              className={s.textarea}
              rows={2}
              value={f.keywords}
              disabled={!canEdit}
              onChange={(e) => set({ keywords: e.target.value })}
            />
          </Field>
          <Field label="Skip posts that contain" hint="For example a different brand with a similar name. Stored but hidden.">
            <textarea
              className={s.textarea}
              rows={2}
              value={f.exclude}
              disabled={!canEdit}
              placeholder="Nothing skipped"
              onChange={(e) => set({ exclude: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className={s.secH}>
        <div>
          <h2>WhatsApp alerts</h2>
          <p>One WhatsApp to the team when something serious is posted in the last 7 days. Never more than one per mention.</p>
        </div>
      </div>
      <div className={`${s.card} ${s.cardPad}`}>
        <div className={s.switchRow}>
          <div>
            <b>Send alerts</b>
            <ul className={s.rules}>
              <li>Food safety words like stale, insect, fungus or allergy</li>
              <li>A review with 1 or 2 stars</li>
              <li>A very negative post by an account with 5,000 or more followers</li>
            </ul>
          </div>
          <Switch
            on={st.alerts_enabled}
            label="Send WhatsApp alerts"
            disabled={!canEdit || save.isPending}
            onChange={(v) => save.mutate({ alerts_enabled: v })}
          />
        </div>
        {!st.alerts_enabled && <p className={s.hint}>Off right now. Nobody gets a WhatsApp.</p>}
        <Field
          label="Send to these numbers"
          hint="WhatsApp numbers with country code, separated by commas. Leave empty to use the support alert list."
        >
          <input
            className={s.input}
            value={f.alertIds}
            disabled={!canEdit}
            placeholder="Support alert list"
            onChange={(e) => set({ alertIds: e.target.value })}
          />
        </Field>
      </div>

      <div className={s.secH}>
        <div>
          <h2>Complaint cases</h2>
          <p>A case follows an unhappy customer until it is sorted, so nobody is forgotten. Close it with how it ended.</p>
        </div>
      </div>
      <div className={`${s.card} ${s.cardPad}`}>
        <div className={s.switchRow}>
          <div>
            <b>Open a case for every new complaint</b>
            <p className={s.cfgNote} style={{ marginTop: 4 }}>
              When the AI reads a new negative post, a complaint, or anything urgent, it opens a case on it. Cases show under the
              Cases chip in the feed.
            </p>
          </div>
          <Switch
            on={st.auto_case_on_negative}
            label="Open cases automatically"
            disabled={!canEdit || save.isPending}
            onChange={(v) => save.mutate({ auto_case_on_negative: v })}
          />
        </div>
      </div>

      <div className={s.secH}>
        <div>
          <h2>Weekly WhatsApp summary</h2>
          <p>
            One WhatsApp a week to the alert numbers: the score, mentions, the worst product, the top complaint and open
            cases. Never more than one a week.
          </p>
        </div>
      </div>
      <div className={`${s.card} ${s.cardPad}`}>
        <div className={s.switchRow}>
          <div>
            <b>Send the weekly summary</b>
            {!st.weekly_digest_enabled && <p className={s.cfgNote} style={{ marginTop: 4 }}>Off right now.</p>}
          </div>
          <Switch
            on={st.weekly_digest_enabled}
            label="Send the weekly WhatsApp summary"
            disabled={!canEdit || save.isPending}
            onChange={(v) => save.mutate({ weekly_digest_enabled: v })}
          />
        </div>
        <div className={s.g2}>
          <Field label="Day" hint="India time.">
            <select
              className={s.select}
              value={f.digestDow}
              disabled={!canEdit}
              onChange={(e) => set({ digestDow: Number(e.target.value) })}
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From this time" hint="Sent at the first check after this hour.">
            <select
              className={s.select}
              value={f.digestHour}
              disabled={!canEdit}
              onChange={(e) => set({ digestHour: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className={s.secH}>
        <div>
          <h2>Batch problem alerts</h2>
          <p>
            One WhatsApp when several people complain about the same thing on the same product in a few days, for example
            stale packs from one batch. One alert per product and topic per window.
          </p>
        </div>
      </div>
      <div className={`${s.card} ${s.cardPad}`}>
        <div className={s.switchRow}>
          <div>
            <b>Send batch problem alerts</b>
            {!st.spike_alerts_enabled && <p className={s.cfgNote} style={{ marginTop: 4 }}>Off right now.</p>}
          </div>
          <Switch
            on={st.spike_alerts_enabled}
            label="Send batch problem alerts"
            disabled={!canEdit || save.isPending}
            onChange={(v) => save.mutate({ spike_alerts_enabled: v })}
          />
        </div>
        <div className={s.g2}>
          <Field label="Complaints needed" hint="2 to 20 about the same product and topic.">
            <input
              className={s.input}
              type="number"
              min={2}
              max={20}
              value={f.spikeThreshold}
              disabled={!canEdit}
              onChange={(e) => set({ spikeThreshold: Number(e.target.value) || 2 })}
            />
          </Field>
          <Field label="Within this many days" hint="1 to 30.">
            <input
              className={s.input}
              type="number"
              min={1}
              max={30}
              value={f.spikeWindow}
              disabled={!canEdit}
              onChange={(e) => set({ spikeWindow: Number(e.target.value) || 1 })}
            />
          </Field>
        </div>
      </div>

      <div className={s.secH}>
        <div>
          <h2>Competitors on Amazon</h2>
          <p>
            Products to compare our Amazon rating with, checked once a month. Switch on Competitor ratings under Sources to
            start. Our own top 3 ASINs are added automatically.
          </p>
        </div>
      </div>
      <div className={`${s.card} ${s.cardPad}`}>
        <CompetitorEditor rows={f.competitors} canEdit={canEdit} onChange={(competitors) => set({ competitors })} />
        <HowTo title="How to find the ASIN">
          <ol>
            <li>Open the product on amazon.in.</li>
            <li>Look at the link in the address bar. The ASIN is the 10 letters and numbers after /dp/.</li>
            <li>For example amazon.in/dp/B0CXYZ1234 has the ASIN B0CXYZ1234.</li>
          </ol>
        </HowTo>
      </div>

      <div className={s.secH}>
        <div>
          <h2>API keys</h2>
          <p>
            Keys for Judge.me, YouTube, Apify and Reddit are pasted in{" "}
            <Link className={s.inlineLink} href="/dashboard/settings#apikeys">
              Settings, API keys
            </Link>
            . Only the owner can open that page. A saved key is used on the next run, no restart needed.
          </p>
        </div>
      </div>

      {canEdit && (dirty || saved || save.error) && (
        <div className={s.saveBar}>
          {save.error && <span className={s.err}>{errText(save.error)}</span>}
          {saved && <span className={s.ok}>Saved</span>}
          <button type="button" className="pm-btn" disabled={!dirty || save.isPending} onClick={() => setF(initial)}>
            Undo changes
          </button>
          <button type="button" className="pm-btn primary" disabled={!dirty || save.isPending} onClick={saveForm}>
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
      {hint != null && <span className={s.hint}>{hint}</span>}
    </label>
  );
}

function SourceRow({
  src,
  canEdit,
  busy,
  onToggle,
  children,
}: {
  src: OrmSource;
  canEdit: boolean;
  busy: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api<Record<string, unknown>>(`/api/orm/sources/${src.key}/run`, { method: "POST" }),
    onSuccess: () => {
      setMsg("Done. New mentions are in the feed.");
      qc.invalidateQueries({ queryKey: QK.all });
    },
    onError: (e) => setMsg(errText(e)),
  });
  const later = src.key === "instagram";
  const st = src.last_status ? LAST_STATUS[src.last_status] : null;

  return (
    <div className={s.srcRow}>
      <div className={s.srcHead}>
        <div className={s.srcMain}>
          <b>{src.label}</b>
          <span className={s.srcSub}>
            {later ? (
              "Coming later. Needs Meta app approval first."
            ) : (
              <>
                {src.enabled ? <Mark tone="good">On</Mark> : <Mark tone="neu">Off</Mark>}
                {st && src.last_run_at && <Mark tone={st.tone}>{st.label}</Mark>}
                <span>
                  Checks {every(src.every_minutes)}
                  {src.last_run_at
                    ? `. Last run ${relTime(src.last_run_at)}${src.last_count != null ? `, ${src.last_count} found` : ""}.`
                    : ". Not run yet."}
                </span>
              </>
            )}
          </span>
          {src.last_status === "error" && src.last_error && <span className={s.err}>{src.last_error}</span>}
        </div>
        {!later && (
          <div className={s.srcActs}>
            {canEdit && src.enabled && (
              <button
                type="button"
                className="pm-btn sm"
                disabled={run.isPending}
                onClick={() => {
                  setMsg(null);
                  run.mutate();
                }}
                title={src.last_run_at ? `Last run ${dateTime(src.last_run_at)}` : undefined}
              >
                {run.isPending ? "Running…" : "Run now"}
              </button>
            )}
            <Switch on={src.enabled} label={`${src.label} on or off`} disabled={!canEdit || busy} onChange={onToggle} />
          </div>
        )}
      </div>
      {msg && <p className={run.isError ? s.err : s.ok}>{msg}</p>}
      {!later && children}
    </div>
  );
}

function HowTo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={s.howto}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

function SourceConfig({
  k,
  f,
  set,
  canEdit,
  settings,
  suggestions,
}: {
  k: OrmSourceKey;
  f: Form;
  set: (p: Partial<Form>) => void;
  canEdit: boolean;
  settings: OrmSettings;
  suggestions: AsinSuggestion[];
}) {
  if (k === "judgeme")
    return (
      <HowTo title="How to connect">
        <ol>
          <li>Open the Judge.me app in Shopify admin.</li>
          <li>Go to Settings, then Integrations, then View API token.</li>
          <li>Copy the private API token.</li>
          <li>
            Paste it in Settings, API keys as <b>Judge.me</b> (owner only).
          </li>
        </ol>
      </HowTo>
    );

  if (k === "reddit")
    return (
      <p className={s.cfgNote}>
        Works without a key. It searches Reddit for posts and comments that mention PROMUNCH. A Reddit app key is optional and only raises the limits.
      </p>
    );

  if (k === "rss")
    return (
      <div className={s.cfg}>
        <Field label="Google Alerts feed links" hint="One link per line.">
          <textarea
            className={s.textarea}
            rows={3}
            value={f.feeds}
            disabled={!canEdit}
            placeholder="https://www.google.com/alerts/feeds/…"
            onChange={(e) => set({ feeds: e.target.value })}
          />
        </Field>
        <HowTo title="How to create a Google Alert feed">
          <ol>
            <li>Open google.com/alerts and type PROMUNCH.</li>
            <li>Click Show options.</li>
            <li>Set Deliver to: RSS feed, then click Create Alert.</li>
            <li>Click the RSS icon next to the alert and copy the feed link.</li>
            <li>Paste it above and save. Add one alert per search, for example &quot;PROMUNCH snacks&quot;.</li>
          </ol>
        </HowTo>
      </div>
    );

  if (k === "youtube")
    return (
      <div className={s.cfg}>
        <Field label="Our YouTube channel id" hint="Starts with UC. Used to read comments on our own videos.">
          <input
            className={s.input}
            value={f.channelId}
            disabled={!canEdit}
            placeholder="UC…"
            onChange={(e) => set({ channelId: e.target.value })}
          />
        </Field>
        <HowTo title="How to get the API key and channel id">
          <ol>
            <li>Open console.cloud.google.com and pick or create a project.</li>
            <li>Go to APIs and services, Library, search YouTube Data API v3 and click Enable.</li>
            <li>Go to Credentials, Create credentials, API key. Copy the key.</li>
            <li>
              Paste it in Settings, API keys as <b>YouTube Data API</b> (owner only).
            </li>
            <li>Channel id: open YouTube Studio, Settings, Channel, Advanced settings. Copy the Channel ID.</li>
          </ol>
        </HowTo>
      </div>
    );

  if (k === "amazon") {
    const current = lines(f.asins).map((a) => a.toUpperCase());
    const missing = suggestions.filter((x) => !current.includes(x.asin));
    return (
      <div className={s.cfg}>
        <Field label="ASINs to read reviews for" hint="Separate with commas. Up to 20.">
          <textarea
            className={s.textarea}
            rows={2}
            value={f.asins}
            disabled={!canEdit}
            placeholder="B0…"
            onChange={(e) => set({ asins: e.target.value })}
          />
        </Field>
        {suggestions.length > 0 && (
          <div className={s.suggest}>
            <span className={s.hint}>
              Top sellers, last 90 days:{" "}
              {suggestions.map((x) => `${x.asin} (${x.units})`).join(", ")}
            </span>
            {canEdit && missing.length > 0 && (
              <button
                type="button"
                className="pm-btn sm"
                onClick={() => set({ asins: [...current, ...missing.map((x) => x.asin)].join(", ") })}
              >
                Use top sellers
              </button>
            )}
          </div>
        )}
        <div className={s.g2}>
          <Field label="Reviews per ASIN each week" hint="5 to 100. More reviews use more of the budget.">
            <input
              className={s.input}
              type="number"
              min={5}
              max={100}
              value={f.perAsin}
              disabled={!canEdit}
              onChange={(e) => set({ perAsin: Number(e.target.value) || 5 })}
            />
          </Field>
          <Field
            label="Apify monthly budget (USD)"
            hint={`Spent this month: $${settings.apify_spent_usd.toFixed(2)}. Amazon pauses when the budget is used.`}
          >
            <input
              className={s.input}
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={f.budget}
              disabled={!canEdit}
              onChange={(e) => set({ budget: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
        <p className={s.cfgNote}>
          Uses the Apify key in Settings, API keys. The free Apify plan gives $5 a month, enough for a weekly check.
        </p>
      </div>
    );
  }
  return null;
}

function CompetitorEditor({
  rows,
  canEdit,
  onChange,
}: {
  rows: CompetitorAsin[];
  canEdit: boolean;
  onChange: (rows: CompetitorAsin[]) => void;
}) {
  const upd = (i: number, p: Partial<CompetitorAsin>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className={s.compEdit}>
      {rows.length === 0 && <p className={s.cfgNote}>No competitors yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className={s.compEditRow}>
          <label className={s.field}>
            <span className={s.label}>ASIN</span>
            <input
              className={s.input}
              value={r.asin}
              maxLength={10}
              placeholder="B0…"
              disabled={!canEdit}
              onChange={(e) => upd(i, { asin: e.target.value.toUpperCase() })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Brand</span>
            <input
              className={s.input}
              value={r.brand}
              maxLength={60}
              placeholder="Brand name"
              disabled={!canEdit}
              onChange={(e) => upd(i, { brand: e.target.value })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>What it is</span>
            <input
              className={s.input}
              value={r.label}
              maxLength={120}
              placeholder="Roasted chana 200g"
              disabled={!canEdit}
              onChange={(e) => upd(i, { label: e.target.value })}
            />
          </label>
          {canEdit && (
            <button
              type="button"
              className={`pm-btn ghost sm ${s.compDel}`}
              aria-label={`Remove ${r.asin || "this row"}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <X size={15} />
            </button>
          )}
        </div>
      ))}
      {canEdit && rows.length < 10 && (
        <button
          type="button"
          className="pm-btn sm"
          style={{ marginTop: 14 }}
          onClick={() => onChange([...rows, { asin: "", brand: "", label: "" }])}
        >
          <Plus size={14} aria-hidden="true" /> Add a competitor
        </button>
      )}
    </div>
  );
}
