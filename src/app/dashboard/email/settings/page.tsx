"use client";

// Brand kit (logo, colours, footer, social links) + send guardrails
// (warm-up cap, approval threshold). Everyone can see; admins edit.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Callout } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { ImagePicker } from "@/components/email-studio/Builder";
import { useStudioSettings } from "@/components/email-studio/hooks";
import { sendJson } from "@/components/email-studio/api";
import type { BrandKit, Theme } from "@/lib/email-studio/design";
import s from "@/components/email-studio/studio.module.css";
import l from "@/components/email-studio/list.module.css";

const COLORS: { key: keyof Omit<Theme, "font">; label: string }[] = [
  { key: "background", label: "Page background" },
  { key: "content", label: "Email background" },
  { key: "text", label: "Text" },
  { key: "accent", label: "Accent" },
  { key: "button", label: "Button" },
  { key: "buttonText", label: "Button text" },
];

export default function StudioSettingsPage() {
  const q = useStudioSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [brand, setBrand] = useState<BrandKit | null>(null);
  const [warmOn, setWarmOn] = useState(true);
  const [warmMax, setWarmMax] = useState(150);
  const [threshold, setThreshold] = useState(2000);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setBrand(q.data.settings.brand);
    setWarmOn(q.data.settings.warmup_max_recipients != null);
    setWarmMax(q.data.settings.warmup_max_recipients ?? 150);
    setThreshold(q.data.settings.approval_threshold);
  }, [q.data]);

  const canEdit = !!q.data?.canEdit;
  if (!brand) return <><StudioHeader tab="settings" title="Brand & settings" /><div className="pm2-body"><div className="pm2-skel" /></div></>;
  const set = (p: Partial<BrandKit>) => setBrand({ ...brand, ...p });

  const save = async () => {
    setBusy(true);
    try {
      await sendJson("/api/email-studio/settings", "PUT", {
        brand,
        approval_threshold: threshold,
        warmup_max_recipients: warmOn ? warmMax : null,
      });
      qc.invalidateQueries({ queryKey: ["email-studio-settings"] });
      toast.push({ kind: "success", text: "Settings saved." });
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <StudioHeader
        tab="settings"
        title="Brand & settings"
        actions={canEdit ? <button type="button" className="pm2-btn pri" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button> : undefined}
      />
      <div className="pm2-body">
        <p className={l.sum}>One brand kit for every email: logo, colours, fonts and footer. Customer email always sends from <b>hello@promunch.in</b>.</p>
        {!canEdit && <Callout tone="plain" title="View only" body="Only an admin can change the brand kit and sending rules." />}
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 16 }}>
          <div className="pm2-g2">
            <div className="pm2-panel" style={{ padding: 16, display: "grid", gap: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Logo and footer</h3>
              <label className={s.field}><span>Logo <em>transparent PNG, about 400px wide</em></span></label>
              <ImagePicker value={brand.logoUrl} onChange={(logoUrl) => set({ logoUrl })} />
              <label className={s.field}>
                <span>Logo width in the email <em>{brand.logoWidth}px</em></span>
                <input type="range" min={80} max={280} step={10} value={brand.logoWidth} onChange={(e) => set({ logoWidth: Number(e.target.value) })} />
              </label>
              <label className={s.field}><span>Tagline</span><input className={s.input} value={brand.tagline} onChange={(e) => set({ tagline: e.target.value })} /></label>
              <label className={s.field}>
                <span>Postal address <em>required by law in every marketing email</em></span>
                <input className={s.input} value={brand.footerAddress} placeholder="PROMUNCH, street, city, PIN" onChange={(e) => set({ footerAddress: e.target.value })} />
              </label>
            </div>
            <div className="pm2-panel" style={{ padding: 16, display: "grid", gap: 14, alignContent: "start" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Links</h3>
              {(["website", "instagram", "facebook", "youtube"] as const).map((k) => (
                <label key={k} className={s.field}>
                  <span style={{ textTransform: "capitalize" }}>{k}</span>
                  <input className={s.input} placeholder="https://" value={brand[k]} onChange={(e) => set({ [k]: e.target.value.trim() } as Partial<BrandKit>)} />
                </label>
              ))}
              <h3 style={{ margin: "8px 0 0", fontSize: 16 }}>Default colours for new emails</h3>
              <div className={s.swatches}>
                {COLORS.map((c) => (
                  <label key={c.key} className={s.swatch}>
                    <input type="color" value={brand.theme[c.key]} onChange={(e) => set({ theme: { ...brand.theme, [c.key]: e.target.value } })} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="pm2-panel" style={{ padding: 16, display: "grid", gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Sending rules</h3>
            <label className={s.row} style={{ fontSize: 14 }}>
              <input type="checkbox" checked={warmOn} onChange={(e) => setWarmOn(e.target.checked)} />
              <b>Domain warm-up</b>: cap each campaign at
              <input className={s.input} type="number" min={10} style={{ width: 90 }} value={warmMax} disabled={!warmOn || !canEdit} onChange={(e) => setWarmMax(Math.max(1, Number(e.target.value) || 1))} />
              people, and require approval for every campaign.
            </label>
            <div className={s.hint}>
              A new sending domain has no reputation yet. Raise the cap roughly weekly (150, 300, 600, then off) while bounces stay under 2% and spam complaints under 0.1%.
            </div>
            <label className={s.row} style={{ fontSize: 14 }}>
              After warm-up, campaigns to more than
              <input className={s.input} type="number" min={1} style={{ width: 100 }} value={threshold} onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))} />
              people need an admin&apos;s approval.
            </label>
          </div>
        </fieldset>
      </div>
    </>
  );
}
