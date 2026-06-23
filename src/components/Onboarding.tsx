"use client";

// First-run onboarding for new teammates: a welcome modal, then a guided
// spotlight tour of the sidebar. Shown once per user (tracked in localStorage,
// keyed by user id). Can be replayed any time by dispatching the window event
// `pm:start-tour` (the sidebar "Help & tour" button does this).
//
// Zero dependencies: the spotlight is a fixed overlay with a box-shadow "hole"
// over the target element. On mobile (no persistent sidebar) it falls back to a
// simple centered quick-guide card.

import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Mail,
  MessageCircle,
  CircleCheck,
  Users,
  Megaphone,
  Settings as SettingsIcon,
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Step = {
  tour: string; // matches data-tour="..." on the sidebar nav item
  title: string;
  body: string;
  icon: React.ReactNode;
};

const STEPS: Step[] = [
  {
    tour: "dashboard",
    title: "Your home base",
    body: "Revenue, key numbers and anything that needs attention, all on one screen.",
    icon: <LayoutDashboard size={16} />,
  },
  {
    tour: "support-emails",
    title: "Support Emails",
    body: "Customer emails land here. Reply directly or let the AI draft a response for you.",
    icon: <Mail size={16} />,
  },
  {
    tour: "whatsapp",
    title: "WhatsApp",
    body: "The live WhatsApp inbox and chatbot, orders, support and campaigns in one thread view.",
    icon: <MessageCircle size={16} />,
  },
  {
    tour: "order-confirmations",
    title: "Order Confirmations",
    body: "See which orders still need a confirmation message so none slip through.",
    icon: <CircleCheck size={16} />,
  },
  {
    tour: "contacts",
    title: "Contacts",
    body: "Every customer, enriched and segmented, ready to target.",
    icon: <Users size={16} />,
  },
  {
    tour: "campaigns",
    title: "Campaigns",
    body: "Build and send email or WhatsApp campaigns to the right segment.",
    icon: <Megaphone size={16} />,
  },
  {
    tour: "settings",
    title: "Settings & your team",
    body: "Connect Shopify and email, set your brand, and invite teammates from the Team tab.",
    icon: <SettingsIcon size={16} />,
  },
];

const PADDING = 8;

type Phase = "idle" | "welcome" | "tour" | "guide";

export default function Onboarding() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState<string>("");
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const isMobile = () => typeof window !== "undefined" && window.innerWidth <= 768;

  const finish = useCallback(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, "1");
      } catch {}
    }
    setPhase("idle");
    setStep(0);
  }, [storageKey]);

  // Resolve the signed-in user, decide whether to auto-open, and wire the replay
  // event.
  useEffect(() => {
    let mounted = true;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const u = data.user;
      if (!u) return;
      const meta = (u.user_metadata || {}) as Record<string, unknown>;
      const fullName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        (u.email ? u.email.split("@")[0] : "there");
      setName(fullName);
      const key = `pm_onboarded_${u.id}`;
      setStorageKey(key);
      let seen = false;
      try {
        seen = localStorage.getItem(key) === "1";
      } catch {}
      if (!seen) setPhase("welcome");
    });

    const onReplay = () => {
      setStep(0);
      setPhase(isMobile() ? "guide" : "tour");
    };
    window.addEventListener("pm:start-tour", onReplay);
    return () => {
      mounted = false;
      window.removeEventListener("pm:start-tour", onReplay);
    };
  }, []);

  // Track the spotlight target's position while the tour runs.
  useEffect(() => {
    if (phase !== "tour") return;
    const update = () => {
      const sel = `[data-tour="${STEPS[step].tour}"]`;
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: "nearest" });
      setRect(el.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [phase, step]);

  function startTour() {
    setStep(0);
    setPhase(isMobile() ? "guide" : "tour");
  }

  function next() {
    if (step >= STEPS.length - 1) finish();
    else setStep((s) => s + 1);
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  if (phase === "idle") return null;

  // --- Welcome modal -------------------------------------------------------
  if (phase === "welcome") {
    return (
      <Backdrop onClose={finish}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={badgeStyle}>
              <Sparkles size={15} />
            </span>
            <div style={{ fontSize: 12, letterSpacing: "0.14em", color: "var(--text-2)", fontWeight: 600 }}>
              WELCOME TO PROMUNCH CRM
            </div>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", margin: "0 0 8px" }}>
            Hi {name || "there"} 👋
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: "0 0 20px" }}>
            This is where the team runs orders, support, WhatsApp and campaigns. Take a 60-second tour
            and we&apos;ll show you around the dashboard.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn primary" style={{ justifyContent: "center" }} onClick={startTour}>
              Take the tour <ArrowRight size={14} />
            </button>
            <button className="btn" style={{ justifyContent: "center" }} onClick={finish}>
              Skip for now
            </button>
          </div>
        </div>
      </Backdrop>
    );
  }

  // --- Mobile quick guide --------------------------------------------------
  if (phase === "guide") {
    return (
      <Backdrop onClose={finish}>
        <div style={{ ...cardStyle, maxHeight: "80vh", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Quick guide</h2>
            <button onClick={finish} aria-label="Close" style={iconBtnStyle}>
              <X size={18} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {STEPS.map((s) => (
              <div key={s.tour} style={{ display: "flex", gap: 10 }}>
                <span style={{ ...badgeStyle, flex: "0 0 auto" }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn primary"
            style={{ justifyContent: "center", width: "100%", marginTop: 18 }}
            onClick={finish}
          >
            Got it
          </button>
        </div>
      </Backdrop>
    );
  }

  // --- Desktop spotlight tour ---------------------------------------------
  const s = STEPS[step];
  const tipTop = rect ? Math.max(12, Math.min(rect.top, window.innerHeight - 220)) : 80;
  const tipLeft = rect ? rect.right + 16 : 96;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }} aria-live="polite">
      {/* Spotlight hole (or full dim if target missing) */}
      {rect ? (
        <div
          style={{
            position: "fixed",
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(36,30,24,0.58)",
            pointerEvents: "none",
            transition: "all 0.18s ease",
          }}
        />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(36,30,24,0.58)" }} />
      )}

      {/* Tooltip */}
      <div
        style={{
          position: "fixed",
          top: tipTop,
          left: Math.min(tipLeft, window.innerWidth - 320),
          width: 300,
          background: "var(--surface, #fff)",
          border: "1px solid var(--border, #E7E0D5)",
          borderRadius: 14,
          padding: 18,
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={badgeStyle}>{s.icon}</span>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{s.title}</div>
          <button onClick={finish} aria-label="Close tour" style={{ ...iconBtnStyle, marginLeft: "auto" }}>
            <X size={16} />
          </button>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-2)", margin: "0 0 14px" }}>{s.body}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {step + 1} / {STEPS.length}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {step > 0 && (
              <button className="btn" style={{ padding: "6px 12px" }} onClick={back}>
                <ArrowLeft size={13} /> Back
              </button>
            )}
            <button className="btn primary" style={{ padding: "6px 14px" }} onClick={next}>
              {step >= STEPS.length - 1 ? "Done" : "Next"}
              {step < STEPS.length - 1 && <ArrowRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(36,30,24,0.5)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 440,
  background: "var(--surface, #fff)",
  border: "1px solid var(--border, #E7E0D5)",
  borderRadius: 18,
  padding: 28,
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};

const badgeStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 30,
  height: 30,
  borderRadius: 9,
  background: "rgba(185,48,63,0.10)",
  color: "#B9303F",
};

const iconBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-3)",
  cursor: "pointer",
  padding: 2,
  display: "grid",
  placeItems: "center",
};
