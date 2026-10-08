"use client";

// Creators tab: every creator we have worked with, how reliable they are, and
// a profile drawer to fix their details.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { EmptyState, Pill, SearchBar, type PillTone } from "@/components/pm";
import type {
  DealListItem,
  Influencer,
  InfluencerAddress,
  InfluencerListItem,
  InfluencerStatus,
  Reliability,
} from "@/lib/influencers/types";
import { api, errText, QK } from "./api";
import {
  CloseBtn,
  Drawer,
  Field,
  HealthChip,
  Initial,
  NICHES,
  STAGE_LABEL,
  Section,
  SortPicker,
  TIER_LABEL,
  TierTag,
  at,
  compact,
  pct,
  relDay,
  shortDate,
  useCreators,
} from "./ui";
import s from "../influencers.module.css";

const STATUS_TONE: Record<InfluencerStatus, PillTone> = {
  active: "good",
  paused: "warn",
  blocked: "crit",
};

/** On-time share as a status: good from 90%, watch from 60%, else late. */
function OnTime({ pctVal }: { pctVal: number | null | undefined }) {
  if (pctVal == null) return <Pill tone="neu">New</Pill>;
  const v = Math.round(pctVal);
  return <Pill tone={v >= 90 ? "good" : v >= 60 ? "warn" : "crit"}>{v}%</Pill>;
}
const STATUS_LABEL: Record<InfluencerStatus, string> = { active: "Active", paused: "Paused", blocked: "Do not work with" };

function cap(v: string): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

type SortKey = "handle" | "followers" | "er" | "open" | "ontime" | "last";

export function CreatorsTab({ onOpenDeal }: { onOpenDeal: (id: string) => void }) {
  const creators = useCreators();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "last", dir: -1 });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@/, "");
    const list = (creators.data ?? []).filter(
      (c) =>
        !needle ||
        [c.handle, c.full_name, c.city, ...(c.niche ?? [])]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(needle)),
    );
    const val = (c: InfluencerListItem): string | number => {
      switch (sort.key) {
        case "handle":
          return c.handle.toLowerCase();
        case "followers":
          return c.followers ?? -1;
        case "er":
          return c.engagement_rate ?? -1;
        case "open":
          return c.open_deals ?? 0;
        case "ontime":
          return c.reliability?.on_time_pct ?? -1;
        case "last":
          return c.last_contact_at ?? "";
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return va < vb ? -sort.dir : va > vb ? sort.dir : 0;
    });
  }, [creators.data, q, sort]);

  const pick = (key: SortKey) =>
    setSort((p) => ({ key, dir: p.key === key ? (p.dir === 1 ? -1 : 1) : key === "handle" ? 1 : -1 }));
  const th = (key: SortKey, label: string, align?: "right") => (
    <th
      className={s.sortTh}
      style={{ textAlign: align }}
      onClick={() => pick(key)}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <>
      <div className={s.filters} style={{ marginTop: 0 }}>
        <span className={s.muted}>
          {creators.data ? `${creators.data.length} creator${creators.data.length === 1 ? "" : "s"}` : ""}
        </span>
        <span className={s.spacer} />
        <SearchBar value={q} onChange={setQ} placeholder="Search handle, name, city, niche…" />
      </div>

      {creators.isLoading ? (
        <p className={s.hint} style={{ padding: 20 }}>
          Loading creators…
        </p>
      ) : creators.error ? (
        <p className={s.err} style={{ padding: 20 }}>
          {errText(creators.error)}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users />} title={creators.data?.length ? "Nothing matches" : "No creators yet"} style={{ marginTop: 14 }}>
          {creators.data?.length ? "Try a different search." : "Creators are saved automatically when you add a collab on the Board."}
        </EmptyState>
      ) : (
        <>
        <SortPicker
          sort={sort}
          pick={pick}
          options={[
            { key: "last", label: "Last contact" },
            { key: "handle", label: "Creator" },
            { key: "followers", label: "Followers" },
            { key: "er", label: "ER" },
            { key: "open", label: "Open collabs" },
            { key: "ontime", label: "On time" },
          ]}
        />
        <div className={s.tblCard}>
          <div className="pm-tablewrap">
            <table className={`pm-tbl ${s.tbl}`}>
              <thead>
                <tr>
                  {th("handle", "Creator")}
                  {th("followers", "Followers", "right")}
                  {th("er", "ER", "right")}
                  <th>Niche</th>
                  {th("open", "Open", "right")}
                  {th("ontime", "On time")}
                  {th("last", "Last contact")}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)}>
                    <td className={s.mainCell}>
                      <b>{at(c.handle)}</b>
                      <span>{[c.full_name, c.city, c.tier ? TIER_LABEL[c.tier] : null].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td data-l="Followers" className={`${s.r} ${s.num}`}>{compact(c.followers)}</td>
                    <td data-l="ER" className={`${s.r} ${s.num}`}>{pct(c.engagement_rate)}</td>
                    <td data-l="Niche">{(c.niche ?? []).map(cap).join(", ")}</td>
                    <td data-l="Open collabs" className={`${s.r} ${s.num}`}>{c.open_deals ?? 0}</td>
                    <td data-l="On time">
                      <OnTime pctVal={c.reliability?.on_time_pct} />
                    </td>
                    <td data-l="Last contact">{c.last_contact_at ? relDay(c.last_contact_at) : ""}</td>
                    <td data-l="Status">
                      <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {openId && (
        <CreatorDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onOpenDeal={(dealId) => {
            setOpenId(null);
            onOpenDeal(dealId);
          }}
        />
      )}
    </>
  );
}

