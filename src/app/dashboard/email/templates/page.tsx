"use client";

// Template library: PROMUNCH built-ins (Diwali first) + the team's saved
// templates. "Use" starts a campaign from it; saved ones can be edited.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { Callout, ConfirmDialog, Pill } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { NewCampaignButton } from "@/components/email-studio/NewCampaignButton";
import { useProducts } from "@/components/email-studio/Builder";
import { useStudioSettings } from "@/components/email-studio/hooks";
import { getJson, sendJson, when } from "@/components/email-studio/api";
import { renderDesign, SAMPLE_MERGE } from "@/lib/email-studio/render";
import { parseDesign, type BrandKit, type EmailDesign, type ProductInfo } from "@/lib/email-studio/design";
import s from "@/components/email-studio/studio.module.css";

type Sys = { key: string; name: string; category: string; description: string; subject: string; design: EmailDesign };
type Saved = { id: string; name: string; category: string; subject: string | null; design: unknown; created_by: string | null; updated_at: string };

const CATS: Record<string, string> = { diwali: "Diwali", launch: "Launch", sale: "Sale", newsletter: "Newsletter", winback: "Win-back", basic: "Basic", custom: "Saved" };

function Thumb({ design, brand, products }: { design: EmailDesign | null; brand?: BrandKit; products: Record<string, ProductInfo> }) {
  const html = useMemo(
    () => (design && brand ? renderDesign(design, { brand, products, unsubscribeUrl: "#", merge: SAMPLE_MERGE }) : ""),
    [design, brand, products],
  );
  return <div className={s.thumb}>{html && <iframe title="Template preview" srcDoc={html.replace("<body ", "<body class=\"thumb\" ").replace("</head>", "<style>html,body{overflow:hidden}.pm-card{border-radius:0!important}</style></head>")} loading="lazy" tabIndex={-1} scrolling="no" />}</div>;
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<div className="pm2-body"><div className="pm2-skel" /></div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const picking = params.get("pick") === "1";
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useStudioSettings();
  const productsQ = useProducts();
  const products = useMemo(() => Object.fromEntries((productsQ.data ?? []).map((p) => [p.id, p])), [productsQ.data]);
  const q = useQuery({
    queryKey: ["email-studio-templates"],
    queryFn: () => getJson<{ system: Sys[]; saved: Saved[]; savedError?: string }>("/api/email-studio/templates"),
  });
  const [del, setDel] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const brand = settings.data?.settings.brand;

  return (
    <>
      <StudioHeader tab="templates" title={picking ? "Pick a starting point" : "Templates"} />
      <div className="pm2-body">
        {picking && <Callout tone="plain" title="New campaign" body="Choose a template to start from. You can change everything in the builder." />}
        {q.data?.savedError && <Callout tone="sun" title="Saved templates unavailable" body={q.data.savedError} />}

        {!!q.data?.saved.length && (
          <>
            <h3 style={{ margin: "4px 0 0", fontSize: 15.5 }}>Your templates</h3>
            <div className={s.gallery}>
              {q.data.saved.map((t) => (
                <div key={t.id} className={s.tpl}>
                  <Thumb design={parseDesign(t.design)} brand={brand} products={products} />
                  <div className={s.tplBody}>
                    <div className={s.row}>
                      <h4 className={s.grow}>{t.name}</h4>
                      <Link href={`/dashboard/email/templates/${t.id}`} className={s.iconBtn} aria-label="Edit template"><Pencil /></Link>
                      <button type="button" className={s.iconBtn} aria-label="Delete template" onClick={() => setDel(t)}><Trash2 /></button>
                    </div>
                    <p>{t.subject || "No subject"} · edited {when(t.updated_at)}</p>
                    <div style={{ marginTop: 6 }}><NewCampaignButton templateId={t.id} label="Use this" primary={false} name={t.name} /></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <h3 style={{ margin: "8px 0 0", fontSize: 15.5 }}>PROMUNCH library</h3>
        {q.isLoading ? (
          <div className="pm2-skel" />
        ) : (
          <div className={s.gallery}>
            {(q.data?.system ?? []).map((t) => (
              <div key={t.key} className={s.tpl}>
                <Thumb design={t.design} brand={brand} products={products} />
                <div className={s.tplBody}>
                  <div className={s.row}>
                    <h4 className={s.grow}>{t.name}</h4>
                    <Pill tone={t.category === "diwali" ? "brand" : "neu"}>{CATS[t.category] ?? t.category}</Pill>
                  </div>
                  <p>{t.description}</p>
                  <div style={{ marginTop: 6 }}><NewCampaignButton templateKey={t.key} label="Use this" primary={t.category === "diwali"} name={t.name} /></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {del && (
        <ConfirmDialog
          title={`Delete template "${del.name}"?`}
          body="Campaigns already made from it are not affected."
          confirmLabel="Delete"
          danger
          busy={busy}
          onClose={() => setDel(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await sendJson(`/api/email-studio/templates/${del.id}`, "DELETE");
              qc.invalidateQueries({ queryKey: ["email-studio-templates"] });
              setDel(null);
            } catch (e) {
              toast.push({ kind: "error", text: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
