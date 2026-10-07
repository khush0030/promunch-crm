"use client";

// Right-side call drawer (bottom sheet on phones): who and what, how the call
// went, the recording, the transcript, the tries, and for cart calls the cart
// itself. Read-only: nothing in here places calls or sends messages.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Pause, Play, PhoneOff, ShoppingCart, User as UserIcon, X } from "lucide-react";
import type { VoiceCall } from "./model";
import {
  callResult, callSubject, displayName, fmtDur, fmtInr, fmtWhen, isCod, maskPhone, outcomeLabel, statusLabel,
} from "./model";
import s from "../voice.module.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Player({ src, durationHint }: { src: string; durationHint: number | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState<number>(durationHint ?? 0);
  const [err, setErr] = useState(false);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setErr(true));
    else a.pause();
  }

  return (
    <div className={s.player}>
      <audio
        ref={ref}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }}
        onError={() => setErr(true)}
      />
      <button type="button" className={s.pb} onClick={toggle} aria-label={playing ? "Pause recording" : "Play recording"} disabled={err}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <input
        type="range"
        className={s.seek}
        min={0}
        max={dur || 1}
        step={0.1}
        value={Math.min(t, dur || 1)}
        aria-label="Recording position"
        disabled={err}
        onChange={(e) => {
          const a = ref.current;
          const v = Number(e.target.value);
          if (a) a.currentTime = v;
          setT(v);
        }}
      />
      <span className={s.mono}>{err ? "Recording not available" : `${fmtDur(t)} / ${dur ? fmtDur(dur) : "-"}`}</span>
    </div>
  );
}

