"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Mail, Lock, User as UserIcon, ArrowRight } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { isAllowedEmail, ALLOWED_DOMAINS_LABEL } from "@/lib/auth-domains";

type Tab = "signin" | "signup" | "magic";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const supabase = createSupabaseBrowserClient();
  const initialErr =
    params.get("error") === "domain"
      ? `Only ${ALLOWED_DOMAINS_LABEL} email addresses are allowed.`
      : null;
  const [tab, setTab] = useState<Tab>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(initialErr);

  function reset() {
    setErr(null);
    setMsg(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      if (!isAllowedEmail(email)) {
        throw new Error(`Only ${ALLOWED_DOMAINS_LABEL} email addresses are allowed.`);
      }
      if (tab === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        setMsg("Magic link sent. Check your inbox.");
      } else if (tab === "signup") {
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
    }
  }

  const submitLabel = busy
    ? tab === "signup"
      ? "Creating account…"
      : tab === "magic"
      ? "Sending…"
      : "Signing in…"
    : tab === "signup"
    ? "Create account"
    : tab === "magic"
    ? "Send magic link"
    : "Sign in";

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
          {tab === "signup" ? "Create your account" : "Sign in"}
        </h1>
        <div className="sub" style={{ marginBottom: 18 }}>
          {tab === "signup"
            ? `Set up access to PROMUNCH CRM. Only ${ALLOWED_DOMAINS_LABEL} emails are allowed.`
            : `Use your ${ALLOWED_DOMAINS_LABEL} email to continue.`}
        </div>

        <div className="tabs" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`tab${tab === "signin" ? " active" : ""}`}
            onClick={() => {
              setTab("signin");
              reset();
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`tab${tab === "signup" ? " active" : ""}`}
            onClick={() => {
              setTab("signup");
              reset();
            }}
          >
            Sign up
          </button>
          <button
            type="button"
            className={`tab${tab === "magic" ? " active" : ""}`}
            onClick={() => {
              setTab("magic");
              reset();
            }}
          >
            Magic link
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {tab === "signup" && (
            <div className="field">
              <label>Full name</label>
              <div style={{ position: "relative" }}>
                <UserIcon
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
                  type="text"
                  className="input"
                  style={{ paddingLeft: 32 }}
                  placeholder="Khush Mutha"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="field">
            <label>Email</label>
            <div style={{ position: "relative" }}>
              <Mail
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
                type="email"
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="you@promunch.in"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          {tab !== "magic" && (
            <div className="field">
              <label>Password{tab === "signup" ? " (min 8 chars)" : ""}</label>
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
                  minLength={tab === "signup" ? 8 : undefined}
                  autoComplete={tab === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          )}

          {err && (
            <div className="pill accent" style={{ alignSelf: "flex-start" }}>
              {err}
            </div>
          )}
          {msg && (
            <div className="pill green" style={{ alignSelf: "flex-start" }}>
              {msg}
            </div>
          )}

          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            style={{ justifyContent: "center", marginTop: 4 }}
          >
            {submitLabel}
            {!busy && <ArrowRight size={14} />}
          </button>
        </form>

        <div style={{ marginTop: 14, textAlign: "center", fontSize: 12.5 }}>
          <span className="muted">
            {tab === "signup" ? "Already have an account? " : "Need an account? "}
          </span>
          <button
            type="button"
            onClick={() => {
              setTab(tab === "signup" ? "signin" : "signup");
              reset();
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              fontFamily: "inherit",
              cursor: "pointer",
              fontSize: 12.5,
              padding: 0,
              fontWeight: 500,
            }}
          >
            {tab === "signup" ? "Sign in" : "Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
