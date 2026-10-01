"use client";

// Order messages: sent for every order, so only the Owner or an Admin can
// change them (the API enforces the same rule). Everyone else sees them
// read-only, with a lock and the reason.

import { MessageSquareText, PackageCheck, Phone, ShieldCheck, Truck } from "lucide-react";
import { GlossaryTerm, HelpTip } from "@/components/guide";
import { VOICE_LANGUAGES } from "@/app/api/whatsapp/flows/validate";
import { AutomationCard } from "./AutomationCard";
import { DurationInput, Field, MessagePreview, StatsRow, Switch, TechDetails } from "./bits";
import type { FlowsCtx } from "./context";
import { friendlyDuration, friendlyTemplateName } from "./logic";
import s from "./flows.module.css";

const LOCK_BADGE = <span className="pm2-pill neu plain">Owner only</span>;

function TemplateChooser({ c, value, onChange, label, allowSame }: {
  c: FlowsCtx; value: string; onChange: (v: string) => void; label: string; allowSame?: boolean;
}) {
  const names = [...new Set(c.statusRows.map((t) => t.name))].sort();
  if (!c.isAdmin) {
    return <span className={s.fieldValue}>{value ? friendlyTemplateName(value) : "Same as first order"}</span>;
  }
  return (
    <select className={`${s.select} ${s.wide}`} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {allowSame && <option value="">Same as first order</option>}
      {names.map((n) => <option key={n} value={n}>{friendlyTemplateName(n)}</option>)}
      {value !== "" && !names.includes(value) && <option value={value}>{friendlyTemplateName(value)}</option>}
    </select>
  );
}

export function ConfirmationCard({ c }: { c: FlowsCtx }) {
  const d = c.draft;
  const repeat = d.confirmation_template_repeat;
  return (
    <AutomationCard
      icon={PackageCheck}
      title="Order confirmation"
      line="Right after someone orders, confirm it on WhatsApp"
      enabled={c.saved.order_confirmation_enabled}
      locked={!c.isAdmin}
      badge={!c.isAdmin ? LOCK_BADGE : undefined}
      onToggle={() => c.requestToggle("order_confirmation_enabled", !c.saved.order_confirmation_enabled)}
      steps={[
        { kind: "trigger", title: "They place an order" },
        { kind: "wait", title: "A few seconds" },
        { kind: "message", title: "Order confirmation", detail: "first-time and returning customers can get different messages" },
      ]}
      settings={
        <div className={s.settings}>
          <Field label="Message for a first order">
            <TemplateChooser c={c} label="First order message" value={d.confirmation_template_first}
              onChange={(v) => c.set("confirmation_template_first", v)} />
          </Field>
          <Field label="Message for a returning customer">
            <TemplateChooser c={c} label="Returning customer message" value={repeat} allowSame
              onChange={(v) => c.set("confirmation_template_repeat", v)} />
          </Field>
        </div>
      }
      preview={<MessagePreview name={d.confirmation_template_first} templates={c.templates} statusRows={c.statusRows} />}
      tech={
        <TechDetails>
          <ul>
            <li>This is a <GlossaryTerm k="utility">customer service message</GlossaryTerm>, so it has no daily limit and never carries a coupon.</li>
            <li>If sending fails, the system tries again every 15 minutes for up to 24 hours. Each order is confirmed once, never twice.</li>
            <li>A customer whose phone number ordered before counts as returning. If the returning message is empty or not yet approved by Meta, everyone gets the first-order message.</li>
            <li>Both messages must use blank 1 for the customer&apos;s name and blank 2 for the order number.</li>
          </ul>
        </TechDetails>
      }
    />
  );
}

