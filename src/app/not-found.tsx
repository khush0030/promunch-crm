// App-wide 404. Public-safe: no data fetching, no session reads. "Go to Home"
// points at /dashboard; the middleware sends anyone signed out to /login.
import Link from "next/link";
import { SearchX } from "lucide-react";
import s from "./not-found.module.css";

export default function NotFound() {
  return (
    <main className={s.solo}>
      <div className={s.card}>
        <div className={s.empty}>
          <div className={s.art}>
            <SearchX aria-hidden />
            <span className={s.sticker}>404</span>
          </div>
          <h1 className={s.title}>Chips could never find this page</h1>
          <p className={s.text}>The link is old or mistyped. Head back to Home and pick up from there.</p>
          <div className={s.actions}>
            <Link href="/dashboard" className={`${s.btn} ${s.btnPrimary}`}>
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
