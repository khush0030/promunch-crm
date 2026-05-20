"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const supabase = createSupabaseBrowserClient();
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) throw error;
        setMsg("Magic link sent. Check your inbox.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

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
      <div className="card card-pad" style={{ width: "100%", maxWidth: 400, padding: 32 }}>
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
            <div style={{ fontSize: 11, color: "var(--text-2)", letterSpacing: "0.14em", fontWeight: 500 }}>
              CRM
            </div>
          </div>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 4 }}>
          Sign in
        </h1>
        <div className="sub" style={{ marginBottom: 22 }}>
          Use your team email to continue.
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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

          {mode === "password" && (
            <div className="field">
              <label>Password</label>
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
                  autoComplete="current-password"
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

          <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: "center" }}>
            {busy ? "Signing in…" : mode === "magic" ? "Send magic link" : "Sign in"}
            {!busy && <ArrowRight size={14} />}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12.5 }}>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "magic" : "password");
              setErr(null);
              setMsg(null);
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              fontFamily: "inherit",
              cursor: "pointer",
              fontSize: 12.5,
            }}
          >
            {mode === "password" ? "Use magic link instead" : "Use password instead"}
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
