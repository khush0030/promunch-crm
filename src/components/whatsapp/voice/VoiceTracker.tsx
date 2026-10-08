"use client";

// Voice agent tracker: one scorecard per job (COD confirmation, cart
// recovery), a weekly trend and what cart customers said. All numbers are
// computed from the calls already loaded on the page.

import { Banknote, ShoppingCart } from "lucide-react";
import { BarChart, HBars } from "@/components/pm";
import type { VoiceCall } from "./model";
import { cartReasons, fmtInr, pct, scoreJob, weeklyTrend } from "./model";
import s from "../voice.module.css";

type Step = { label: string; value: number; of: number; tone: "s1" | "s2" | "s3" | "s5" | "neg"; drop?: string };

function Funnel2({ steps }: { steps: Step[] }) {
  return (
    <div className={s.fun}>
      {steps.map((st, i) => (
        <div key={st.label}>
          {st.drop && i > 0 && <div className={s.fDrop}>{st.drop}</div>}
          <div className={`${s.f2} ${s[st.tone]}`}>
            <div className={s.fTop}>
              <span className={s.fL}>{st.label}</span>
              <b>{st.value.toLocaleString("en-IN")}</b>
              <em>{pct(st.value, st.of)}%</em>
            </div>
            <div className={s.fBar}><i style={{ width: `${pct(st.value, st.of)}%` }} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VoiceTracker({ calls }: { calls: VoiceCall[] }) {
  const codCalls = calls.filter((c) => c.purpose === "cod_confirm");
  const cartCalls = calls.filter((c) => c.purpose === "cart");
  const cod = scoreJob(codCalls);
  const cart = scoreJob(cartCalls);
  const trend = weeklyTrend(calls, 6);
  const trendPlaced = trend.reduce((a, b) => a + b.placed, 0);
  const trendPicked = trend.reduce((a, b) => a + b.pickedUp, 0);
  const reasons = cartReasons(calls);
  const topReason = reasons.items[0];

  return (
    <>
      <div className={s.g2}>
        <section className={s.card} aria-labelledby="vc-cod-h">
          <div className={s.jobH}>
            <span className={`${s.lic} ${s.icInfo}`} aria-hidden><Banknote size={18} /></span>
            <div>
              <h3 id="vc-cod-h">COD confirmation</h3>
              <p className={s.muted}>Calls when a COD order is not confirmed on WhatsApp</p>
            </div>
          </div>
          <div className={s.hero}>
            <div className={s.heroMain}>
              <span className={s.heroL}>Confirmed</span>
              <b className={s.big}>{pct(cod.confirmed, cod.called)}%</b>
              <span className={s.heroS}>{cod.confirmed} of {cod.called} COD calls</span>
            </div>
            <div className={s.heroSide}>
              <b>{cod.pickedUp}</b>
              <span>picked up</span>
            </div>
          </div>
          {cod.called > 0 ? (
            <Funnel2
              steps={[
                { label: "Called", value: cod.called, of: cod.called, tone: "s1" },
                { label: "Picked up", value: cod.pickedUp, of: cod.called, tone: "s2", drop: `${pct(cod.pickedUp, cod.called)}% picked up` },
                { label: "Confirmed", value: cod.confirmed, of: cod.called, tone: "s5", drop: `${pct(cod.confirmed, cod.pickedUp)}% of those said yes` },
                { label: "Asked to cancel", value: cod.cancelled, of: cod.called, tone: "neg" },
              ]}
            />
          ) : (
            <p className={s.muted}>No COD calls in this list yet.</p>
          )}
          <p className={s.foot}>
            <b>{cod.noAnswer}</b> did not answer
            {cod.notStarted > 0 && <> · <b>{cod.notStarted}</b> could not start</>}
            {cod.waiting > 0 && <> · <b>{cod.waiting}</b> result not in yet</>}
          </p>
        </section>

        <section className={s.card} aria-labelledby="vc-cart-h">
          <div className={s.jobH}>
            <span className={`${s.lic} ${s.icGood}`} aria-hidden><ShoppingCart size={18} /></span>
            <div>
              <h3 id="vc-cart-h">Cart recovery</h3>
              <p className={s.muted}>Calls after a cart is left, if WhatsApp did not bring them back</p>
            </div>
          </div>
          <div className={s.hero}>
            <div className={s.heroMain}>
              <span className={s.heroL}>Ordered after the call</span>
              <b className={s.big}>{pct(cart.ordered, cart.called)}%</b>
              <span className={s.heroS}>{cart.ordered} of {cart.called} called carts</span>
            </div>
            <div className={s.heroSide}>
              <b className={cart.orderedValue > 0 ? s.goodT : undefined}>{fmtInr(cart.orderedValue)}</b>
              <span>likely back</span>
            </div>
          </div>
          {cart.called > 0 ? (
            <Funnel2
              steps={[
                { label: "Called", value: cart.called, of: cart.called, tone: "s1" },
                { label: "Picked up", value: cart.pickedUp, of: cart.called, tone: "s2", drop: `${pct(cart.pickedUp, cart.called)}% picked up` },
                { label: "Link sent", value: cart.linkSent, of: cart.called, tone: "s3", drop: `${pct(cart.linkSent, cart.pickedUp)}% of those got the link` },
                { label: "Ordered within 3 days", value: cart.ordered, of: cart.called, tone: "s5" },
              ]}
            />
          ) : (
            <p className={s.muted}>No cart calls in this list yet.</p>
          )}
          <p className={s.foot}>
            <b>{cart.noAnswer}</b> did not answer
            {cart.notStarted > 0 && <> · <b>{cart.notStarted}</b> could not start</>}
            {cart.dnd > 0 && <> · <b>{cart.dnd}</b> asked us not to call</>}
          </p>
        </section>
      </div>

      <div className={s.g2}>
        <section className={s.card} aria-labelledby="vc-trend-h">
          <h3 id="vc-trend-h">Calls by week</h3>
          <p className={s.muted}>
            {trendPlaced > 0
              ? `${trendPicked} of ${trendPlaced} calls in the last 6 weeks were picked up (${pct(trendPicked, trendPlaced)}%).`
              : "No calls in the last 6 weeks."}
          </p>
          <div className={s.chart}>
            <BarChart
              cats={trend.map((b) => b.label)}
              series={[
                { name: "Picked up", color: "#2E7D46", values: trend.map((b) => b.pickedUp) },
                { name: "No pickup", color: "#CFC7B9", values: trend.map((b) => b.placed - b.pickedUp) },
              ]}
              labels
              height={180}
              aria="Voice calls per week, picked up and not picked up"
            />
          </div>
        </section>

        <section className={s.card} aria-labelledby="vc-why-h">
          <h3 id="vc-why-h">Why carts did not buy</h3>
          <p className={s.muted}>
            {reasons.total === 0
              ? "Nobody who picked up has said no yet."
              : `${reasons.total} ${reasons.total === 1 ? "person" : "people"} picked up and did not order. ${
                  topReason ? `Most common: ${topReason.label.toLowerCase()}.` : ""
                }`}
          </p>
          {reasons.total > 0 && (
            <div className={s.chart}>
              <HBars
                items={reasons.items.map((r, i) => ({
                  label: r.label,
                  value: r.n,
                  text: <b>{r.n}</b>,
                  sub: `${pct(r.n, reasons.total)}%`,
                  color: i === 0 ? "#1F7A8C" : "#B9B0A3",
                }))}
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export default VoiceTracker;
