"use client";

// Edit a saved template in the builder (autosaves).

import { use, useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Callout } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import Link from "next/link";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { Builder } from "@/components/email-studio/Builder";
import { NewCampaignButton } from "@/components/email-studio/NewCampaignButton";
import { useStudioSettings } from "@/components/email-studio/hooks";
import { getJson, sendJson } from "@/components/email-studio/api";
import { parseDesign, type EmailDesign } from "@/lib/email-studio/design";
import s from "@/components/email-studio/studio.module.css";

type T = { id: string; name: string; subject: string | null; preview_text: string | null; design: unknown };

export default function TemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["email-studio-template", id], queryFn: () => getJson<{ template: T }>(`/api/email-studio/templates/${id}`) });
  if (q.isLoading) return <div className="pm2-body"><div className="pm2-skel" style={{ minHeight: 500 }} /></div>;
  if (q.error || !q.data) {
    return (
      <>
        <StudioHeader tab="templates" title="Template" back={{ href: "/dashboard/email/templates", label: "Templates" }} />
        <div className="pm2-body"><Callout tone="crit" title="Could not open this template" body={(q.error as Error)?.message} /></div>
      </>
    );
  }
  return <Edit key={id} t={q.data.template} />;
}

function Edit({ t }: { t: T }) {
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useStudioSettings();
  const [name, setName] = useState(t.name);
  const [subject, setSubject] = useState(t.subject ?? "");
  const [preview, setPreview] = useState(t.preview_text ?? "");
  const [design, setDesign] = useState<EmailDesign | null>(parseDesign(t.design));
  const [saved, setSaved] = useState(true);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queue = useCallback(
    (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      setSaved(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const body = pending.current;
        pending.current = {};
        try {
          await sendJson(`/api/email-studio/templates/${t.id}`, "PATCH", body);
          setSaved(Object.keys(pending.current).length === 0);
          qc.invalidateQueries({ queryKey: ["email-studio-templates"] });
        } catch (e) {
          pending.current = { ...body, ...pending.current };
          toast.push({ kind: "error", text: `Not saved: ${(e as Error).message}` });
        }
      }, 800);
    },
    [t.id, qc, toast],
  );

  const brand = settings.data?.settings.brand;
  return (
    <>
      <StudioHeader
        tab="templates"
        title={name}
        back={{ href: "/dashboard/email/templates", label: "Templates" }}
        summary={
          <>
            Changes save as you go. Colours and fonts come from{" "}
            <Link className="pm2-lnk" href="/dashboard/email/settings">Brand &amp; email</Link>, so every template matches.
          </>
        }
        actions={
          <>
            <span className={s.hint}>{saved ? "All changes saved" : "Saving…"}</span>
            <NewCampaignButton templateId={t.id} label="Use in a campaign" name={name} />
          </>
        }
      />
      <div className="pm2-body">
        <div className="pm2-panel" style={{ padding: 16 }}>
          <div className="pm2-g3">
            <label className={s.field}><span>Template name</span><input className={s.input} value={name} onChange={(e) => { setName(e.target.value); queue({ name: e.target.value }); }} /></label>
            <label className={s.field}><span>Default subject</span><input className={s.input} value={subject} onChange={(e) => { setSubject(e.target.value); queue({ subject: e.target.value }); }} /></label>
            <label className={s.field}><span>Default preview text</span><input className={s.input} value={preview} onChange={(e) => { setPreview(e.target.value); queue({ preview_text: e.target.value }); }} /></label>
          </div>
        </div>
        {design && brand ? (
          <Builder design={design} brand={brand} subject={subject} previewText={preview} onChange={(d) => { setDesign(d); queue({ design: d }); }} />
        ) : (
          <div className="pm2-skel" style={{ minHeight: 500 }} />
        )}
      </div>
    </>
  );
}
