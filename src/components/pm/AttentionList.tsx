import Link from "next/link";
import type { AttentionItem } from "@/lib/metrics/attention";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function iconText(item: AttentionItem): string {
  if (item.severity === "info") return "?";
  if (item.count != null) return item.count > 99 ? "99+" : String(item.count);
  return item.severity === "crit" ? "₹" : "!";
}

// One line per decision: severity square, title, context, money at stake, CTA.
// On phones the amount column hides and the button drops under the text.
export function AttentionList({ items, empty }: { items: AttentionItem[]; empty?: React.ReactNode }) {
  if (items.length === 0) return empty != null ? <>{empty}</> : null;
  return (
    <div className="pm2-attlist">
      {items.map((it) => (
        <div className="pm2-att" key={it.id}>
          <span className={`ic ${it.severity}`} aria-label={it.severity === "crit" ? "Urgent" : it.severity === "warn" ? "Soon" : "For info"}>
            {iconText(it)}
          </span>
          <div>
            <div className="t">{it.title}</div>
            <div className="c">{it.context}</div>
          </div>
          <span className="amt">
            {it.amount != null ? (
              <>
                {inr(it.amount)}
                {it.amountLabel && <small>{it.amountLabel}</small>}
              </>
            ) : (
              " "
            )}
          </span>
          <Link href={it.href} className={`pm2-btn sm${it.severity === "crit" ? " pri" : ""}`}>
            {it.cta}
          </Link>
        </div>
      ))}
    </div>
  );
}

export default AttentionList;
