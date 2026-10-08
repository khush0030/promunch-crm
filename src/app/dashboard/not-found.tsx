// 404 inside the dashboard shell (sidebar and top bar stay), for notFound()
// calls from dashboard pages. No data fetching.
import Link from "next/link";
import { SearchX } from "lucide-react";
import s from "../not-found.module.css";

export default function DashboardNotFound() {
  return (
    <div className="pm-page">
      <div className={`${s.card} ${s.inShell}`}>
        <div className={s.empty}>
          <div className={s.art}>
            <SearchX aria-hidden />
            <span className={s.sticker}>404</span>
          </div>
          <h1 className={s.title}>Chips could never find this page</h1>
          <p className={s.text}>The link is old or mistyped. Search from Home, or press ⌘K.</p>
          <div className={s.actions}>
            <Link href="/dashboard" className={`${s.btn} ${s.btnPrimary}`}>
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
