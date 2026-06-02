"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Lock, ArrowRight } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Where invited users (and password resets) land. They arrive already
// signed in via /auth/callback, so we just collect a password and call
// updateUser. No session → bounce to /login.
export default function SetPasswordPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't set password.");
      setBusy(false);
    }
  }

  if (checking) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--canvas)",
        padding: 24,
      }}
    >
      <div className="card card-pad" style={{ width: "100%", maxWidth: 420, padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <Image
            src="/pm-logo-square.png"
            alt="PROMUNCH"
            width={36}
            height={36}
            style={{ borderRadius: 8, display: "block" }}
            priority
          />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.01em" }}>PROMUNCH</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-2)",
                letterSpacing: "0.14em",
                fontWeight: 500,
              }}
            >
              CRM
            </div>
          </div>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 4 }}>
          Set your password
        </h1>
        <div className="sub" style={{ marginBottom: 18 }}>
          Choose a password to finish setting up your account.
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label>New password (min 8 chars)</label>
            <div style={{ position: "relative" }}>
              <Lock
                size={14}
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-3)",
                }}
              />
              <input
                type="password"
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Confirm password</label>
            <div style={{ position: "relative" }}>
              <Lock
                size={14}
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-3)",
                }}
              />
              <input
                type="password"
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>

          {err && (
            <div className="pill accent" style={{ alignSelf: "flex-start" }}>
              {err}
            </div>
          )}

          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            style={{ justifyContent: "center", marginTop: 4 }}
          >
            {busy ? "Saving…" : "Save password"}
            {!busy && <ArrowRight size={14} />}
          </button>
        </form>
      </div>
    </div>
  );
}
