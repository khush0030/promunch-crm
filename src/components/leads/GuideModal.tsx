"use client";

import { X } from "lucide-react";
import styles from "@/app/dashboard/leads/leads.module.css";
import { GUIDE_STEPS } from "./constants";

// -------------------------------------------------------------- guide modal --

export default function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`pm-panel ${styles.modal} ${styles.modalMd}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.guideHead}>
          <div className="card-title">How B2B outreach works</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className="pm-muted" style={{ fontSize: 13, marginTop: 4 }}>
          From a list of company types to sent emails — four steps, mostly automatic.
        </p>

        <ol className={styles.guideList}>
          {GUIDE_STEPS.map((s) => (
            <li key={s.title} className={styles.guideItem}>
              <s.icon size={20} className={styles.guideIcon} />
              <div>
                <div className={styles.guideTitle}>{s.title}</div>
                <div className={styles.guideBlurb}>{s.blurb}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className={styles.guideTips}>
          <div className={styles.guideTipsTitle}>Good to know</div>
          <ul className={styles.guideTipList}>
            <li><b>Find companies</b> queues the searches and starts the work right away. Hit <b>Keep going</b> any time to push leads further along — it also runs automatically every night.</li>
            <li>Each <b>category × city</b> is one Google search of up to ~60 companies. Start small (1–2 categories, 1–2 cities) to keep results focused.</li>
            <li>No contact found? Open the lead and add an email by hand (check their site or LinkedIn).</li>
            <li>In <b>Settings</b>, set a daily send cap and warm up slowly (15 → 30 → 50) so your domain stays trusted. Flip <b>Pause</b> to stop all sends.</li>
            <li><b>Suppress</b> a lead to make sure it’s never emailed.</li>
          </ul>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" className="pm-btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
