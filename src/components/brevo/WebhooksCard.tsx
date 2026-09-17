"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { Card, Pill } from "@/components/pm";
import type { WebhookStatus } from "@/app/api/brevo/webhooks/route";
import { getJson, sendJson, errorText, Note, int, dateTime, useBrevoSettings, useInvalidate } from "./format";

// Health tab: are Brevo's webhooks pointed at the CRM, and are events arriving?

export function WebhooksCard() {
  const invalidate = useInvalidate();
  const settings = useBrevoSettings();
  const q = useQuery({ queryKey: ["brevo-webhooks"], queryFn: () => getJson<WebhookStatus>("/api/brevo/webhooks") });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const register = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendJson<{ done: string[] }>("/api/brevo/webhooks", "POST");
      setMsg({ tone: "ok", text: r.done.join(" · ") });
      await invalidate(["brevo-webhooks"], ["brevo-health"]);
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const ok = q.data?.kinds.every((k) => k.registered && k.missingEvents.length === 0) && q.data.secretSet;

  return (
    <Card title="Webhooks" basis="unsubscribes, bounces and engagement pushed to the CRM" right={q.data && <Pill tone={ok ? "good" : "warn"}>{ok ? "connected" : "not connected"}</Pill>}>
      {q.isLoading ? (
        <div className="pm2-skel" />
      ) : q.isError || !q.data ? (
        <Note tone="err">{errorText(q.error)}</Note>
      ) : (
        <div style={{ display: "grid", gap: 10, fontSize: 13.5 }}>
          <div>
            Endpoint <code style={{ wordBreak: "break-all" }}>{q.data.url}</code>
          </div>
          {q.data.kinds.map((k) => (
            <div key={k.type} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ textTransform: "capitalize", minWidth: 100 }}>{k.type}</strong>
              {k.registered ? <Pill tone={k.missingEvents.length ? "warn" : "good"}>#{k.registered.id}</Pill> : <Pill tone="neu">missing</Pill>}
              {k.missingEvents.length > 0 && <span style={{ color: "var(--pm-muted)" }}>missing events: {k.missingEvents.join(", ")}</span>}
            </div>
          ))}
          <div>
            Received last 24h: <strong>{int(q.data.ledger.last24h)}</strong>
            {q.data.ledger.lastReceivedAt ? ` · last at ${dateTime(q.data.ledger.lastReceivedAt)}` : ""}
            {Object.keys(q.data.ledger.byEvent).length > 0 && (
              <span style={{ color: "var(--pm-muted)" }}> · {Object.entries(q.data.ledger.byEvent).map(([e, n]) => `${e} ${n}`).join(", ")}</span>
            )}
          </div>
          <div style={{ color: "var(--pm-muted)" }}>Unsubscribe, spam report and hard bounce add the address to the CRM do-not-email list, so the CRM&apos;s own cart emails skip them too.</div>
          {settings.data?.isOwner && (
            <div>
              <button type="button" className="pm2-btn pri sm" disabled={busy} onClick={register}>
                <Link2 size={14} /> {busy ? "Registering…" : ok ? "Re-register webhooks" : "Register webhooks"}
              </button>
            </div>
          )}
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        </div>
      )}
    </Card>
  );
}