export function CodCard({ c }: { c: FlowsCtx }) {
  const d = c.draft;
  const callWait = Math.max(0, d.cod_needs_call_hours - d.cod_reminder_delay_hours);
  return (
    <AutomationCard
      icon={ShieldCheck}
      title="Cash on delivery confirmation"
      line="Before a cash-on-delivery order ships, ask the customer to confirm it"
      enabled={c.saved.cod_gate_enabled}
      locked={!c.isAdmin}
      badge={!c.isAdmin ? LOCK_BADGE : undefined}
      onToggle={() => c.requestToggle("cod_gate_enabled", !c.saved.cod_gate_enabled)}
      steps={[
        { kind: "trigger", title: "They place a cash-on-delivery order", detail: "the order is held in Shopify" },
        { kind: "message", title: "Confirm or Cancel buttons" },
        { kind: "wait", title: friendlyDuration(d.cod_reminder_delay_hours), detail: "if they have not tapped a button" },
        { kind: "message", title: "A reminder to confirm" },
        { kind: "wait", title: friendlyDuration(callWait), detail: "still no answer" },
        { kind: "stop", title: "Team is asked to call them" },
      ]}
      settings={
        <div className={s.settings}>
          <Field label="Send the reminder after">
            {c.isAdmin ? (
              <DurationInput label="COD reminder wait" hours={d.cod_reminder_delay_hours} min={0.5} max={48}
                units={["minutes", "hours"]} onChange={(h) => c.set("cod_reminder_delay_hours", h)} />
            ) : <span className={s.fieldValue}>{friendlyDuration(d.cod_reminder_delay_hours)}</span>}
          </Field>
          <Field label="Ask the team to call after (from the order)">
            {c.isAdmin ? (
              <DurationInput label="Needs a call after" hours={d.cod_needs_call_hours} min={1} max={168}
                onChange={(h) => c.set("cod_needs_call_hours", h)} />
            ) : <span className={s.fieldValue}>{friendlyDuration(d.cod_needs_call_hours)}</span>}
          </Field>
          {d.cod_needs_call_hours <= d.cod_reminder_delay_hours && (
            <span className={s.err} role="alert">The call request has to come after the reminder.</span>
          )}
          <div className={s.toggleRow}>
            <div>
              <div className={s.toggleName}>AI confirmation call</div>
              <div className={s.toggleSub}>If a COD customer ignores the Confirm buttons and the reminder, the AI voice calls to confirm. Cancel requests go to the team, never auto-cancelled.</div>
            </div>
            {c.isAdmin ? (
              <Switch on={c.saved.cod_voice_enabled} label="COD confirmation calls"
                onClick={() => c.requestToggle("cod_voice_enabled", !c.saved.cod_voice_enabled)} />
            ) : (
              <span className={s.stateText}>{c.saved.cod_voice_enabled ? "On" : "Off"}</span>
            )}
          </div>
          <Field label="Hours after reminder">
            {c.isAdmin ? (
              <input type="number" className={s.num} min={0.5} max={24} step={0.5} value={d.cod_voice_delay_hours}
                aria-label="Hours after reminder" onChange={(e) => c.set("cod_voice_delay_hours", Number(e.target.value) || 0)} />
            ) : <span className={s.fieldValue}>{d.cod_voice_delay_hours}</span>}
          </Field>
          <Field label="Max calls">
            {c.isAdmin ? (
              <input type="number" className={s.num} min={1} max={3} step={1} value={d.cod_voice_max_attempts}
                aria-label="Max calls" onChange={(e) => c.set("cod_voice_max_attempts", Number(e.target.value) || 0)} />
            ) : <span className={s.fieldValue}>{d.cod_voice_max_attempts}</span>}
          </Field>
          <Field label="Hours between calls">
            {c.isAdmin ? (
              <input type="number" className={s.num} min={1} max={12} step={1} value={d.cod_voice_retry_hours}
                aria-label="Hours between calls" onChange={(e) => c.set("cod_voice_retry_hours", Number(e.target.value) || 0)} />
            ) : <span className={s.fieldValue}>{d.cod_voice_retry_hours}</span>}
          </Field>
        </div>
      }
      tech={
        <TechDetails>
          <ul>
            <li>Cuts returned parcels (RTO) by making sure the customer really wants a cash-on-delivery order before it ships.</li>
            <li>The order has a fulfillment hold in Shopify until the customer taps Confirm. Tapping Cancel cancels it.</li>
          </ul>
        </TechDetails>
      }
    />
  );
}

