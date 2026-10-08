"use client";

// Add collab: one form that finds-or-creates the creator (by handle) and opens
// a barter deal for them. Nothing is sent to the creator from here.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeHandle, normalizePhone } from "@/lib/influencers/normalize";
import type { Deal, UsageRights } from "@/lib/influencers/types";
import { api, errText, QK, unwrap } from "./api";
import {
  CloseBtn,
  Drawer,
  Field,
  NICHES,
  NumberStepper,
  USAGE_LABEL,
  useKits,
  useSettings,
} from "./ui";
import s from "../influencers.module.css";

const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function AddCollabDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const kits = useKits();
  const settings = useSettings();

  const [handle, setHandle] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [niche, setNiche] = useState<string[]>([]);
  const [followers, setFollowers] = useState("");
  const [er, setEr] = useState("");
  const [addr, setAddr] = useState({ name: "", line1: "", line2: "", city: "", state: "", pincode: "", phone: "" });
  // undefined = not chosen yet: the kit_id key is left out and the server picks by rules.
  const [kitId, setKitId] = useState<string | null | undefined>(undefined);
  const [reels, setReels] = useState(1);
  const [stories, setStories] = useState(0);
  const [posts, setPosts] = useState(0);
  const [dueDays, setDueDays] = useState<number | null>(null); // null = settings default
  const [goLive, setGoLive] = useState("");
  const [usage, setUsage] = useState<UsageRights>("none");
  const [usageDays, setUsageDays] = useState("30");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  const activeKits = useMemo(() => (kits.data ?? []).filter((k) => k.active), [kits.data]);
  // Server-side suggestion (same rules the POST uses), refreshed shortly
  // after followers / niche stop changing.
  const [suggestKey, setSuggestKey] = useState({ followers: "", niche: "" });
  useEffect(() => {
    const t = setTimeout(() => setSuggestKey({ followers: followers.trim(), niche: niche.join(",") }), 400);
    return () => clearTimeout(t);
  }, [followers, niche]);
  const suggestion = useQuery({
    queryKey: [...QK.rules, "suggest", suggestKey],
    queryFn: async () => {
      const sp = new URLSearchParams();
      const f = num(suggestKey.followers);
      if (f != null) sp.set("followers", String(f));
      sp.set("niche", suggestKey.niche);
      const d = await api(`/api/influencers/kit-rules?${sp.toString()}`);
      return unwrap<string | null>(d, "suggested_kit_id", null);
    },
  });
  const suggested = typeof suggestion.data === "string" ? suggestion.data : null;
  const kitValue = kitId === undefined ? (suggested ?? "") : (kitId ?? "");
  const draftDue = dueDays ?? settings.data?.default_draft_due_days ?? 10;

  const cleanHandle = normalizeHandle(handle);
  const cleanPhone = normalizePhone(phone);
  const handleErr = !handle.trim()
    ? "Instagram handle is required."
    : !cleanHandle
      ? "That does not look like an Instagram handle."
      : null;
  const phoneErr = !cleanPhone ? "A WhatsApp number with at least 10 digits is required." : null;

  const create = useMutation({
    mutationFn: async () => {
      const body = {
        handle: cleanHandle,
        full_name: fullName.trim() || null,
        phone: cleanPhone,
        city: city.trim() || null,
        niche,
        followers: num(followers),
        engagement_rate: num(er),
        address: {
          name: addr.name.trim() || fullName.trim() || null,
          line1: addr.line1.trim() || null,
          line2: addr.line2.trim() || null,
          city: addr.city.trim() || city.trim() || null,
          state: addr.state.trim() || null,
          pincode: addr.pincode.trim() || null,
          phone: addr.phone.trim() ? normalizePhone(addr.phone) : null,
        },
        // Left out entirely when untouched so the server picks by rules.
        ...(kitId !== undefined ? { kit_id: kitId } : {}),
        deliverables: { reels, stories, posts },
        draft_due_days: draftDue,
        go_live_at: goLive ? new Date(`${goLive}T12:00:00`).toISOString() : null,
        usage_rights: usage,
        usage_rights_days: usage === "none" ? null : num(usageDays),
        notes: notes.trim() || null,
      };
      const d = await api<{ deal: Deal; influencer_created: boolean }>("/api/influencers/deals", { method: "POST", body });
      return d?.deal?.id ?? null;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: QK.deals });
      qc.invalidateQueries({ queryKey: QK.summary });
      qc.invalidateQueries({ queryKey: QK.creators });
      if (id) onCreated(id);
      else onClose();
    },
  });

  const submit = () => {
    setTouched(true);
    if (handleErr || phoneErr) return;
    create.mutate();
  };

  const toggleNiche = (n: string) =>
    setNiche((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));

  return (
    <Drawer onClose={onClose} label="Add collab" width={620}>
      <div className={s.drawerHead}>
        <div>
          <span className={s.eyebrow}>New collab</span>
          <h2 className={s.drawerTitle}>Add a creator collab</h2>
          <p className={s.muted} style={{ margin: "4px 0 0" }}>
            Barter collab. Nothing is sent to the creator until you send the brief.
          </p>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      <form
        className={s.form}
        style={{ marginTop: 22 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={s.flab}>Creator</div>
        <div className={s.grid2}>
          <Field label="Instagram handle *" hint={touched && handleErr ? <span className={s.err}>{handleErr}</span> : "We find the creator if they are already saved."}>
            <input className={s.input} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@fitwithriya" />
          </Field>
          <Field label="Full name">
            <input className={s.input} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="WhatsApp number *" hint={touched && phoneErr ? <span className={s.err}>{phoneErr}</span> : "10 digit Indian numbers get +91 added."}>
            <input className={s.input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" />
          </Field>
          <Field label="City">
            <input className={s.input} value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Followers">
            <input className={s.input} value={followers} onChange={(e) => setFollowers(e.target.value)} inputMode="numeric" placeholder="25000" />
          </Field>
          <Field label="Engagement rate (%)">
            <input className={s.input} value={er} onChange={(e) => setEr(e.target.value)} inputMode="decimal" placeholder="3.5" />
          </Field>
        </div>
        <Field label="Niche">
          <div className={s.chipRow}>
            {NICHES.map((n) => (
              <button
                key={n}
                type="button"
                className={`${s.chip} ${niche.includes(n) ? s.chipOn : ""}`}
                aria-pressed={niche.includes(n)}
                onClick={() => toggleNiche(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>

        <div className={s.flab} style={{ marginTop: 10 }}>Shipping address</div>
        <div className={s.grid2}>
          <Field label="Name on parcel">
            <input className={s.input} value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} placeholder={fullName || ""} />
          </Field>
          <Field label="Phone on parcel">
            <input className={s.input} value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} inputMode="tel" placeholder={phone || ""} />
          </Field>
        </div>
        <Field label="Address line 1">
          <input className={s.input} value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
        </Field>
        <Field label="Address line 2">
          <input className={s.input} value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} />
        </Field>
        <div className={s.grid3}>
          <Field label="City">
            <input className={s.input} value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} placeholder={city || ""} />
          </Field>
          <Field label="State">
            <input className={s.input} value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} />
          </Field>
          <Field label="Pincode">
            <input className={s.input} value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} inputMode="numeric" />
          </Field>
        </div>

        <div className={s.flab} style={{ marginTop: 10 }}>The collab</div>
        <Field
          label="Kit"
          hint={
            kits.error
              ? errText(kits.error)
              : suggested && kitValue === suggested
                ? "Suggested from your kit rules."
                : activeKits.length === 0
                  ? "No kits yet. Add one in the Kits tab, or pick later."
                  : undefined
          }
        >
          <select className={s.input} value={kitValue} onChange={(e) => setKitId(e.target.value || null)}>
            <option value="">Pick later</option>
            {activeKits.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
                {k.id === suggested ? " (suggested)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <div className={s.grid3}>
          <Field label="Reels">
            <NumberStepper value={reels} onChange={setReels} label="reels" />
          </Field>
          <Field label="Stories">
            <NumberStepper value={stories} onChange={setStories} label="stories" />
          </Field>
          <Field label="Posts">
            <NumberStepper value={posts} onChange={setPosts} label="posts" />
          </Field>
        </div>

        <Field label={`Draft due ${draftDue} days after the box arrives`}>
          <input
            type="range"
            className={s.range}
            min={7}
            max={15}
            step={1}
            value={draftDue}
            onChange={(e) => setDueDays(Number(e.target.value))}
            aria-label="Draft due days"
          />
          <span className={s.hint} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>7 days</span>
            <span>15 days</span>
          </span>
        </Field>

        <div className={s.grid2}>
          <Field label="Go-live date (optional)">
            <input type="date" className={s.input} value={goLive} onChange={(e) => setGoLive(e.target.value)} />
          </Field>
          <Field label="Usage rights">
            <select className={s.input} value={usage} onChange={(e) => setUsage(e.target.value as UsageRights)}>
              {(Object.keys(USAGE_LABEL) as UsageRights[]).map((u) => (
                <option key={u} value={u}>
                  {USAGE_LABEL[u]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {usage !== "none" && (
          <Field label="For how many days" hint="How long PROMUNCH may reuse the content.">
            <input className={s.input} value={usageDays} onChange={(e) => setUsageDays(e.target.value)} inputMode="numeric" />
          </Field>
        )}

        <Field label="Notes">
          <textarea className={s.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the team should know" />
        </Field>

        <div className={s.actions}>
          <button type="submit" className="pm-btn primary sm" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Add collab"}
          </button>
          <button type="button" className="pm-btn ghost sm" onClick={onClose}>
            Cancel
          </button>
          {create.error && <span className={s.err}>{errText(create.error)}</span>}
        </div>
      </form>
    </Drawer>
  );
}
