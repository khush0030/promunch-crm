"use client";

import { Ban, CheckCircle2, Clock } from "lucide-react";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { Lead } from "./types";

// The three pipeline stages, with each lead's progress through them.
export default function PipelineSteps({ lead }: { lead: Lead }) {
  const hasSite = !!lead.website;
  const analyzed = lead.fit_score != null;
  const emailFound = (lead.lead_contacts ?? []).some((c) => c.verify_status === "mx_ok");
  const enriched = !!(lead.enrichment && (lead.enrichment.summary || lead.enrichment.fitAngle));
  const steps: { label: string; done: boolean; skipped?: boolean }[] = [
    { label: "1. Analysis", done: analyzed },
    { label: "2. Email finding", done: emailFound, skipped: !hasSite },
    { label: "3. Enrichment", done: enriched, skipped: !hasSite },
  ];
  return (
    <div className={styles.steps}>
      {steps.map((s) => (
        <div key={s.label} className={`${styles.step} ${s.done ? styles.stepDone : s.skipped ? styles.stepSkip : styles.stepWait}`}>
          {s.done ? <CheckCircle2 size={13} /> : s.skipped ? <Ban size={13} /> : <Clock size={13} />}
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
