"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, Save } from "lucide-react";
import { PageHeader, Card, Callout } from "@/components/pm";
import type { HealthResponse } from "@/app/api/brevo/health/route";
import type { AudienceResponse } from "@/app/api/brevo/audience/route";
import type { BrevoTemplate } from "@/app/api/brevo/templates/route";
import type { EditorCampaign } from "@/app/api/brevo/campaigns/[id]/editor/route";
import { copyProblems, visibleText } from "@/lib/brevo-send-guard";
import { getJson, sendJson, errorText, Note, field, inputStyle, useInvalidate } from "./format";
import { campaignsKey } from "./CampaignsTab";

// Create / edit a Brevo email campaign. Saving never sends: sending happens
// from the campaign page after a test send (see CampaignActions).

type Form = {
  name: string;
  subject: string;
  previewText: string;
  senderId: number | null;
  replyTo: string;
  contentMode: "html" | "template";
  htmlContent: string;
  templateId: number | null;
  listIds: number[];
  exclusionListIds: number[];
  tag: string;
  utmCampaign: string;
};

const EMPTY: Form = {
  name: "",
  subject: "",
  previewText: "",
  senderId: null,
  replyTo: "hello@promunch.in",
  contentMode: "html",
  htmlContent: "<p>Hi {{ contact.FIRSTNAME | default : \"there\" }},</p>\n<p></p>\n<p>PROMUNCH, Your Munchy Pal</p>",
  templateId: null,
  listIds: [],
  exclusionListIds: [],
  tag: "",
  utmCampaign: "",
};