export function ShippingCard({ c }: { c: FlowsCtx }) {
  return (
    <AutomationCard
      icon={Truck}
      title="Shipping update"
      line="When an order ships, send the tracking link"
      enabled={c.saved.shipping_update_enabled}
      locked={!c.isAdmin}
      badge={!c.isAdmin ? LOCK_BADGE : undefined}
      onToggle={() => c.requestToggle("shipping_update_enabled", !c.saved.shipping_update_enabled)}
      steps={[
        { kind: "trigger", title: "The order is shipped" },
        { kind: "wait", title: "A few seconds" },
        { kind: "message", title: "Tracking link", detail: "opens the Shopify order status page" },
      ]}
      preview={<MessagePreview name="shipping_update" templates={c.templates} statusRows={c.statusRows} />}
      tech={
        <TechDetails>
          <ul>
            <li>Exactly one message per shipment. If an order ships in two parts, each part gets its own update.</li>
            <li>The link always points to the Shopify order status page, never a guessed courier link.</li>
          </ul>
        </TechDetails>
      }
    />
  );
}

const HOURS = Array.from({ length: 25 }, (_, i) => i);
const hourLabel = (h: number) => (h === 24 ? "midnight" : h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`);

export function VoiceCard({ c }: { c: FlowsCtx }) {
  const d = c.draft;
  const v = c.voice;
  return (
    <AutomationCard
      icon={Phone}
      title="Voice rescue call"
      line={`About ${d.cart_voice_delay_minutes} minutes after a customer leaves their cart, a friendly AI voice gives them one call`}
      enabled={c.saved.voice_call_enabled}
      locked={!c.isAdmin}
      badge={!c.isAdmin ? LOCK_BADGE : undefined}
      onToggle={() => c.requestToggle("voice_call_enabled", !c.saved.voice_call_enabled)}
      steps={[
        { kind: "trigger", title: "A customer leaves their cart" },
        { kind: "wait", title: `${d.cart_voice_delay_minutes} min`, detail: "after the cart goes quiet" },
        { kind: "message", title: "One AI phone call", detail: `in ${d.voice_language}, ${hourLabel(d.voice_call_start_hour)} to ${hourLabel(d.voice_call_end_hour)}` },
      ]}
      settings={
        <div className={s.settings}>
          <Field label="Call after the cart goes quiet">
            {c.isAdmin ? (
              <span className={s.dur}>
                <input type="number" className={s.num} min={5} max={180} step={5} value={d.cart_voice_delay_minutes}
                  aria-label="Minutes before the call" onChange={(e) => c.set("cart_voice_delay_minutes", Number(e.target.value) || 0)} />
                <span className={s.hint}>minutes</span>
              </span>
            ) : <span className={s.fieldValue}>{d.cart_voice_delay_minutes} minutes</span>}
          </Field>
          <span className={s.hint}>If the call connects, the WhatsApp cart reminders are skipped. If not, they go as usual.</span>
          <Field label="Only carts worth at least">
            {c.isAdmin ? (
              <span className={s.dur}>
                <span className={s.hint}>₹</span>
                <input type="number" className={s.num} min={0} max={100000} step={50} value={d.voice_min_cart_value}
                  aria-label="Minimum cart value in rupees" onChange={(e) => c.set("voice_min_cart_value", Number(e.target.value) || 0)} />
              </span>
            ) : <span className={s.fieldValue}>₹{d.voice_min_cart_value.toLocaleString("en-IN")}</span>}
          </Field>
          <Field label="Calling hours (India time)">
            {c.isAdmin ? (
              <span className={s.dur}>
                <select className={s.select} aria-label="Calls start at" value={d.voice_call_start_hour}
                  onChange={(e) => c.set("voice_call_start_hour", Number(e.target.value))}>
                  {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
                <span className={s.hint}>to</span>
                <select className={s.select} aria-label="Calls end at" value={d.voice_call_end_hour}
                  onChange={(e) => c.set("voice_call_end_hour", Number(e.target.value))}>
                  {HOURS.slice(1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </span>
            ) : <span className={s.fieldValue}>{hourLabel(d.voice_call_start_hour)} to {hourLabel(d.voice_call_end_hour)}</span>}
          </Field>
          <Field label="Language">
            {c.isAdmin ? (
              <select className={s.select} aria-label="Call language" value={d.voice_language}
                onChange={(e) => c.set("voice_language", e.target.value)}>
                {VOICE_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            ) : <span className={s.fieldValue}>{d.voice_language}</span>}
          </Field>
          {d.voice_call_start_hour >= d.voice_call_end_hour && (
            <span className={s.err} role="alert">Calls have to start before they end.</span>
          )}
        </div>
      }
      stats={
        <StatsRow rows={[
          { label: "calls placed", value: v.placed },
          { label: "picked up", value: v.connected },
          { label: "cart link sent", value: v.linkSent },
          { label: "ordered after the call", value: v.recovered },
          { label: "ordered (call and WhatsApp both helped)", value: v.assistedRecovered },
        ]} />
      }
      tech={
        <TechDetails>
          <ul>
            <li>Calls are placed by our voice partner, Sarvam. See each call, its recording and transcript in the Voice tab.</li>
            <li>One call per cart, at most one call per customer per week, and never to anyone who asked us not to call.</li>
            <li>If the customer asks, the voice agent sends their cart link on WhatsApp during the call.</li>
          </ul>
        </TechDetails>
      }
    />
  );
}

const TAGLINE_PLACES = [
  ["tagline_bot_replies", "Chat assistant replies", "the greeting and closing message only, never mid-conversation"],
  ["tagline_proactive_asks", "Review, restock and cart nudges", "the personal chat messages sent inside the 24-hour window"],
  ["tagline_cod_gate", "Cash on delivery confirmation chat", "the confirm or cancel conversation"],
  ["tagline_checkout_footer", "In-chat checkout message", "the small line under the checkout-link message"],
] as const;

export function SignOffCard({ c }: { c: FlowsCtx }) {
  const d = c.draft;
  return (
    <AutomationCard
      icon={MessageSquareText}
      title="Brand sign-off"
      line="The short sign-off added to chat messages our system writes itself"
      enabled={null}
      badge={!c.isAdmin ? LOCK_BADGE : undefined}
      settings={
        <div className={s.main}>
          <Field label="Sign-off text" help={<HelpTip text="Clear the text to drop the sign-off everywhere. Messages that use an approved template are edited in the Templates tab instead." />}>
            {c.isAdmin ? (
              <input className={`${s.text} ${s.wide}`} value={d.tagline_text} maxLength={60} aria-label="Sign-off text"
                placeholder="e.g. Your Munchy Pal" onChange={(e) => c.set("tagline_text", e.target.value)} />
            ) : <span className={s.fieldValue}>{d.tagline_text || "No sign-off"}</span>}
          </Field>
          <div className={s.toggles}>
            {TAGLINE_PLACES.map(([key, name, sub]) => (
              <div key={key} className={s.toggleRow}>
                <div>
                  <div className={s.toggleName}>{name}</div>
                  <div className={s.toggleSub}>{sub}</div>
                </div>
                {c.isAdmin ? (
                  <Switch on={d[key]} label={`Sign-off on ${name}`} onClick={() => c.set(key, !d[key])} />
                ) : (
                  <span className={s.stateText}>{d[key] ? "Shown" : "Not shown"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      }
    />
  );
}
