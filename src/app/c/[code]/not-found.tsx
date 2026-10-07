import s from "./portal.module.css";

// Unknown or malformed portal code. Deliberately says nothing about whether a
// code exists, so codes cannot be probed.
export default function CollabNotFound() {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.brand}>PROMUNCH</div>
        <div className={s.tag}>Your Munchy Pal</div>
      </header>
      <main className={s.main}>
        <section className={s.card}>
          <h1 className={s.h2}>We could not find this collab</h1>
          <p className={s.p}>
            Please open the latest link we sent you on WhatsApp. If it still does not work, reply to that message and we
            will send you a fresh one.
          </p>
        </section>
        <footer className={s.foot}>
          <p className={s.sign}>Team PROMUNCH, Your Munchy Pal</p>
        </footer>
      </main>
    </div>
  );
}
