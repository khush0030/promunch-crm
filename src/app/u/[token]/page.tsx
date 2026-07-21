// Public unsubscribe confirmation page. Reachable without a session (middleware
// allowlists /u). Applying is idempotent, so landing here directly — or twice —
// is safe.

import { verifyUnsubToken } from "@/lib/email/unsubscribe";
import { applyUnsubscribe } from "@/lib/email/apply-unsubscribe";

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

  const wrap: React.CSSProperties = {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#F1EBE0",
    padding: "24px",
    fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif",
    color: "#1A1714",
  };
  const card: React.CSSProperties = {
    width: "100%",
    maxWidth: "440px",
    background: "#FFFFFF",
    border: "1px solid #E8DFD0",
    borderRadius: "16px",
    padding: "34px 30px",
    textAlign: "center",
  };

  return (
    <main style={wrap}>
      <div style={card}>
        <div style={{ color: "#1B2A20", fontWeight: 800, fontSize: "20px", letterSpacing: ".5px" }}>
          PROMUNCH
        </div>
        <div style={{ color: "#C98A1E", fontStyle: "italic", fontSize: "12px", marginTop: "2px" }}>
          Your Munchy Pal
        </div>

        {ok ? (
          <>
            <h1 style={{ fontSize: "20px", margin: "22px 0 8px", letterSpacing: "-.3px" }}>
              You are unsubscribed
            </h1>
            <p style={{ color: "#6E665A", fontSize: "13.5px", lineHeight: 1.6, margin: 0 }}>
              {email ? (
                <>
                  <b>{email}</b> will no longer receive PROMUNCH marketing email. We are sad to see you
                  go. You can rejoin any time from our website.
                </>
              ) : (
                <>You will no longer receive PROMUNCH marketing email. You can rejoin any time from our website.</>
              )}
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: "20px", margin: "22px 0 8px", letterSpacing: "-.3px" }}>
              This link is not valid
            </h1>
            <p style={{ color: "#6E665A", fontSize: "13.5px", lineHeight: 1.6, margin: 0 }}>
              We could not read this unsubscribe link. Open the most recent PROMUNCH email and tap
              Unsubscribe again, or reply to that email and we will remove you.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