export function CampaignEditor({ id }: { id?: number }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  // Campaigns built in Brevo's drag-and-drop editor come back with no HTML.
  const [builderContent, setBuilderContent] = useState(false);

  const health = useQuery({ queryKey: ["brevo-health"], queryFn: () => getJson<HealthResponse>("/api/brevo/health") });
  const audience = useQuery({ queryKey: ["brevo-audience"], queryFn: () => getJson<AudienceResponse>("/api/brevo/audience") });
  const templates = useQuery({ queryKey: ["brevo-templates"], queryFn: () => getJson<{ templates: BrevoTemplate[] }>("/api/brevo/templates") });
  const existing = useQuery({
    queryKey: ["brevo-campaign-editor", id],
    queryFn: () => getJson<EditorCampaign>(`/api/brevo/campaigns/${id}/editor`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!existing.data || loaded) return;
    const c = existing.data;
    setForm({
      name: c.name,
      subject: c.subject,
      previewText: c.previewText,
      senderId: c.senderId,
      replyTo: c.replyTo,
      contentMode: "html",
      htmlContent: c.htmlContent,
      templateId: null,
      listIds: c.listIds,
      exclusionListIds: c.exclusionListIds,
      tag: c.tag,
      utmCampaign: c.utmCampaign,
    });
    setStatus(c.status);
    setBuilderContent(!c.htmlContent.trim());
    setLoaded(true);
  }, [existing.data, loaded]);

  const senders = useMemo(() => (health.data?.senders.state === "ok" ? health.data.senders.data.filter((s) => s.active) : []), [health.data]);
  const lists = audience.data?.lists.state === "ok" ? audience.data.lists.data : [];
  const settings = audience.data?.settings;
  const testMode = settings?.sync_target !== "live";

  useEffect(() => {
    if (form.senderId == null && senders.length) setForm((f) => ({ ...f, senderId: senders.find((s) => s.email === "hello@promunch.in")?.id ?? senders[0].id }));
  }, [senders, form.senderId]);

  const copyWarnings = useMemo(() => {
    const w: string[] = [];
    for (const p of copyProblems(visibleText(form.subject))) w.push(`Subject ${p}`);
    for (const p of copyProblems(visibleText(form.previewText))) w.push(`Preview text ${p}`);
    if (form.contentMode === "html") for (const p of copyProblems(visibleText(form.htmlContent))) w.push(`Body ${p}`);
    return w;
  }, [form]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: "listIds" | "exclusionListIds", lid: number) =>
    setForm((f) => ({ ...f, [k]: f[k].includes(lid) ? f[k].filter((x) => x !== lid) : [...f[k], lid] }));

  const editable = !status || status === "draft" || status === "suspended";

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      subject: form.subject,
      previewText: form.previewText,
      senderId: form.senderId ?? undefined,
      replyTo: form.replyTo,
      ...(form.contentMode === "html" ? { htmlContent: form.htmlContent } : { templateId: form.templateId ?? undefined }),
      listIds: form.listIds,
      exclusionListIds: form.exclusionListIds,
      tag: form.tag,
      utmCampaign: form.utmCampaign,
    };
    try {
      if (id) {
        await sendJson(`/api/brevo/campaigns/${id}/editor`, "PUT", body);
        await invalidate(campaignsKey, ["brevo-campaign", String(id)], ["brevo-campaign-editor", id], ["brevo-preflight"]);
        router.push(`/dashboard/marketing/email/${id}`);
      } else {
        const r = await sendJson<{ id: number }>("/api/brevo/campaigns", "POST", body);
        await invalidate(campaignsKey);
        router.push(`/dashboard/marketing/email/${r.id}`);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const title = id ? `Edit ${existing.data?.name ?? "campaign"}` : "New email campaign";
  const back = (
    <Link className="pm2-btn sm" href={id ? `/dashboard/marketing/email/${id}` : "/dashboard/marketing/email"}>
      <ArrowLeft size={14} /> Back
    </Link>
  );

  if (id && (existing.isLoading || !loaded)) {
    return (
      <>
        <PageHeader crumb="Marketing · Email (Brevo)" title={title} actions={back} />
        <div className="pm2-body">
          {existing.isError ? <Callout tone="crit" title="Couldn't load campaign" body={errorText(existing.error)} /> : <div className="pm2-skel" />}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumb="Marketing · Email (Brevo)"
        title={title}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            {back}
            <button type="button" className="pm2-btn pri sm" disabled={busy || !editable} onClick={save}>
              <Save size={14} /> {busy ? "Saving…" : "Save draft"}
            </button>
          </div>
        }
      />
      <div className="pm2-body">
        {!editable && <Callout tone="sun" title={`This campaign is "${status}"`} body="Only drafts and suspended campaigns can be edited." />}
        <Callout
          tone="plain"
          title="Saving never sends"
          body="After saving, open the campaign, send a test to the test addresses, then send or schedule. Any edit after a test needs a new test."
        />
        {error && <Callout tone="crit" title="Not saved" body={error} />}
        {builderContent && (
          <Callout
            tone="sun"
            title="Content was built in Brevo's drag-and-drop editor"
            body="Brevo doesn't expose that content through its API, so the body below is empty. Leave it empty to keep the Brevo design (saving only changes the other fields), or paste HTML to replace it."
          />
        )}

        <div className="pm2-g21">
          <Card title="Message">
            <div style={{ display: "grid", gap: 14 }}>
              <label style={field}>
                Campaign name (internal)
                <input style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Diwali 2026 boxes" />
              </label>
              <label style={field}>
                Subject
                <input style={inputStyle} value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Your PROMUNCH Diwali box is here" />
              </label>
              <label style={field}>
                Preview text (shown after the subject in the inbox)
                <input style={inputStyle} value={form.previewText} onChange={(e) => set("previewText", e.target.value)} />
              </label>
              <div style={{ display: "flex", gap: 8 }} role="tablist">
                {(["html", "template"] as const).map((m) => (
                  <button key={m} type="button" className={`pm2-btn sm${form.contentMode === m ? " dark" : ""}`} onClick={() => set("contentMode", m)} disabled={Boolean(id) && m === "template"}>
                    {m === "html" ? "HTML" : "Brevo template"}
                  </button>
                ))}
                {form.contentMode === "html" && (
                  <button type="button" className="pm2-btn sm ghost" onClick={() => setPreview((p) => !p)}>
                    <Eye size={14} /> {preview ? "Hide preview" : "Preview"}
                  </button>
                )}
              </div>
              {form.contentMode === "html" ? (
                <>
                  <label style={field}>
                    Email HTML. Personalise with {"{{ contact.FIRSTNAME }}"}; unique coupons with {"{{ coupon.COLLECTION_NAME }}"}.
                    <textarea style={{ ...inputStyle, minHeight: 280, fontFamily: "var(--pm-mono, monospace)", fontSize: 12.5 }} value={form.htmlContent} onChange={(e) => set("htmlContent", e.target.value)} />
                  </label>
                  {preview && (
                    <iframe title="Email preview" sandbox="" srcDoc={form.htmlContent} style={{ width: "100%", height: 420, border: "1px solid var(--pm-border)", borderRadius: 8, background: "#fff" }} />
                  )}
                </>
              ) : (
                <label style={field}>
                  Template
                  <select style={inputStyle} value={form.templateId ?? ""} onChange={(e) => set("templateId", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Pick a template</option>
                    {(templates.data?.templates ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {copyWarnings.length > 0 && <Note tone="err">{copyWarnings.join("\n")}</Note>}
            </div>
          </Card>

          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <Card title="From">
              <div style={{ display: "grid", gap: 12 }}>
                <label style={field}>
                  Sender
                  <select style={inputStyle} value={form.senderId ?? ""} onChange={(e) => set("senderId", Number(e.target.value))}>
                    {senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} &lt;{s.email}&gt;
                      </option>
                    ))}
                  </select>
                </label>
                <label style={field}>
                  Reply-to
                  <input style={inputStyle} value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
                </label>
              </div>
            </Card>

            <Card title="Send to" basis={testMode ? "test mode: only the PROMUNCH TEST list can be sent" : "live audience"}>
              {audience.isLoading ? (
                <div className="pm2-skel" />
              ) : (
                <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
                  {lists.map((l) => (
                    <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" checked={form.listIds.includes(l.id)} onChange={() => toggle("listIds", l.id)} />
                      <span style={{ flex: 1 }}>{l.name}</span>
                      <span style={{ color: "var(--pm-muted)" }}>{l.uniqueSubscribers.toLocaleString("en-IN")}</span>
                    </label>
                  ))}
                  {lists.length === 0 && <div className="pm2-empty">No lists yet. Run a test sync in the Audience tab.</div>}
                  {lists.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer", color: "var(--pm-muted)" }}>Exclude lists</summary>
                      {lists.map((l) => (
                        <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                          <input type="checkbox" checked={form.exclusionListIds.includes(l.id)} onChange={() => toggle("exclusionListIds", l.id)} />
                          {l.name}
                        </label>
                      ))}
                    </details>
                  )}
                </div>
              )}
            </Card>

            <Card title="Tracking">
              <div style={{ display: "grid", gap: 12 }}>
                <label style={field}>
                  UTM campaign (tags every link, so orders can be attributed)
                  <input style={inputStyle} value={form.utmCampaign} onChange={(e) => set("utmCampaign", e.target.value)} placeholder="diwali_2026" />
                </label>
                <label style={field}>
                  Tag
                  <input style={inputStyle} value={form.tag} onChange={(e) => set("tag", e.target.value)} />
                </label>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
