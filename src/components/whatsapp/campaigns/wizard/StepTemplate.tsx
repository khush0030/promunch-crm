"use client";

// Step 1: pick an approved template from a visual gallery.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Callout, Pill } from "@/components/pm";
import { renderWhatsApp } from "../../WhatsAppPreview";
import { errorMessage, useApprovedTemplates } from "../api";
import { TemplateThumb } from "../bits";
import { QUALITY_META, isMarketing, sortTemplatesForGallery, type CampaignTemplate } from "../logic";
import s from "../campaigns.module.css";

export const NEW_TEMPLATE_HREF = "/dashboard/whatsapp?tab=templates&new=1";

export function StepTemplate({ value, onPick }: { value: string | null; onPick: (t: CampaignTemplate) => void }) {
  const q = useApprovedTemplates();
  const [search, setSearch] = useState("");
  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sortTemplatesForGallery(q.data ?? []).filter(
      (t) => !needle || t.name.toLowerCase().includes(needle) || (t.body ?? "").toLowerCase().includes(needle),
    );
  }, [q.data, search]);

  return (
    <div className={s.stack}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Pick a message template</h2>
        <p className={s.help} style={{ margin: 0 }}>
          WhatsApp only lets businesses start a chat with a template Meta has approved. <b>Marketing</b> templates are for offers and launches
          and count toward the daily marketing limit. <b>Utility</b> templates are for order and account updates only; Meta moves promotional
          ones to Marketing.
        </p>
      </div>

      <div className={s.toolbar}>
        <div className={s.searchBox}>
          <Search aria-hidden />
          <input className={s.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
        </div>
        <Link href={NEW_TEMPLATE_HREF} className="pm2-btn sm">
          <Plus size={14} aria-hidden /> Create a new template
        </Link>
      </div>

      {q.isError && <Callout tone="crit" title="Couldn't load templates" body={errorMessage(q.error)} />}
      {q.isLoading && <div className="pm2-skel" />}
      {!q.isLoading && (q.data ?? []).length === 0 && (
        <Callout
          tone="plain"
          title="No approved templates yet"
          body="Create a template, send it to Meta, and come back once it shows Approved (usually within a few hours)."
          action={<Link href={NEW_TEMPLATE_HREF} className="pm2-btn sm pri">Create a template</Link>}
        />
      )}

      <div className={s.gallery} role="radiogroup" aria-label="Approved templates">
        {list.map((t) => {
          const on = t.id === value;
          const quality = QUALITY_META[String(t.quality_score ?? "").toUpperCase()];
          const missingMedia = !!t.needs_media || (["IMAGE", "VIDEO", "DOCUMENT"].includes(String(t.header_type ?? "").toUpperCase()) && !t.header_media_url);
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`${s.tplCard} ${on ? s.tplCardOn : ""}`}
              onClick={() => onPick(t)}
            >
              {t.header_type && String(t.header_type).toUpperCase() !== "TEXT" && <TemplateThumb tpl={t} className={s.tplMedia} />}
              <div className={s.tplBubble}>
                <div>
                  {t.header_type === "TEXT" && t.header_text && <b style={{ display: "block" }}>{t.header_text}</b>}
                  {renderWhatsApp(t.body ?? "")}
                </div>
              </div>
              <div className={s.tplName}>{t.name}</div>
              <div className={s.inline}>
                <Pill tone={isMarketing(t) ? "brand" : "info"}>{isMarketing(t) ? "Marketing" : "Utility"}</Pill>
                {quality && <Pill tone={quality.tone}>{quality.label}</Pill>}
                {missingMedia && <Pill tone="warn">Needs a picture</Pill>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
