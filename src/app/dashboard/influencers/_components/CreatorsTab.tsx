"use client";

// Creators tab: every creator we have worked with, how reliable they are, and
// a profile drawer to fix their details.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { EmptyState, SearchBar, StatusBadge } from "@/components/pm";
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
  NICHES,
  STAGE_LABEL,
  Section,
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

const STATUS_TONE: Record<InfluencerStatus, "green" | "gold" | "terra"> = {
  active: "green",
  paused: "gold",
  blocked: "terra",
};
const STATUS_LABEL: Record<InfluencerStatus, string> = { active: "Active", paused: "Paused", blocked: "Do not work with" };

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

  const th = (key: SortKey, label: string, align?: "right") => (
    <th
      className={s.sortTh}
      style={{ textAlign: align }}
      onClick={() => setSort((p) => ({ key, dir: p.key === key ? (p.dir === 1 ? -1 : 1) : key === "handle" ? 1 : -1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <>
      <div className={s.filters}>
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
        <div className="pm-tablewrap" style={{ marginTop: 14 }}>
          <table className="pm-tbl">
            <thead>
              <tr>
                {th("handle", "Creator")}
                <th>Tier</th>
                {th("followers", "Followers", "right")}
                {th("er", "ER", "right")}
                <th>Niche</th>
                {th("open", "Open collabs", "right")}
                {th("ontime", "On time", "right")}
                {th("last", "Last contact")}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)}>
                  <td>
                    <strong>{at(c.handle)}</strong>
                    {c.full_name && <div className={s.hint}>{c.full_name}</div>}
                  </td>
                  <td>{c.tier ? TIER_LABEL[c.tier] : ""}</td>
                  <td style={{ textAlign: "right" }}>{compact(c.followers)}</td>
                  <td style={{ textAlign: "right" }}>{pct(c.engagement_rate)}</td>
                  <td>{(c.niche ?? []).join(", ")}</td>
                  <td style={{ textAlign: "right" }}>{c.open_deals ?? 0}</td>
                  <td style={{ textAlign: "right" }}>
                    {c.reliability?.on_time_pct != null ? `${Math.round(c.reliability.on_time_pct)}%` : <span className={s.hint}>New</span>}
                  </td>
                  <td>{c.last_contact_at ? relDay(c.last_contact_at) : ""}</td>
                  <td>
                    <StatusBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <div>
          <h2 className={s.drawerTitle}>{at(c.handle)}</h2>
          <div className={s.row} style={{ marginTop: 6 }}>
            <TierTag tier={c.tier} />
            <StatusBadge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusBadge>
            <span className={s.hint}>
              {[c.followers != null ? `${compact(c.followers)} followers` : null, c.engagement_rate != null ? `${pct(c.engagement_rate)} ER` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      <Section title="Reliability">
        {r ? (
          <dl className={s.kv}>
            <dt>Collabs</dt>
            <dd>
              {r.deals_total} total, {r.deals_completed} completed
            </dd>
            <dt>Drafts on time</dt>
            <dd>{r.on_time_pct != null ? `${Math.round(r.on_time_pct)}%` : "Not enough history"}</dd>
            <dt>Average days late</dt>
            <dd>{r.avg_days_late != null ? r.avg_days_late.toFixed(1) : ""}</dd>
            <dt>Average revisions</dt>
            <dd>{r.avg_revisions != null ? r.avg_revisions.toFixed(1) : ""}</dd>
            <dt>Ghosted</dt>
            <dd>{r.ghosted}</dd>
          </dl>
        ) : (
          <p className={s.hint} style={{ margin: 0 }}>
            No history yet.
          </p>
        )}
      </Section>

      <Section title="Collabs">
        {detail.deals.length === 0 ? (
          <p className={s.hint} style={{ margin: 0 }}>
            No collabs yet.
          </p>
        ) : (
          <ul className={s.tl}>
            {detail.deals.map((d) => (
              <li key={d.id} style={{ cursor: "pointer" }} onClick={() => onOpenDeal(d.id)}>
                <span className={s.tlWhen}>{shortDate(d.agreed_at)}</span>
                <span style={{ flex: 1 }}>
                  {d.kit?.name ?? "No kit"} · {STAGE_LABEL[d.stage]}
                </span>
                {d.health && <HealthChip health={d.health} reason={d.health_reason} />}
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
