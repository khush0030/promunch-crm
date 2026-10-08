"use client";

import { useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { isAllowedEmail, ALLOWED_DOMAINS_LABEL, ALLOWED_EMAIL_DOMAINS } from "@/lib/auth-domains";
import { safeAuthNext } from "@/lib/auth-options";
import { AuthSplit } from "./AuthSplit";
import s from "./auth.module.css";

type Tab = "signin" | "signup" | "magic" | "reset";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeAuthNext(params.get("next"));

  const supabase = createSupabaseBrowserClient();
  const initialErr =
    params.get("error") === "domain"
      ? `Only ${ALLOWED_DOMAINS_LABEL} email addresses are allowed.`
      : params.get("error") === "auth"
        ? "This sign-in link is invalid or expired. Request a new link and open it in the same browser."
        : null;
  const [tab, setTab] = useState<Tab>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Which action is in flight, so the right button shows "Sending…".
  const [pending, setPending] = useState<Tab | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(initialErr);

  function reset() {
    setErr(null);
    setMsg(null);
  }

  function switchTo(t: Tab) {
    setTab(t);
    reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await run(tab);
  }

  // "Email me a sign-in link" from the sign-in form: same magic-link call as
  // before, it only needs a valid email (the password field is ignored).
  async function sendMagicLink() {
    if (emailRef.current && !emailRef.current.reportValidity()) return;
    await run("magic");
  }

  async function run(mode: Tab) {
    reset();
    setBusy(true);
    setPending(mode);
    try {
      if (!isAllowedEmail(email)) {
        throw new Error(`Only ${ALLOWED_DOMAINS_LABEL} email addresses are allowed.`);
      }
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/set-password`,
        });
        if (error) throw error;
        setMsg("If an account exists for this email, a reset link is on its way. Open it in this browser.");
      } else if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        setMsg("Magic link sent. Check your inbox.");
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("Password must be at least 8 characters.");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name || email.split("@")[0] },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        if (data.session) {
          // Auto-confirm is on — session ready, go.
          router.replace(next);
          router.refresh();
        } else {
          // Email confirmation required.
          setMsg("Account created. Check your email to confirm before signing in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const primaryBusy = busy && pending === tab;
  const submitLabel = primaryBusy
    ? tab === "signup"
      ? "Creating account…"
      : tab === "magic" || tab === "reset"
      ? "Sending…"
      : "Signing in…"
    : tab === "signup"
    ? "Create account"
    : tab === "magic"
    ? "Send magic link"
    : tab === "reset"
    ? "Send reset link"
    : "Sign in";

  const domainNote = `Only ${ALLOWED_EMAIL_DOMAINS.slice(1).join(", ")} and ${ALLOWED_EMAIL_DOMAINS[0]} emails can sign in.`;

  return (
    <AuthSplit
      headline={
        <>
          Crunch
          <br />
          the numbers.
        </>
      }
      eyebrow="★ PROMUNCH CRM · Your Munchy Pal"
    >
      <h2 className={s.h2}>
        {tab === "signup" ? "Create your account" : tab === "reset" ? "Reset your password" : "Sign in"}
      </h2>
      <p className={s.sub}>
        {tab === "signup"
          ? "Set up access to the PROMUNCH CRM with your work email."
          : tab === "reset"
          ? "We'll email you a link to set a new password."
          : "Use your PROMUNCH work email."}
      </p>

      <form onSubmit={handleSubmit} className={s.form}>
        {tab === "signup" && (
          <div className={s.field}>
            <label className={s.label} htmlFor="login-name">
              Full name
            </label>
            <input
              id="login-name"
              type="text"
              className={s.input}
              placeholder="Khush Mutha"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        <div className={s.field}>
          <label className={s.label} htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            ref={emailRef}
            type="email"
            className={s.input}
            placeholder="you@promunch.in"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {(tab === "signin" || tab === "signup") && (
          <div className={s.field}>
            <div className={s.labelRow}>
              <label className={s.label} htmlFor="login-password">
                Password{tab === "signup" ? " (min 8 characters)" : ""}
              </label>
              {tab === "signin" && (
                <button type="button" className={s.quiet} onClick={() => switchTo("reset")}>
                  Forgot password?
                </button>
              )}
            </div>
            <input
              id="login-password"
              type="password"
              className={s.input}
              required
              minLength={tab === "signup" ? 8 : undefined}
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        <button type="submit" className={`${s.btn} ${s.primary}`} disabled={busy}>
          {submitLabel}
        </button>

        {tab === "signin" && (
          <button type="button" className={`${s.btn} ${s.ghostGap}`} disabled={busy} onClick={sendMagicLink}>
            {busy && pending === "magic" ? "Sending…" : "Email me a sign-in link"}
          </button>
        )}
      </form>

      {err && (
        <div role="alert" className={`${s.msg} ${s.msgBad}`}>
          {err}
        </div>
      )}
      {msg && (
        <div role="status" className={`${s.msg} ${s.msgGood}`}>
          {msg}
        </div>
      )}

      <p className={s.note}>{domainNote}</p>

      {tab === "signin" ? (
        <p className={s.switchLine}>
          New to the team?{" "}
          <button type="button" className={s.quiet} onClick={() => switchTo("signup")}>
            Create an account
          </button>
        </p>
      ) : (
        <p className={s.switchLine}>
          {tab === "signup" ? "Already have an account? " : "Remembered it? "}
          <button type="button" className={s.quiet} onClick={() => switchTo("signin")}>
            Back to sign in
          </button>
        </p>
      )}
    </AuthSplit>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
