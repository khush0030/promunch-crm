import Link from "next/link";
import { Lock } from "lucide-react";
import s from "../../not-found.module.css";

// Where the middleware sends a member whose admin has switched off every area.
// (A member opening one locked area is redirected to their first open area,
// so this page only ever covers the "no areas at all" case.)
// "Back to Home" goes through the middleware again, so once an admin opens an
// area it lands the member on it; until then it returns here.
export default function NoAccessPage() {
  return (
    <div className="pm-page">
      <div className={`${s.card} ${s.inShell}`}>
        <div className={s.empty}>
          <div className={s.art}>
            <Lock aria-hidden />
          </div>
          <h1 className={s.title}>This area is locked for you</h1>
          <p className={s.text}>
            Your account is set up, but no part of the CRM is switched on for you yet. Ask Khush or Parth to give you
            access in Settings → Team & access, then come back.
          </p>
          <div className={s.actions}>
            <Link href="/dashboard" className={s.btn}>
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
