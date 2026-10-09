"use client";

import { FileText, ExternalLink, Phone, CornerUpLeft } from "lucide-react";
import type { TemplateButton } from "./types";

/* Render WhatsApp body text exactly as the app shows it: *bold*, _italic_,
   ~strikethrough~, ```monospace```, with nesting. Newlines are preserved by the
   container's white-space: pre-wrap. WhatsApp supports NO colors or fonts — these
   four marks plus emojis are the entire formatting surface. */
const WA_MARKS: { re: RegExp; style: React.CSSProperties }[] = [
  { re: /```([\s\S]+?)```/, style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace" } },
  { re: /\*([^*\n]+?)\*/, style: { fontWeight: 700 } },
  { re: /_([^_\n]+?)_/, style: { fontStyle: "italic" } },
  { re: /~([^~\n]+?)~/, style: { textDecoration: "line-through" } },
];

// Preview-only: show an unfilled-variable placeholder in muted grey so it reads
// as "still to fill" rather than as message text.
function muteLeaf(text: string, mute: string | undefined, key: string): React.ReactNode[] {
  if (!mute || !text.includes(mute)) return [text];
  const out: React.ReactNode[] = [];
  text.split(mute).forEach((part, i) => {
    if (i > 0) out.push(<span key={`${key}m${i}`} style={{ color: "#8696a0", fontStyle: "italic" }}>{mute}</span>);
    if (part) out.push(part);
  });
  return out;
}

export function renderWhatsApp(text: string, key = "w", mute?: string): React.ReactNode[] {
  if (!text) return [];
  // Find the earliest-starting mark anywhere in the string.
  let best: { idx: number; len: number; inner: string; style: React.CSSProperties } | null = null;
  for (const m of WA_MARKS) {
    const match = m.re.exec(text);
    if (match && (best === null || match.index < best.idx)) {
      best = { idx: match.index, len: match[0].length, inner: match[1], style: m.style };
    }
  }
  if (!best) return muteLeaf(text, mute, key);
  const out: React.ReactNode[] = [];
  if (best.idx > 0) out.push(...muteLeaf(text.slice(0, best.idx), mute, `${key}l`));
  out.push(
    <span key={`${key}${best.idx}`} style={best.style}>{renderWhatsApp(best.inner, `${key}${best.idx}-`, mute)}</span>,
  );
  const rest = text.slice(best.idx + best.len);
  if (rest) out.push(...renderWhatsApp(rest, `${key}r`, mute));
  return out;
}

/* Pixel-faithful preview of how the template lands in a customer's WhatsApp. */
export function WhatsAppPreview({
  headerType, headerMediaUrl, headerText, body, footer, buttons, mutedPlaceholder,
}: {
  headerType?: string | null; headerMediaUrl?: string | null; headerText?: string | null;
  body: string; footer?: string | null; buttons?: TemplateButton[] | null;
  /** Literal placeholder text to show muted (preview of unfilled variables). */
  mutedPlaceholder?: string;
}) {
  const ht = (headerType ?? "").toUpperCase();
  const btns = (buttons ?? []).filter((b) => b && b.text);
  return (
    <div style={{ background: "#E5DDD5", borderRadius: 12, padding: 14, minHeight: 120 }}>
      <div style={{
        background: "#fff", borderRadius: 8, maxWidth: 320, padding: 6,
        boxShadow: "0 1px 1px rgba(0,0,0,0.12)", fontSize: 14.5, lineHeight: 1.4, color: "#111b21",
      }}>
        {ht === "IMAGE" && headerMediaUrl && (
          <img src={headerMediaUrl} alt="" style={{ width: "100%", borderRadius: 6, marginBottom: 4, display: "block" }} />
        )}
        {ht === "VIDEO" && headerMediaUrl && (
          <video src={headerMediaUrl} controls style={{ width: "100%", borderRadius: 6, marginBottom: 4, display: "block" }} />
        )}
        {ht === "DOCUMENT" && headerMediaUrl && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0f2f5", borderRadius: 6, padding: 8, marginBottom: 4 }}>
            <FileText size={20} color="#54656f" /><span style={{ fontSize: 13, color: "#54656f" }}>Document attached</span>
          </div>
        )}
        {ht === "TEXT" && headerText && (
          <div style={{ fontWeight: 700, padding: "2px 6px 0", marginBottom: 2 }}>{muteLeaf(headerText, mutedPlaceholder, "h")}</div>
        )}
        <div style={{ padding: "2px 6px 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {body ? renderWhatsApp(body, "w", mutedPlaceholder) : <span style={{ color: "#8696a0" }}>Your message body…</span>}
        </div>
        {footer && <div style={{ padding: "4px 6px 2px", fontSize: 12, color: "#8696a0" }}>{footer}</div>}
        <div style={{ textAlign: "right", fontSize: 11, color: "#8696a0", padding: "0 6px 2px" }}>
          {(() => { const d = new Date(); let h = d.getHours(); const mm = String(d.getMinutes()).padStart(2, "0"); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${mm} ${ap}`; })()}
        </div>
        {btns.length > 0 && (
          <div style={{ borderTop: "1px solid #e9edef", marginTop: 2 }}>
            {btns.map((b, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                color: "#00a5f4", fontWeight: 500, padding: "8px 6px", fontSize: 14.5,
                borderTop: i > 0 ? "1px solid #e9edef" : "none",
              }}>
                {b.type === "URL" && <ExternalLink size={15} />}
                {b.type === "PHONE_NUMBER" && <Phone size={15} />}
                {b.type === "QUICK_REPLY" && <CornerUpLeft size={15} />}
                {b.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
