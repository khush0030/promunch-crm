export type BubbleItem =
  | { kind: "day"; label: string }
  | { kind: "system"; text: string }
  | { kind: "in" | "human" | "bot" | "template"; text: string; meta: string; mediaUrl?: string; failed?: string };

const BUBBLE_CLASS: Record<"in" | "human" | "bot" | "template", string> = {
  in: "in",
  human: "out",
  bot: "bot",
  template: "tpl",
};

// Conversation transcript (Inbox thread panel + list-row thread preview).
// Day dividers and system notes render as pill-shaped sysline chips; message
// kinds split into the customer's side ("in") and everything sent from our
// side (human reply, bot reply, template fallback), each with its own
// colour/border treatment so a glance tells you who said what.
export function Bubbles({ items }: { items: BubbleItem[] }) {
  return (
    <div className="pm2-convo">
      {items.map((item, i) => {
        if (item.kind === "day") {
          return (
            <span className="pm2-sysline" key={i}>
              {item.label}
            </span>
          );
        }
        if (item.kind === "system") {
          return (
            <span className="pm2-sysline" key={i}>
              {item.text}
            </span>
          );
        }
        return (
          <div className={`pm2-bub ${BUBBLE_CLASS[item.kind]}`} key={i}>
            {item.mediaUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- chat bubble thumbnail from a remote WA/IG media URL, not a static asset
              <img
                src={item.mediaUrl}
                alt={item.kind === "in" ? "Photo from the chat" : "Photo sent"}
                style={{ maxWidth: "100%", borderRadius: 8, display: "block", marginBottom: 4 }}
              />
            ) : null}
            {item.text}
            <small>
              {item.meta}
              {item.failed ? <span className="fail"> · {item.failed}</span> : null}
            </small>
          </div>
        );
      })}
    </div>
  );
}

export default Bubbles;
