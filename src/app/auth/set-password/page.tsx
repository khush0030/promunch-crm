"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AuthSplit } from "../../login/AuthSplit";
import s from "../../login/auth.module.css";

// Display-only strength meter. The rules that gate saving are unchanged
// (min 8 characters + both fields match, checked in handleSubmit).
function strength(pw: string): { pct: number; color: string; label: string } {
  if (!pw) return { pct: 0, color: "#5C554E", label: "At least 8 characters." };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) return { pct: 15, color: "#B3261E", label: "At least 8 characters. Too short." };
  if (score <= 2) return { pct: 45, color: "#A96500", label: "At least 8 characters. Okay." };
  if (score === 3) return { pct: 70, color: "#2E7D46", label: "At least 8 characters. Good." };
  return { pct: 100, color: "#2E7D46", label: "At least 8 characters. Strong." };
}

// Where invited users (and password resets) land. They arrive already
// signed in via /auth/callback, so we just collect a password and call
// updateUser. No session → bounce to /login.
export default function SetPasswordPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [checking, setChecking] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
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
      setUserEmail(data.user.email ?? null);
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

  const meter = strength(password);

  return (
    <AuthSplit
      headline={
        <>
          Welcome
          <br />
          to the crew.
        </>
      }
      eyebrow="★ PROMUNCH CRM · Your Munchy Pal"
    >
      <h2 className={s.h2}>Set your password</h2>
      <p className={s.sub}>{userEmail ? `For ${userEmail}` : "Choose a password to finish setting up your account."}</p>

      <form onSubmit={handleSubmit} className={s.form}>
        <div className={s.field}>
          <label className={s.label} htmlFor="sp-password">
            New password
          </label>
          <input
            id="sp-password"
            type="password"
            className={s.input}
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="sp-hint"
          />
          <span id="sp-hint" className={s.hint}>
            {meter.label}
          </span>
          <div className={s.bar} aria-hidden>
            <i style={{ width: `${meter.pct}%`, background: meter.color }} />
          </div>
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor="sp-confirm">
            Type it again
          </label>
          <input
            id="sp-confirm"
            type="password"
            className={s.input}
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <button type="submit" className={`${s.btn} ${s.primary}`} disabled={busy}>
          {busy ? "Saving…" : "Save and open the CRM"}
        </button>
      </form>

      {err && (
        <div role="alert" className={`${s.msg} ${s.msgBad}`}>
          {err}
        </div>
      )}
    </AuthSplit>
  );
}
