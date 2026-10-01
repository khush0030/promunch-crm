"use client";

// Marketing automations: the built-in cart / review / restock journeys.
// Editable by anyone with the WhatsApp marketing area, except the cart retry
// safety limits, which stay Owner/Admin (they protect the Meta budget).

import { RefreshCw, ShoppingCart, Star } from "lucide-react";
import { GlossaryTerm, HelpTip } from "@/components/guide";
import { AutomationCard } from "./AutomationCard";
import { DurationInput, Field, PreviewTabs, StatsRow, TechDetails, MessagePreview } from "./bits";
import type { FlowsCtx } from "./context";
import { friendlyDuration } from "./logic";
import s from "./flows.module.css";

export function CartCard({ c }: { c: FlowsCtx }) {
  const d = c.draft;
  const st = c.stats.abandoned_checkout ?? {};
  const couponWait = Math.max(0, d.cart_step2_delay_hours - d.cart_step1_delay_hours);
  return (
    <AutomationCard
      icon={ShoppingCart}
      title="Abandoned cart reminder"
      line="When someone leaves items in their cart without ordering"
      enabled={c.saved.abandoned_cart_enabled}
      onToggle={() => c.requestToggle("abandoned_cart_enabled", !c.saved.abandoned_cart_enabled)}
      steps={[
        { kind: "trigger", title: "They leave items in the cart", detail: "and we have their phone number" },
        { kind: "wait", title: friendlyDuration(d.cart_step1_delay_hours) },
        { kind: "message", title: "Reminder with their cart link", detail: "no coupon yet" },
        { kind: "wait", title: friendlyDuration(couponWait), detail: "if they still have not ordered" },
        { kind: "message", title: `Coupon ${d.cart_coupon_code}`, detail: "a gentle nudge with a discount" },
        { kind: "stop", title: "They order, or reply STOP" },
      ]}
      settings={
        <div className={s.settings}>
          <Field label="Send the reminder after">
            <DurationInput label="Reminder wait" hours={d.cart_step1_delay_hours} min={0.25} max={168}
              units={["minutes", "hours", "days"]} onChange={(h) => c.set("cart_step1_delay_hours", h)} />
          </Field>
          <Field label="Send the coupon message after (from when they left)">
            <DurationInput label="Coupon message wait" hours={d.cart_step2_delay_hours} min={0.5} max={336}
              onChange={(h) => c.set("cart_step2_delay_hours", h)} />
          </Field>
          <Field label="Coupon code" help={<HelpTip text="The Shopify discount code named in the second message. It must exist in Shopify or the customer's code won't work." />}>
            <input className={s.text} value={d.cart_coupon_code} aria-label="Coupon code" maxLength={40}
              onChange={(e) => c.set("cart_coupon_code", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
          </Field>
          {d.cart_step2_delay_hours <= d.cart_step1_delay_hours && (
            <span className={s.err} role="alert">The coupon message has to come after the reminder.</span>
          )}
        </div>
      }
      preview={
        <PreviewTabs
          templates={c.templates}
          statusRows={c.statusRows}
          items={[
            { key: "r", label: "Reminder", name: "abandoned_cart_reminder" },
            { key: "c", label: "Coupon", name: "abandoned_cart_recovery" },
          ]}
        />
      }
      stats={
        <StatsRow rows={[
          { label: "reached people", value: st.completed ?? 0 },
          { label: "ordered after", value: st.converted ?? 0 },
          { label: "still trying", value: st.active ?? 0 },
          { label: "gave up (too late)", value: st.expired ?? 0 },
        ]} />
      }
      tech={
        <TechDetails>
          <ul>
            <li>Starts from Shopify when a checkout is left with a phone number. Each cart is messaged at most once per step, never twice.</li>
            <li>
              If the customer chatted with us in the last 24 hours (the <GlossaryTerm k="window_24h">24-hour chat window</GlossaryTerm>),
              they get a personal free-text nudge instead of the template. It does not count towards the{" "}
              <GlossaryTerm k="marketing_cap">marketing limit</GlossaryTerm>.
            </li>
            <li>
              If Meta <GlossaryTerm k="held_back">holds back</GlossaryTerm> the message, we try again later, until one message
              reaches them or the give-up time passes.
            </li>
            <li>Paused while the customer has an open support ticket. Stops the moment they order.</li>
          </ul>
          <div className={s.settings}>
            <Field label="Give up after (from when they left)">
              {c.isAdmin ? (
                <DurationInput label="Give up after" hours={d.cart_deadline_hours} min={6} max={720}
                  onChange={(h) => c.set("cart_deadline_hours", h)} />
              ) : (
                <span className={s.fieldValue}>{friendlyDuration(d.cart_deadline_hours)}</span>
              )}
            </Field>
            <Field label="Wait between retries when Meta holds it back">
              {c.isAdmin ? (
                <DurationInput label="Retry wait" hours={d.cart_backoff_hours} min={1} max={72}
                  onChange={(h) => c.set("cart_backoff_hours", h)} />
              ) : (
                <span className={s.fieldValue}>{friendlyDuration(d.cart_backoff_hours)}</span>
              )}
            </Field>
          </div>
          {!c.isAdmin && <span className={s.hint}>Only the owner or an admin can change these two safety limits.</span>}
        </TechDetails>
      }
    />
  );
}

function PostPurchaseCard({ c, kind }: { c: FlowsCtx; kind: "review" | "restock" }) {
  const review = kind === "review";
  const d = c.draft;
  const key = review ? "review_request_enabled" : "replenishment_enabled";
  const days = review ? d.review_delay_days : d.replenishment_delay_days;
  const st = c.stats[review ? "review_request" : "replenishment_reminder"] ?? {};
  return (
    <AutomationCard
      icon={review ? Star : RefreshCw}
      title={review ? "Review ask" : "Restock reminder"}
      line={review ? "A few days after someone orders, ask them how they liked it" : "Around when their snacks run out, nudge them to order again"}
      enabled={c.saved[key]}
      onToggle={() => c.requestToggle(key, !c.saved[key])}
      steps={[
        { kind: "trigger", title: "They place an order" },
        { kind: "wait", title: `${days} day${days === 1 ? "" : "s"}` },
        { kind: "message", title: review ? "Ask for a review" : "Time to restock?", detail: "a personal chat message when possible" },
        { kind: "stop", title: "The order is cancelled, or they reply STOP" },
      ]}
      settings={
        <div className={s.settings}>
          <Field label="Wait after the order">
            <DurationInput
              label={review ? "Review ask wait" : "Restock reminder wait"}
              hours={days * 24} min={24} max={review ? 90 * 24 : 365 * 24} units={["days"]}
              onChange={(h) => c.set(review ? "review_delay_days" : "replenishment_delay_days", Math.round(h / 24))}
            />
          </Field>
          {review && <span className={s.hint}>Delivery usually takes about 6 days, so don&apos;t ask before it arrives.</span>}
        </div>
      }
      preview={<MessagePreview name={review ? "review_request" : "replenishment_reminder"} templates={c.templates} statusRows={c.statusRows} label="Backup message (template)" />}
      stats={
        <StatsRow rows={[
          { label: review ? "asked" : "nudged", value: st.completed ?? 0 },
          { label: "waiting", value: st.active ?? 0 },
          { label: "skipped (order cancelled)", value: st.cancelled ?? 0 },
        ]} />
      }
      tech={
        <TechDetails>
          <ul>
            <li>
              If the customer has chatted with us in the last 24 hours, the assistant writes them a personal message that
              names what they bought. That does not use up the <GlossaryTerm k="marketing_cap">marketing limit</GlossaryTerm>.
            </li>
            <li>Otherwise it sends the backup template shown here, at most 3 times, then waits for their next chat.</li>
            <li>Skipped if the order was cancelled. Paused while the customer has an open support ticket.</li>
            <li>A new wait time applies to orders placed from now on. Messages already scheduled keep their time.</li>
          </ul>
        </TechDetails>
      }
    />
  );
}

export function ReviewCard({ c }: { c: FlowsCtx }) {
  return <PostPurchaseCard c={c} kind="review" />;
}
export function RestockCard({ c }: { c: FlowsCtx }) {
  return <PostPurchaseCard c={c} kind="restock" />;
}
