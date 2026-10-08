// Public unsubscribe confirmation page. Reachable without a session (middleware
// allowlists /u). Applying is idempotent, so landing here directly, or twice,
// is safe.

import { verifyUnsubToken } from "@/lib/email/unsubscribe";
import { applyUnsubscribe } from "@/lib/email/apply-unsubscribe";
import { MailX, Link2Off as LinkIcon } from "lucide-react";
import s from "../../not-found.module.css";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let ok = false;
  let email: string | undefined;
  if (token && token !== "invalid") {
    try {
      const contactId = verifyUnsubToken(token);
      if (contactId) {
        const r = await applyUnsubscribe(contactId);
        ok = r.ok;
        email = r.email;
      }
    } catch {
      ok = false;
    }
  }

  return (
    <main className={s.solo}>
      <div className={`${s.card} ${s.cardNarrow}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/promunch-wordmark.png" alt="PROMUNCH" className={s.logo} width={92} height={22} />
        {ok ? (
          <div className={`${s.empty} ${s.emptyTight}`}>
            <div className={s.art}>
              <MailX aria-hidden />
            </div>
            <h1 className={s.title}>You&apos;re unsubscribed</h1>
            <p className={s.text}>
              {email ? (
                <>
                  <b>{email}</b> won&apos;t get marketing emails from PROMUNCH any more. We&apos;re sad to see you go. You
                  can rejoin any time from our website.
                </>
              ) : (
                <>
                  You won&apos;t get marketing emails from PROMUNCH any more. You can rejoin any time from our website.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className={`${s.empty} ${s.emptyTight}`}>
            <div className={s.art}>
              <LinkIcon aria-hidden />
            </div>
            <h1 className={s.title}>This link is not valid</h1>
            <p className={s.text}>
              We couldn&apos;t read this unsubscribe link. Open the most recent PROMUNCH email and tap Unsubscribe
              again, or reply to that email and we&apos;ll remove you.
            </p>
          </div>
        )}
        <p className={s.tagline}>★ Your Munchy Pal</p>
      </div>
    </main>
  );
}
