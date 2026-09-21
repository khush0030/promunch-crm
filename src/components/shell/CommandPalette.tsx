"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User, MessageCircle, CornerDownLeft } from "lucide-react";
import { NAV } from "./nav";
import { useMediaPhone } from "./useMediaPhone";

type Result = { key: string; group: "Pages" | "Customers" | "Conversations"; label: string; sub?: string; href: string };
type Remote = { q: string; customers: Result[]; conversations: Result[] };

type ContactRow = { id: string; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null };
type ThreadRow = {
  id: string;
  wa_id?: string | null;
  ticket_number?: number | null;
  last_message_snippet?: string | null;
  contact?: { name?: string | null; phone?: string | null; wa_id?: string | null } | null;
};

const PAGES: Result[] = NAV.flatMap((h) =>
  h.items.map((it) => ({ key: `p:${h.hub}:${it.label}`, group: "Pages" as const, label: it.label, sub: h.hub, href: it.href })),
);

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const r = await fetch(url, { signal, cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

// ⌘K palette. Pages are matched locally; customers and conversations come
// from the existing list endpoints after 2+ characters (200ms debounce).
// Mounted only while open, so every open starts empty.
export default function CommandPalette({ onClose }: { onClose: (navigated: boolean) => void }) {
  const router = useRouter();
  const phone = useMediaPhone();
  const inputId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [remote, setRemote] = useState<Remote | null>(null);
  const term = q.trim();

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const s = encodeURIComponent(term);
      const [c, w] = await Promise.all([
        getJson<{ contacts?: ContactRow[] }>(`/api/contacts?search=${s}&limit=5`, ctrl.signal),
        getJson<{ threads?: ThreadRow[] }>(`/api/whatsapp/threads?search=${s}&limit=5`, ctrl.signal),
      ]);
      if (ctrl.signal.aborted) return;
      setRemote({
        q: term,
        customers: (c?.contacts ?? []).slice(0, 5).map((r) => ({
          key: `c:${r.id}`,
          group: "Customers",
          label: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || r.phone || "Customer",
          sub: r.phone || r.email || undefined,
          href: `/dashboard/contacts/${r.id}`,
        })),
        conversations: (w?.threads ?? []).slice(0, 5).map((r) => ({
          key: `w:${r.id}`,
          group: "Conversations",
          label: r.contact?.name || r.contact?.phone || r.wa_id || "WhatsApp chat",
          sub: [r.ticket_number ? `#${r.ticket_number}` : "", (r.last_message_snippet || "").split("\n")[0].slice(0, 80)].filter(Boolean).join(" · ") || undefined,
          href: `/dashboard/inbox/wa-${encodeURIComponent(r.id)}`,
        })),
      });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term]);

  const results = useMemo(() => {
    const needle = term.toLowerCase();
    const pages = needle
      ? PAGES.filter((p) => p.label.toLowerCase().includes(needle) || p.sub!.toLowerCase().includes(needle))
      : PAGES;
    const live = term.length >= 2 && remote?.q === term ? remote : null;
    return [...pages, ...(live?.customers ?? []), ...(live?.conversations ?? [])];
  }, [term, remote]);

  const selIndex = Math.min(sel, Math.max(results.length - 1, 0));

  useEffect(() => {
    document.getElementById(`${listId}-${selIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [selIndex, listId]);

  function open(r: Result | undefined) {
    if (!r) return;
    onClose(true);
    router.push(r.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel(results.length ? (selIndex + 1) % results.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel(results.length ? (selIndex - 1 + results.length) % results.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(results[selIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose(false);
    } else if (e.key === "Tab") {
      // Focus stays in the input; the list is driven by arrow keys.
      e.preventDefault();
    }
  }

  return (
    <div className="pm2-overlay" onMouseDown={() => onClose(false)}>
      <div
        className="pm2-cmdk"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-label`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="q">
          <Search aria-hidden />
          <label id={`${inputId}-label`} htmlFor={inputId} className="pm2-sr">
            Search pages, customers and conversations
          </label>
          <input
            ref={input}
            id={inputId}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Search or jump to"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? `${listId}-${selIndex}` : undefined}
          />
          {phone ? (
            <button type="button" className="pm2-cmdk-cancel" onClick={() => onClose(false)}>
              Cancel
            </button>
          ) : (
            <kbd>esc</kbd>
          )}
        </div>
        <div className="list" id={listId} role="listbox" aria-label="Results">
          {results.length === 0 && <div className="empty">No matches for &ldquo;{term}&rdquo;</div>}
          {GROUPS.map((g) => {
            const rows = results.map((r, i) => [r, i] as const).filter(([r]) => r.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} role="group" aria-labelledby={`${listId}-${g}`}>
                <h6 id={`${listId}-${g}`}>{g}</h6>
                {rows.map(([r, i]) => (
                  <div
                    key={r.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === selIndex}
                    className={`it${i === selIndex ? " sel" : ""}`}
                    onMouseMove={() => i !== selIndex && setSel(i)}
                    onClick={() => open(r)}
                  >
                    {r.group === "Customers" ? (
                      <User aria-hidden />
                    ) : r.group === "Conversations" ? (
                      <MessageCircle aria-hidden />
                    ) : (
                      <HubIcon hub={r.sub} />
                    )}
                    <span className="lb">
                      {r.label}
                      {r.sub && <small>{r.sub}</small>}
                    </span>
                    {i === selIndex && <CornerDownLeft aria-hidden className="enter" />}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const GROUPS = ["Pages", "Customers", "Conversations"] as const;

function HubIcon({ hub }: { hub: string | undefined }) {
  const h = NAV.find((x) => x.hub === hub);
  return h ? <h.icon aria-hidden /> : <Search aria-hidden />;
}
