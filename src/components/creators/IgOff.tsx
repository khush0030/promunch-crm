// Shown on Find and Outreach while the Instagram side is not switched on in
// this environment (its tables were never migrated, every read answers
// "Could not find the table ..."). Plain text between hairlines, no error toast.

import Link from "next/link";
import s from "./creators.module.css";

export function IgOff({ part }: { part: "Find" | "Outreach" }) {
  return (
    <section className={s.card} aria-label={`${part} is not switched on`}>
      <div className={s.empty}>
        <span className={s.tg} data-tone="mute">Not switched on yet</span>
        <b>{part === "Find" ? "Instagram search is built but not switched on" : "Instagram outreach is built but not switched on"}</b>
        <p>
          {part === "Find"
            ? "This step searches Instagram for creators in our niches, scores each one for fit and writes a first DM. It starts working once the Instagram connection is set up."
            : "This step tracks every creator we pitched: replies, AI-suggested barter terms, and follow-ups that wait for your OK. It starts working once the Instagram connection is set up."}
        </p>
        <p className={s.small}>What it needs: the Instagram database tables applied in Supabase, the Instagram webhook and the search key (Apify). Ask the owner before switching it on.</p>
        <p className={s.small}>
          Meanwhile, collabs you agree anywhere (DM, WhatsApp, email) go straight into{" "}
          <Link href="/dashboard/influencers" className={s.inkLink}>Collabs</Link>.
        </p>
      </div>
    </section>
  );
}