type CreatorDetail = {
  influencer: Influencer;
  address: InfluencerAddress | null;
  deals: DealListItem[];
  reliability: Reliability | null;
};

function CreatorDrawer({
  id,
  onClose,
  onOpenDeal,
}: {
  id: string;
  onClose: () => void;
  onOpenDeal: (dealId: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: QK.creator(id),
    queryFn: async (): Promise<CreatorDetail> => {
      const d = await api<{
        influencer: InfluencerListItem;
        address: InfluencerAddress | null;
        deals: DealListItem[];
        events: unknown[];
      }>(`/api/influencers/${id}`);
      return {
        influencer: d.influencer,
        address: d.address ?? null,
        deals: d.deals ?? [],
        reliability: d.influencer?.reliability ?? null,
      };
    },
  });

  return (
    <Drawer onClose={onClose} label="Creator profile" width={600}>
      {isLoading && <p className={s.hint}>Loading…</p>}
      {error && (
        <>
          <div className={s.drawerHead}>
            <span />
            <CloseBtn onClose={onClose} />
          </div>
          <p className={s.err}>{errText(error)}</p>
        </>
      )}
      {data && <CreatorBody key={data.influencer.updated_at} detail={data} onClose={onClose} onOpenDeal={onOpenDeal} />}
    </Drawer>
  );
}

