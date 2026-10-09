"use client";

// Live progress of one search: "Found 48 · checking websites 20/48 · 12 have
// an email". The server does the work; this only reads /api/leads/status.
import { Tag } from "@/components/pm";
import s from "./b2b.module.css";
import { nf, plural } from "./api";
import type { SearchProgress } from "./types";

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export default function SearchProgressCard({
  search, onOpenList, onStop, stopping,
}: {
  search: SearchProgress;
  onOpenList?: (listId: string) => void;
  onStop?: (id: string) => void;
  stopping?: boolean;
}) {
  const searching = search.status === "pending" || search.status === "running";
  const checking = search.found - search.checked;
  const pct = search.found ? Math.round((search.checked / search.found) * 100) : 0;
  const tag = search.status === "error"
    ? <Tag tone="red" dot>Stopped by an error</Tag>
    : search.status === "stopped"
      ? <Tag tone="grey" dot>Stopped</Tag>
      : search.active
        ? <Tag tone="blue" dot>Finding</Tag>
        : <Tag tone="green" dot>Done</Tag>;

  return (
    <div className={s.prog}>
      <div className={s.progT}>
        <b>{cap(search.category)} · {cap(search.city)}</b>
        {tag}
        <span className={s.sp} />
        {searching && onStop ? (
          <button type="button" className={s.txtLink} onClick={() => onStop(search.id)} disabled={stopping}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : null}
        {search.list_id && onOpenList ? (
          <button type="button" className={s.txtLink} onClick={() => onOpenList(search.list_id!)}>Open list</button>
        ) : null}
      </div>
      <div className={s.progLine}>
        {search.found === 0 && searching ? (
          <>Looking up businesses on Google Maps…</>
        ) : (
          <>
            Found <b>{nf(search.found)}</b>
            {checking > 0 ? <> · checking websites <b>{nf(search.checked)}/{nf(search.found)}</b></> : null}
            {" · "}<b>{nf(search.withEmail)}</b> {search.withEmail === 1 ? "has" : "have"} an email
          </>
        )}
      </div>
      {search.active && search.found > 0 ? (
        <div className={s.progBar} aria-hidden><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
      ) : null}
      {search.unreachable || search.noWebsite || search.error ? (
        <div className={s.progErr}>
          {[
            search.unreachable ? `${plural(search.unreachable, "website")} couldn't be opened` : null,
            search.noWebsite ? `${plural(search.noWebsite, "business", "businesses")} ${search.noWebsite === 1 ? "has" : "have"} no website` : null,
            search.error ? `Google Maps said: ${search.error.slice(0, 140)}` : null,
          ].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
