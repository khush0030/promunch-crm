"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { Card, Callout, ConfirmDialog, Table, Pill } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { CouponCollection } from "@/app/api/brevo/coupons/route";
import { parseCouponCodes } from "@/lib/brevo-coupons";
import { getJson, sendJson, errorText, Note, field, inputStyle, int, day, SectionView, ErrorCallout, useBrevoSettings, useInvalidate, type SectionState } from "./format";

// Brevo coupon collections: one unique code per email recipient.

export function CouponsTab() {
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["brevo-coupons"], queryFn: () => getJson<{ collections: SectionState<CouponCollection[]> }>("/api/brevo/coupons") });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [create, setCreate] = useState({ name: "", defaultCoupon: "", expirationDate: "", remainingCouponsAlert: "" });
  const [upload, setUpload] = useState<{ id: string; codes: string } | null>(null);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const isOwner = useBrevoSettings().data?.isOwner === true;

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: "ok", text: await fn() });
      await invalidate(["brevo-coupons"]);
      return true;
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <div className="pm2-skel" />;
  if (q.isError || !q.data) return <ErrorCallout title="Couldn't load coupons" error={q.error} onRetry={() => q.refetch()} />;

  const parsed = upload ? parseCouponCodes(upload.codes) : null;
  const cols: TableCol<CouponCollection>[] = [
    {
      h: "Collection",
      render: (c) => (
        <>
          {c.name}
          <span className="sub">
            merge tag <code>{`{{ coupon.${c.name} }}`}</code> · fallback {c.defaultCoupon}
          </span>
        </>
      ),
    },
    {
      h: "Left",
      num: true,
      render: (c) => (
        <>
          {int(c.remainingCoupons)} / {int(c.totalCoupons)}{" "}
          {c.remainingCouponsAlert != null && c.remainingCoupons <= c.remainingCouponsAlert && <Pill tone="warn">low</Pill>}
        </>
      ),
    },
    { h: "Expires", render: (c) => (c.expirationDate ? day(c.expirationDate) : "never") },
    {
      h: "",
      render: (c) => (
        <button type="button" className="pm2-btn sm" onClick={() => setUpload({ id: c.id, codes: "" })}>
          <Upload size={14} /> Add codes
        </button>
      ),
    },
  ];

  return (
    <>
      <Callout
        tone="plain"
        title="Unique codes, one per person"
        body="Create the discount in Shopify first (for example a single-use, time-limited 10% code set), export its codes, and paste them here. In a campaign, {{ coupon.NAME }} inserts the next unused code. When codes run out, the fallback code is used, so keep an eye on the count."
      />
      {q.data.collections.state === "gated" && (
        <Callout
          tone="sun"
          title="Coupons need Brevo's eCommerce section"
          body={`Brevo refused (${q.data.collections.message}). Coupons and Brevo revenue attribution only work once the eCommerce app is on in Brevo. If it stays refused after that, the plan doesn't include coupons.`}
          action={
            isOwner ? (
              <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => setConfirmActivate(true)}>
                Turn on eCommerce
              </button>
            ) : undefined
          }
        />
      )}
      <SectionView s={q.data.collections.state === "gated" ? { state: "ok", data: [] } : q.data.collections} gatedTitle="Brevo won't allow coupons on this account yet">
        {(collections) => (
          <Card title="Coupon collections" basis={`${collections.length} in Brevo`}>
            <Table cols={cols} rows={collections} rowKey={(c) => c.id} card={(c) => ({ title: c.name, value: `${int(c.remainingCoupons)} left`, meta: `fallback ${c.defaultCoupon}` })} empty="No collections yet" />
            {upload && parsed && (
              <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 12, marginTop: 12, display: "grid", gap: 8 }}>
                <label style={field}>
                  Paste codes for {collections.find((c) => c.id === upload.id)?.name} (comma, space or one per line)
                  <textarea style={{ ...inputStyle, minHeight: 140, fontFamily: "var(--pm-mono, monospace)" }} value={upload.codes} onChange={(e) => setUpload({ ...upload, codes: e.target.value })} />
                </label>
                <Note tone={parsed.invalid.length ? "err" : "muted"}>
                  {int(parsed.codes.length)} unique codes{parsed.duplicates ? `, ${parsed.duplicates} duplicates ignored` : ""}
                  {parsed.invalid.length ? `. Invalid: ${parsed.invalid.slice(0, 5).join(", ")}` : ""}
                </Note>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="pm2-btn pri sm"
                    disabled={busy != null || parsed.codes.length === 0 || parsed.invalid.length > 0}
                    onClick={async () => {
                      const ok = await act("upload", async () => {
                        const r = await sendJson<{ added: number }>("/api/brevo/coupons", "POST", { action: "add_codes", id: upload.id, codes: upload.codes });
                        return `${int(r.added)} codes added.`;
                      });
                      if (ok) setUpload(null);
                    }}
                  >
                    Upload codes
                  </button>
                  <button type="button" className="pm2-btn sm" onClick={() => setUpload(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}
      </SectionView>

      <Card title="New collection">
        <div className="pm2-g2">
          <label style={field}>
            Name (used in the merge tag: letters, numbers, - and _)
            <input style={inputStyle} value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} placeholder="DIWALI10" />
          </label>
          <label style={field}>
            Fallback code (when unique codes run out)
            <input style={inputStyle} value={create.defaultCoupon} onChange={(e) => setCreate({ ...create, defaultCoupon: e.target.value })} placeholder="PROMUNCH10" />
          </label>
          <label style={field}>
            Expires on (optional)
            <input type="date" style={inputStyle} value={create.expirationDate} onChange={(e) => setCreate({ ...create, expirationDate: e.target.value })} />
          </label>
          <label style={field}>
            Email an alert when fewer than N codes are left (optional)
            <input type="number" min={1} style={inputStyle} value={create.remainingCouponsAlert} onChange={(e) => setCreate({ ...create, remainingCouponsAlert: e.target.value })} />
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="pm2-btn pri sm"
            disabled={busy != null || !create.name.trim() || !create.defaultCoupon.trim()}
            onClick={() =>
              act("create", async () => {
                await sendJson("/api/brevo/coupons", "POST", {
                  action: "create",
                  name: create.name.trim(),
                  defaultCoupon: create.defaultCoupon.trim(),
                  ...(create.expirationDate ? { expirationDate: `${create.expirationDate}T23:59:59+05:30` } : {}),
                  ...(create.remainingCouponsAlert ? { remainingCouponsAlert: Number(create.remainingCouponsAlert) } : {}),
                });
                setCreate({ name: "", defaultCoupon: "", expirationDate: "", remainingCouponsAlert: "" });
                return "Collection created. Add codes next.";
              })
            }
          >
            <Plus size={14} /> Create collection
          </button>
        </div>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      </Card>
      {confirmActivate && (
        <ConfirmDialog
          title="Turn on Brevo eCommerce?"
          body="This switches on Brevo's eCommerce app for the account (products, orders, coupons, revenue attribution). It doesn't send anything to customers. Check Brevo's pricing page if your plan has limits on it."
          confirmLabel="Turn on"
          busy={busy === "activate"}
          onConfirm={async () => {
            await act("activate", async () => {
              await sendJson("/api/brevo/coupons", "POST", { action: "activate_ecommerce" });
              return "eCommerce activation requested. Reload in a minute.";
            });
            setConfirmActivate(false);
          }}
          onClose={() => setConfirmActivate(false)}
        />
      )}
    </>
  );
}
