"use client";

// Third column of Live chats (and the customer block on a full-page
// conversation): who this person is and everything that has happened with
// them across channels. Read-only: one GET to /api/inbox/context, links
// out to the full records. Nothing here messages anyone or changes data.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Ticket, UserRound, X } from "lucide-react";
import { Avatar } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/metrics/money";
import { formatWhen } from "@/lib/inbox/when";
import { maskPhone } from "@/lib/inbox/thread";
import type { InboxContext, Tone } from "@/lib/inbox/context";
import { ChannelIcon } from "./ChannelTag";
import s from "./context.module.css";

const TONE: Record<Tone, string> = { good: s.good, info: s.info, warn: s.warn, crit: s.crit, neu: s.neu };

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).replace("Sept", "Sep");
}

export function CustomerContext({
  conversationKey,
  onClose,
  embedded = false,
}: {
  /** "wa-<id>" or "em-<id>" */
  conversationKey: string;
  /** shown as an × when the panel is a drawer (narrow laptops) */
  onClose?: () => void;
  /** inside a full-page conversation's side column (no own scroll) */
  embedded?: boolean;
}) {
  const toast = useToast();
  const q = useQuery({
    queryKey: ["inbox-context", conversationKey],
    queryFn: async (): Promise<InboxContext> => {
      const r = await fetch(`/api/inbox/context?key=${encodeURIComponent(conversationKey)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `context ${r.status}`);
      return j as InboxContext;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const root = `${s.root}${embedded ? ` ${s.embedded}` : ""}`;
  const close = onClose ? (
    <button type="button" className={s.close} onClick={onClose} aria-label="Close customer panel">
      <X width={18} height={18} />
    </button>
  ) : null;

  if (q.isLoading) {
    return (
      <div className={root} aria-busy="true">
        {close}
        <div className={s.sec}>
          <div className="pm2-skel" style={{ minHeight: 64 }} />
          <div className="pm2-skel" style={{ minHeight: 48, marginTop: 12 }} />
          <div className="pm2-skel" style={{ minHeight: 160, marginTop: 12 }} />
        </div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className={root}>
        {close}
        <div className={s.sec}>
          <p className={s.muted}>Could not load this customer.</p>
          <button type="button" className="pm2-btn sm" onClick={() => q.refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  const c = q.data;
  const p = c.person;
  const sub = [p.city, p.since ? `customer since ${p.since}` : null].filter(Boolean).join(" · ");

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ kind: "success", text: `${what} copied` });
    } catch {
      toast.push({ kind: "error", text: `Could not copy the ${what.toLowerCase()}` });
    }
  }

  return (
    <div className={root} aria-label="Customer">
      {close}
      {/* who */}
      <div className={s.sec}>
        <div className={s.who}>
          <Avatar name={p.name} size={34} />
          <div className={s.whoTx}>
            <b>{p.name}</b>
            {sub ? <span>{sub}</span> : null}
          </div>
        </div>
        <dl className={s.kv}>
          <dt>WhatsApp</dt>
          <dd>{p.phone ? maskPhone(p.phone) : <span className={s.muted}>None</span>}</dd>
          <dt>Email</dt>
          <dd>{p.email ? p.email : <span className={s.muted}>None</span>}</dd>
        </dl>
        <div className={s.qacts}>
          {p.phone ? (
            <button type="button" onClick={() => copy(p.phone as string, "Number")}>
              <Copy width={15} height={15} />Number
            </button>
          ) : null}
          {p.email ? (
            <button type="button" onClick={() => copy(p.email as string, "Email")}>
              <Copy width={15} height={15} />Email
            </button>
          ) : null}
          {p.contactId ? (
            <Link href={`/dashboard/contacts/${p.contactId}`}>
              <UserRound width={15} height={15} />Profile
            </Link>
          ) : null}
        </div>
      </div>

      {/* numbers */}
      <div className={`${s.sec} ${s.stats}`}>
        <div>
          <b>{c.stats.orders}{c.stats.ordersCapped ? "+" : ""}</b>
          <span>{c.stats.orders === 1 ? "order" : "orders"}</span>
        </div>
        <div>
          <b>{formatINR(c.stats.spent)}</b>
          <span>spent</span>
        </div>
        <div>
          <b>{c.stats.tickets}</b>
          <span>{c.stats.tickets === 1 ? "ticket" : "tickets"}</span>
        </div>
      </div>

      {c.tags.length ? (
        <div className={s.sec}>
          <div className={s.tags}>
            {c.tags.map((t) => (
              <span key={t.text} className={`${s.tag} ${TONE[t.tone]}`}>{t.text}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* COD gate */}
      {c.cod ? (
        <div className={s.sec}>
          <div className={s.eyebrow}>Cash on delivery</div>
          <div className={s.codLine}>
            <span className={`${s.dot} ${TONE[c.cod.tone]}`}>{c.cod.text}</span>
            <span className={s.muted}>{c.cod.orderNumber}{c.cod.at ? ` · ${shortDate(c.cod.at)}` : ""}</span>
          </div>
        </div>
      ) : null}

      {/* orders */}
      <div className={s.sec}>
        <div className={s.eyebrow}>Orders</div>
        {c.orders.length === 0 ? (
          <p className={s.muted}>No orders on this number or email.</p>
        ) : (
          <ul className={s.list}>
            {c.orders.map((o) => {
              const inner = (
                <>
                  <div className={s.lt}>
                    <b>{o.number} · {formatINR(o.total)}</b>
                    <span className={`${s.dot} ${TONE[o.state.tone]}`}>{o.state.text}</span>
                  </div>
                  <div className={s.ls}>
                    {[shortDate(o.placedAt), o.pay, o.items].filter(Boolean).join(" · ")}
                  </div>
                </>
              );
              return (
                <li key={o.number || o.placedAt || o.items}>
                  {o.adminUrl ? (
                    <a href={o.adminUrl} target="_blank" rel="noreferrer" className={s.item} title="Open in Shopify">
                      {inner}
                    </a>
                  ) : (
                    <div className={s.item}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* tickets */}
      {c.tickets.length ? (
        <div className={s.sec}>
          <div className={s.eyebrow}>Tickets</div>
          <ul className={s.list}>
            {c.tickets.map((t) => (
              <li key={t.number}>
                <Link href={t.href} className={s.item}>
                  <div className={s.lt}>
                    <b><Ticket width={14} height={14} className={s.ico} />#{t.number} · {t.topic}</b>
                    <span className={`${s.dot} ${TONE[t.status.tone]}`}>{t.status.text}</span>
                  </div>
                  <div className={s.ls}>
                    Opened {shortDate(t.openedAt) || "earlier"}
                    {t.resolvedAt ? ` · solved ${shortDate(t.resolvedAt)}` : ""}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* WhatsApp */}
      <div className={s.sec}>
        <div className={s.eyebrow}>
          <ChannelIcon channel="wa" size={13} /> WhatsApp
        </div>
        {!c.whatsapp ? (
          <p className={s.muted}>No WhatsApp chat with this customer.</p>
        ) : c.whatsapp.isOpen ? (
          <p className={s.muted}>
            This chat. <span className={`${s.dot} ${TONE[c.whatsapp.status.tone]}`}>{c.whatsapp.status.text}</span>
          </p>
        ) : (
          <Link href={`/dashboard/inbox/wa-${c.whatsapp.threadId}`} className={`${s.item} ${s.chItem}`}>
            <div className={s.lt}>
              <b>Chat</b>
              <span className={`${s.dot} ${TONE[c.whatsapp.status.tone]}`}>{c.whatsapp.status.text}</span>
            </div>
            {c.whatsapp.messages.length ? (
              <div className={s.excerpt}>
                {c.whatsapp.messages.map((m, i) => (
                  <p key={i} className={m.mine ? s.mine : undefined}>
                    <span>{m.mine ? "Us" : "Them"}</span>
                    {m.text}
                  </p>
                ))}
              </div>
            ) : c.whatsapp.snippet ? (
              <div className={s.ls}>{c.whatsapp.snippet}</div>
            ) : null}
            {c.whatsapp.lastAt ? <div className={s.ls}>Last message · {formatWhen(c.whatsapp.lastAt)}</div> : null}
          </Link>
        )}
      </div>

      {/* Email */}
      <div className={s.sec}>
        <div className={s.eyebrow}>
          <ChannelIcon channel="em" size={13} /> Email
        </div>
        {c.emails.length === 0 ? (
          <p className={s.muted}>{p.email ? "No support emails from this address." : "No email on file."}</p>
        ) : (
          <ul className={s.list}>
            {c.emails.map((e) => (
              <li key={e.id}>
                <Link href={`/dashboard/inbox/email?id=${encodeURIComponent(e.id)}`} className={`${s.item}${e.isOpen ? ` ${s.current}` : ""}`}>
                  <div className={s.lt}>
                    <b>{e.subject}</b>
                    <span className={`${s.dot} ${TONE[e.status.tone]}`}>{e.status.text}</span>
                  </div>
                  <div className={s.ls}>
                    {shortDate(e.at)}
                    {e.isOpen ? " · open now" : ""}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.contactId ? (
        <div className={`${s.sec} ${s.last}`}>
          <Link className="pm2-btn sm" href={`/dashboard/contacts/${p.contactId}`}>
            Full profile <ExternalLink width={14} height={14} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default CustomerContext;