export function CallDrawer({ call: c, tries, onClose }: { call: VoiceCall; tries: VoiceCall[]; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Focus in, trap Tab, Esc closes, focus back to the row on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const els = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panelRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, []);

  const name = displayName(c);
  const cod = isCod(c);
  const result = callResult(c);
  const tryNo = Math.max(1, tries.findIndex((x) => x.id === c.id) + 1);
  const items = c.run?.cart_items ?? [];
  const firstName = name.split(/\s+/)[0] || "Customer";
  const lastCustomerLine = [...(c.transcript ?? [])].reverse().find((t) => t.role === "user" && t.en_text?.trim())?.en_text;

  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} className={s.drawer} role="dialog" aria-modal="true" aria-labelledby="vc-drawer-h">
        <div className={s.dh}>
          <span className={`${s.av} ${cod ? s.avInfo : s.avGood}`} aria-hidden>{initialsOf(name)}</span>
          <div className={s.dhT}>
            <span className={s.eyebrow}>{cod ? "COD confirmation call" : "Cart recovery call"} · try {tryNo}</span>
            <h2 id="vc-drawer-h">{name}</h2>
            <p className={s.muted}>
              {callSubject(c)} · {fmtWhen(c.created_at)} · <span className={s.nowrap}>{maskPhone(c.contact.phone || c.contact.wa_id)}</span>
            </p>
          </div>
          <button ref={closeRef} type="button" className={s.x} onClick={onClose} aria-label="Close call details">
            <X size={18} />
          </button>
        </div>

        <div className={s.db}>
          <div className={s.statusLine}>
            <span className={`${s.tg} ${s[result.tone]}`}>{result.label}</span>
            {statusLabel(c.status) !== result.label && <span className={s.sep}>{statusLabel(c.status)}</span>}
            {c.outcome && outcomeLabel(c.outcome) !== result.label && <span className={s.sep}>{outcomeLabel(c.outcome)}</span>}
            {c.duration_s != null && <span className={s.sep}>{fmtDur(c.duration_s)} long</span>}
            {c.contact.voice_dnd && <span className={s.dnd}><PhoneOff size={13} /> Do not call</span>}
          </div>

          {c.failure_reason && (
            <div className={s.block}>
              <h3>Why it did not go through</h3>
              <p className={s.reason}>{c.failure_reason}</p>
            </div>
          )}

          {c.has_recording ? (
            <Player src={`/api/whatsapp/voice-calls/${c.id}/recording`} durationHint={c.duration_s} />
          ) : (
            <p className={s.muted}>No recording for this call.</p>
          )}

          {!cod && (
            <div className={s.block}>
              <div className={s.blockH}>
                <h3>What was in the cart</h3>
                {c.run?.cart_total != null && <span className={s.cartVal}>{fmtInr(c.run.cart_total)}</span>}
              </div>
              {items.length ? (
                <div className={s.items}>
                  {items.map((it, i) => (
                    <div key={i} className={s.ci}>
                      <span className={s.ciIc} aria-hidden><ShoppingCart size={14} /></span>
                      <div className={s.ciTx}>
                        <b>{it.title ?? "Item"}</b>
                        <span>{it.qty ?? 1} in cart</span>
                      </div>
                      {it.title && (
                        <a className={s.lnk} href={`https://promunch.in/search?q=${encodeURIComponent(it.title)}`} target="_blank" rel="noreferrer">
                          Product <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className={s.muted}>Cart details were not saved for this call.</p>
              )}
              <dl className={s.kv}>
                <dt>Link sent</dt>
                <dd>{c.link_sent_at ? `On WhatsApp, ${fmtWhen(c.link_sent_at)}` : "Not sent"}</dd>
                {c.run?.checkout_url && (
                  <>
                    <dt>Checkout link</dt>
                    <dd><a className={s.lnk} href={c.run.checkout_url} target="_blank" rel="noreferrer">Open the link <ExternalLink size={12} /></a></dd>
                  </>
                )}
                <dt>Reaction</dt>
                <dd>{c.outcome ? outcomeLabel(c.outcome) : "Not known yet"}</dd>
              </dl>
              {lastCustomerLine && <q className={s.quote}>{lastCustomerLine}</q>}
            </div>
          )}

          {c.order && (
            <div className={s.block}>
              <h3>Likely order after this call</h3>
              <dl className={s.kv}>
                <dt>Order</dt>
                <dd>
                  {c.order.admin_url ? (
                    <a className={s.lnk} href={c.order.admin_url} target="_blank" rel="noreferrer">
                      #{c.order.order_number} · {fmtInr(c.order.total_price)} <ExternalLink size={12} />
                    </a>
                  ) : (
                    <>#{c.order.order_number} · {fmtInr(c.order.total_price)}</>
                  )}
                </dd>
                {c.order.financial_status && (<><dt>Payment</dt><dd>{c.order.financial_status.replace(/_/g, " ")}</dd></>)}
              </dl>
              <p className={s.hint}>Matched by phone and timing (within 3 days). Not proof the call caused it.</p>
            </div>
          )}

          <div className={s.block}>
            <h3>Transcript</h3>
            {c.transcript?.length ? (
              <div className={s.transcript}>
                {c.transcript.map((t, i) => (
                  <div key={i} className={`${s.ln} ${t.role === "agent" ? s.agent : ""}`}>
                    <b>{t.role === "agent" ? "Agent" : firstName}</b>
                    <span>{t.en_text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={s.muted}>No transcript yet. Try Refresh call results.</p>
            )}
          </div>

          <div className={s.block}>
            <h3>Tries</h3>
            <ol className={s.tl}>
              {tries.map((x, i) => {
                const r = callResult(x);
                return (
                  <li key={x.id} className={`${s.it} ${x.id === c.id ? s.itNow : s.itDone}`}>
                    <b>Call {i + 1} · {r.label.toLowerCase()}</b>
                    <span>{fmtWhen(x.created_at)}{x.duration_s != null ? ` · ${fmtDur(x.duration_s)}` : ""}{x.id === c.id ? " · this call" : ""}</span>
                  </li>
                );
              })}
            </ol>
            <p className={s.hint}>Counted from the calls loaded on this page.</p>
          </div>
        </div>

        {(c.crm_contact_id || c.order?.admin_url) && (
          <div className={s.df}>
            {c.crm_contact_id && (
              <a className="pm2-btn sm" href={`/dashboard/contacts/${c.crm_contact_id}`}>
                <UserIcon size={14} /> Customer
              </a>
            )}
            {c.order?.admin_url && (
              <a className="pm2-btn sm" href={c.order.admin_url} target="_blank" rel="noreferrer">
                Order #{c.order.order_number} <ExternalLink size={13} />
              </a>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default CallDrawer;