function CreatorBody({
  detail,
  onClose,
  onOpenDeal,
}: {
  detail: CreatorDetail;
  onClose: () => void;
  onOpenDeal: (dealId: string) => void;
}) {
  const qc = useQueryClient();
  const c = detail.influencer;
  const r = detail.reliability;
  const [form, setForm] = useState({
    full_name: c.full_name ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    city: c.city ?? "",
    followers: c.followers != null ? String(c.followers) : "",
    engagement_rate: c.engagement_rate != null ? String(c.engagement_rate) : "",
    status: c.status,
    notes: c.notes ?? "",
    niche: c.niche ?? [],
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
      return api(`/api/influencers/${c.id}`, {
        method: "PATCH",
        body: {
          full_name: form.full_name.trim() || null,
          phone: form.phone.replace(/\D/g, "") || null,
          email: form.email.trim() || null,
          city: form.city.trim() || null,
          followers: n(form.followers),
          engagement_rate: n(form.engagement_rate),
          status: form.status,
          notes: form.notes.trim() || null,
          niche: form.niche,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.creator(c.id) });
      qc.invalidateQueries({ queryKey: QK.creators });
      qc.invalidateQueries({ queryKey: QK.deals });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
  });

  const a = detail.address;
  const toggleNiche = (n: string) =>
    setForm((f) => ({ ...f, niche: f.niche.includes(n) ? f.niche.filter((x) => x !== n) : [...f.niche, n] }));

  return (
    <>
      <div className={s.drawerHead}>
        <div className={s.dealHead}>
          <Initial handle={c.handle} large />
          <div style={{ minWidth: 0 }}>
            <h2 className={s.drawerTitle}>{at(c.handle)}</h2>
            <p className={s.dealSub}>
              {[
                c.full_name,
                (c.niche ?? []).map(cap).join(", ") || null,
                c.followers != null ? `${compact(c.followers)} followers` : null,
                c.engagement_rate != null ? `${pct(c.engagement_rate)} ER` : null,
                c.city,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className={s.row} style={{ marginTop: 8 }}>
              <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
              <TierTag tier={c.tier} />
            </div>
          </div>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      {r ? (
        <>
          <div className={s.stats}>
            <div className={s.stat}>
              <div className={s.statV}>{r.on_time_pct != null ? `${Math.round(r.on_time_pct)}%` : "New"}</div>
              <div className={s.statL}>Drafts on time</div>
            </div>
            <div className={s.stat}>
              <div className={s.statV}>{r.avg_days_late != null ? r.avg_days_late.toFixed(1) : "0"}</div>
              <div className={s.statL}>Avg days late</div>
            </div>
            <div className={s.stat}>
              <div className={s.statV}>{r.deals_total}</div>
              <div className={s.statL}>Collabs</div>
            </div>
          </div>
          <p className={s.muted} style={{ margin: "10px 0 0" }}>
            {r.deals_completed} completed
            {r.avg_revisions != null ? ` · ${r.avg_revisions.toFixed(1)} revisions on average` : ""}
            {` · ghosted ${r.ghosted} time${r.ghosted === 1 ? "" : "s"}`}
          </p>
        </>
      ) : (
        <p className={s.hint} style={{ margin: "16px 0 0" }}>
          No history yet.
        </p>
      )}

      <Section title="Collabs">
        {detail.deals.length === 0 ? (
          <p className={s.hint} style={{ margin: 0 }}>
            No collabs yet.
          </p>
        ) : (
          <ul className={s.collabs}>
            {detail.deals.map((d) => (
              <li key={d.id}>
                <button type="button" className={s.collabBtn} onClick={() => onOpenDeal(d.id)}>
                  <span className={s.remWhen}>{shortDate(d.agreed_at)}</span>
                  <b>
                    {d.kit?.name ?? "No kit"} · {STAGE_LABEL[d.stage]}
                  </b>
                  {d.health && <HealthChip health={d.health} reason={d.health_reason} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Shipping address">
        {a && (a.line1 || a.city) ? (
          <p className={s.muted} style={{ margin: 0 }}>
            {[a.name, a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ")}
            {a.phone ? ` · ${a.phone}` : ""}
          </p>
        ) : (
          <p className={s.hint} style={{ margin: 0 }}>
            No address saved. Add it from a collab&apos;s Shipping panel.
          </p>
        )}
      </Section>

      <Section title="Details">
        <div className={s.form}>
          <div className={s.grid2}>
            <Field label="Full name">
              <input className={s.input} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="WhatsApp number">
              <input className={s.input} value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className={s.input} value={form.email} type="email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="City">
              <input className={s.input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Followers">
              <input className={s.input} value={form.followers} inputMode="numeric" onChange={(e) => setForm({ ...form, followers: e.target.value })} />
            </Field>
            <Field label="Engagement rate (%)">
              <input className={s.input} value={form.engagement_rate} inputMode="decimal" onChange={(e) => setForm({ ...form, engagement_rate: e.target.value })} />
            </Field>
          </div>
          <Field label="Niche">
            <div className={s.chipRow}>
              {Array.from(new Set([...NICHES, ...form.niche])).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`${s.chip} ${form.niche.includes(n) ? s.chipOn : ""}`}
                  aria-pressed={form.niche.includes(n)}
                  onClick={() => toggleNiche(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Status">
            <select className={s.input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as InfluencerStatus })}>
              {(Object.keys(STATUS_LABEL) as InfluencerStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea className={s.textarea} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <div className={s.actions}>
            <button type="button" className="pm-btn primary sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save details"}
            </button>
            {saved && <span className={s.ok}>Saved</span>}
            {save.error && <span className={s.err}>{errText(save.error)}</span>}
          </div>
        </div>
      </Section>
    </>
  );
}
