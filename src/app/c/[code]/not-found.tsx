import { PortalFooter, PortalHero } from "./PortalChrome";
import s from "./portal.module.css";

// Unknown or malformed portal code. Deliberately says nothing about whether a
// code exists, so codes cannot be probed.
export default function CollabNotFound() {
  return (
    <div className={s.page}>
      <PortalHero
        step={null}
        title={["Hmm, we can't", "find this collab."]}
        sub="The link may be old or incomplete."
      />
      <main className={s.body}>
        <section className={s.card}>
          <p className={s.eyebrow}>★ What to do</p>
          <p className={s.p}>
            Please open the latest link we sent you on WhatsApp. If it still does not work, reply to that message and we
            will send you a fresh one.
          </p>
        </section>
        <PortalFooter />
      </main>
    </div>
  );
}
