"use client";

// Step 1, Find: business type + city + how many. Runs on the SERVER; the tab
// can be closed. Live progress shows below and on the list.
import { useState } from "react";
import { Search } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import { api, errText, useB2bRefresh } from "./api";
import { CATEGORY_PRESETS, DEFAULT_CITIES, PRODUCT_OPTIONS } from "./constants";
import SearchProgressCard from "./SearchProgressCard";
import type { SearchProgress } from "./types";

const SIZES = [10, 20, 40];

export default function FindView({
  searches, onOpenList,
}: {
  searches: SearchProgress[];
  onOpenList: (listId: string) => void;
}) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const [type, setType] = useState(CATEGORY_PRESETS[0].query);
  const [customType, setCustomType] = useState("");
  const [city, setCity] = useState(DEFAULT_CITIES[0]);
  const [customCity, setCustomCity] = useState("");
  const [size, setSize] = useState(20);
  const [showPitch, setShowPitch] = useState(false);
  const [products, setProducts] = useState<string[]>([]);
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);

  const category = (type === "__other" ? customType : type).trim();
  const where = (city === "__other" ? customCity : city).trim();

  async function start() {
    if (!category || !where) return;
    setBusy(true);
    try {
      await api("/api/leads/search", {
        body: { categories: [category], cities: [where], maxResults: size, findEmails: true, products, offer },
      });
      toast.push({ kind: "success", text: `Finding ${category} in ${where}. You can close this tab; it keeps going.` });
      refresh();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    setStopping(id);
    try {
      await api(`/api/leads/searches/${id}`, { method: "PATCH", body: { action: "stop" } });
      refresh();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setStopping(null);
    }
  }

  return (
    <div className={s.body}>
      <section className={s.card}>
        <div className={s.secT}><h3>What kind of business?</h3></div>
        <div className={s.chips} role="radiogroup" aria-label="Business type">
          {CATEGORY_PRESETS.map((p) => (
            <button key={p.query} type="button" role="radio" aria-checked={type === p.query} className={s.chip} data-on={type === p.query} onClick={() => setType(p.query)}>
              {p.label}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={type === "__other"} className={s.chip} data-on={type === "__other"} onClick={() => setType("__other")}>
            Something else
          </button>
        </div>
        {type === "__other" ? (
          <input className={s.in} style={{ marginTop: 14, maxWidth: 480 }} placeholder="e.g. corporate catering company" value={customType} onChange={(e) => setCustomType(e.target.value)} aria-label="Business type" />
        ) : null}

        <div className={s.secT} style={{ marginTop: 28 }}><h3>Which city?</h3></div>
        <div className={s.chips} role="radiogroup" aria-label="City">
          {DEFAULT_CITIES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={city === c} className={s.chip} data-on={city === c} onClick={() => setCity(c)}>{c}</button>
          ))}
          <button type="button" role="radio" aria-checked={city === "__other"} className={s.chip} data-on={city === "__other"} onClick={() => setCity("__other")}>Another city</button>
        </div>
        {city === "__other" ? (
          <input className={s.in} style={{ marginTop: 14, maxWidth: 360 }} placeholder="e.g. Chennai" value={customCity} onChange={(e) => setCustomCity(e.target.value)} aria-label="City" />
        ) : null}

        <div className={s.secT} style={{ marginTop: 28 }}><h3>About how many with an email?</h3></div>
        <div className={s.chips} role="radiogroup" aria-label="How many">
          {SIZES.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={size === n} className={s.chip} data-on={size === n} onClick={() => setSize(n)}>{n}</button>
          ))}
        </div>
        <p className={s.hint} style={{ marginTop: 10 }}>
          Only some websites list an email, so we look at more businesses than this. Google Maps gives at most 60 per search.
        </p>

        <div style={{ marginTop: 24 }}>
          <button type="button" className={s.txtLink} onClick={() => setShowPitch((v) => !v)}>
            {showPitch ? "Hide pitch details" : "Add pitch details (optional)"}
          </button>
        </div>
        {showPitch ? (
          <div style={{ marginTop: 16 }}>
            <div className={s.field}>
              <span className={s.fieldL}>Products to lead with <span>(the AI uses these when writing)</span></span>
              <div className={s.chips}>
                {PRODUCT_OPTIONS.map((p) => {
                  const on = products.includes(p);
                  return (
                    <button key={p} type="button" className={s.chip} data-on={on} aria-pressed={on} onClick={() => setProducts((x) => (on ? x.filter((y) => y !== p) : [...x, p]))}>{p}</button>
                  );
                })}
              </div>
            </div>
            <div className={s.field}>
              <label htmlFor="find-offer">What are you offering this time? <span>(optional)</span></label>
              <input id="find-offer" className={s.in} maxLength={400} placeholder="e.g. Diwali gift hampers with a free sample box" value={offer} onChange={(e) => setOffer(e.target.value)} />
            </div>
          </div>
        ) : null}

        <div className={s.row} style={{ marginTop: 28 }}>
          <button type="button" className="pm-btn primary" onClick={start} disabled={busy || !category || !where}>
            <Search /> {busy ? "Starting…" : `Find ${category || "businesses"} in ${where || "…"}`}
          </button>
          <span className={s.hint}>Runs on our server. Nothing is written or sent from here.</span>
        </div>
      </section>

      {searches.length ? (
        <section className={`${s.card} ${s.cardFlush}`}>
          {searches.map((x) => (
            <SearchProgressCard key={x.id} search={x} onOpenList={onOpenList} onStop={stop} stopping={stopping === x.id} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
