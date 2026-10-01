"use client";

// WhatsApp health, shown ONLY when something looks wrong: a small pill that
// opens a plain-words explanation of what it means and what (if anything) to
// do. No raw error codes.

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { NextStepCallout } from "@/components/guide";
import { useWaHealth } from "./useHealth";
import h from "./home.module.css";

export function HealthNotice() {
  const { data } = useWaHealth();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const down = data.status === "down";
  const failed = Math.max(0, Number(data.failedOutbound24h ?? 0));
  if (!down && failed === 0) return null;

  const label = down
    ? "WhatsApp connection problem"
    : `${failed.toLocaleString("en-IN")} ${failed === 1 ? "message" : "messages"} didn't arrive today`;

  return (
    <div className={h.health}>
      <button
        type="button"
        className={`${h.healthPill} ${down ? h.healthPillBad : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <AlertTriangle size={14} aria-hidden />
        {label}
        <span className={h.healthWhat}>What does this mean?</span>
        <ChevronDown size={13} aria-hidden className={open ? h.chevOpen : h.chev} />
      </button>
      {open &&
        (down ? (
          <NextStepCallout
            tone="danger"
            title="WhatsApp isn't answering right now"
            body="Our checks couldn't reach the WhatsApp number in the last few minutes. Messages that can't go out now are tried again later, and nobody gets the same message twice. If this is still showing in an hour, tell the owner."
            secondary={{ label: "Got it", onClick: () => setOpen(false) }}
          />
        ) : (
          <NextStepCallout
            tone="info"
            title={`${label}. Usually nothing to do.`}
            body={
              <>
                This counts every WhatsApp message in the last 24 hours that didn&apos;t reach the person, including order updates. Most of the
                time it is Meta <b>holding back</b> marketing messages for people who already got a lot of them that day. That is normal, costs
                nothing, and we try them again later. If one campaign shows many &quot;Didn&apos;t arrive&quot; (not &quot;Held back&quot;),
                open it to see the reason in plain words.
              </>
            }
            primary={{ label: "See my campaigns", href: "/dashboard/whatsapp?tab=campaigns" }}
            secondary={{ label: "Got it", onClick: () => setOpen(false) }}
          />
        ))}
    </div>
  );
}
