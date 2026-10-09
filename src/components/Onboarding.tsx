"use client";

// First-run onboarding for new teammates: a welcome modal, then a guided
// spotlight tour of the sidebar. Shown once per user (tracked in localStorage,
// keyed by user id). Can be replayed any time by dispatching the window event
// `pm:start-tour` (the sidebar "Help & tour" button does this).
//
// Zero dependencies: the spotlight is a fixed overlay with a box-shadow "hole"
// over the target element. On mobile (no persistent sidebar) it falls back to a
// simple centered quick-guide card.

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { canOpenHref } from "@/lib/access";
import { useAccess } from "@/components/shell/useAccess";
import o from "./Onboarding.module.css";

type Step = {
  tour: string; // matches data-tour="..." on the sidebar nav item
  href: string; // the page it points at; steps the teammate can't open are skipped
  title: string;
  body: string;
  icon: React.ReactNode;
};

// Every step is checked against the teammate's areas (lib/access.ts), so a
// marketer with only WhatsApp + email marketing sees just those two.
const ALL_STEPS: Step[] = [
  {
    tour: "dashboard",
    href: "/dashboard",
    title: "Home",
    body: "Revenue, key numbers and anything that needs attention, all on one screen.",
    icon: <LayoutDashboard size={16} />,
  },
  {
    tour: "whatsapp",
    href: "/dashboard/inbox",
    title: "Inbox",
    body: "Customer WhatsApp chats and tickets in one place. The bot answers most questions and hands over to you when it needs a person.",
    icon: <MessageCircle size={16} />,
  },
  {
    tour: "support-emails",
    href: "/dashboard/inbox/email",
    title: "Email drafts",
    body: "Customer emails land here with an AI-drafted reply. Check it, edit if needed, and send.",
    icon: <Mail size={16} />,
  },
  {
    tour: "order-confirmations",
    href: "/dashboard/sales/orders",
    title: "Orders & COD",
    body: "See which orders still need a confirmation message so none slip through.",
    icon: <CircleCheck size={16} />,
  },
  {
    tour: "wa-marketing",
    href: "/dashboard/whatsapp?tab=home",
    title: "WhatsApp",
    body: "Under Marketing. Start with the Overview tab: a short checklist, then big buttons to send a campaign, create a message template or set up an automation. Every step explains itself.",
    icon: <Megaphone size={16} />,
  },
  {
    tour: "email-studio",
    href: "/dashboard/email",
    title: "Email",
    body: "Under Marketing. Email campaigns, automations, templates and results for PROMUNCH customers, all in one place.",
    icon: <Mail size={16} />,
  },
  {
    tour: "contacts",
    href: "/dashboard/contacts",
    title: "Customers",
    body: "Everyone who bought or signed up, with segments ready to target.",
    icon: <Users size={16} />,
  },
  {
    tour: "settings",
    href: "/dashboard/settings",
    title: "Settings",
    body: "Connect Shopify and email, set your brand, and invite teammates from Team & access.",
    icon: <SettingsIcon size={16} />,
  },
];

const PADDING = 8;

type Phase = "idle" | "welcome" | "tour" | "guide";

export default function Onboarding() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const access = useAccess();
  const STEPS = useMemo(() => (access ? ALL_STEPS.filter((st) => canOpenHref(access, st.href)) : []), [access]);
  const marketingOnly = STEPS.length > 0 && STEPS.every((st) => st.tour === "wa-marketing" || st.tour === "email-studio");

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
    if (phase !== "tour" || !STEPS[step]) return;
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
  }, [phase, step, STEPS]);

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

  // Nothing to show until access is known (and never an empty tour).
  if (phase === "idle" || STEPS.length === 0) return null;

  // --- Welcome modal (prototype index.html#home/welcome) ----------------
  // "Show me Home" starts the spotlight tour (its first stop is Home);
  // Skip marks onboarding done. The tour can be replayed from the sidebar.
  if (phase === "welcome") {
    const restricted = STEPS.length < ALL_STEPS.length;
    return (
      <Backdrop onClose={finish}>
        <div className={o.modal} role="dialog" aria-modal="true" aria-labelledby="pm-welcome-title">
          <div className={o.band}>
            <span className={o.eyebrow}>★ New look</span>
            <h1 id="pm-welcome-title" className={o.h1}>
              Same CRM.
              <br />
              Less noise.
            </h1>
            <p className={o.lede}>
              {marketingOnly
                ? "Everything you need for PROMUNCH's WhatsApp and email marketing, in one place."
                : "Everything you used is still here, in fewer places."}
            </p>
          </div>
          <div className={o.bodyPad}>
            <div className={o.tl}>
              <div className={`${o.it} ${o.done}`}>
                {restricted ? (
                  <>
                    <b>Your places, in the sidebar</b>
                    <span>{STEPS.map((st) => st.title).join(", ")}.</span>
                  </>
                ) : (
                  <>
                    <b>8 places, not 20</b>
                    <span>Home, Inbox, Orders, Marketing, Creators, B2B, Customers, Insights.</span>
                  </>
                )}
              </div>
              <div className={`${o.it} ${o.done}`}>
                <b>Ask Maya is the yellow button</b>
                <span>Ask anything, get a chart. Shortcut ⌘J.</span>
              </div>
              <div className={`${o.it} ${o.now}`}>
                <b>Search finds everything</b>
                <span>Orders, people, tickets, pages. Shortcut ⌘K.</span>
              </div>
            </div>
            <div className={o.mf}>
              <button type="button" className="pm2-btn ghost" onClick={finish}>
                Skip
              </button>
              <button type="button" className="pm2-btn pri" onClick={startTour}>
                Show me Home
              </button>
            </div>
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
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{s.title}</div>
                  <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.5 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>
          <button
            className="pm2-btn pri"
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
  const s = STEPS[Math.min(step, STEPS.length - 1)];
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
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-2)", margin: "0 0 14px" }}>{s.body}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>
            {step + 1} / {STEPS.length}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {step > 0 && (
              <button className="pm2-btn sm" onClick={back}>
                <ArrowLeft size={13} /> Back
              </button>
            )}
            <button className="pm2-btn sm pri" onClick={next}>
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
    <div className={o.backdrop} onClick={onClose}>
      <div className={o.holder} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 440,
  margin: "0 auto",
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
  background: "var(--pm-brand-soft, #F8E7E5)",
  color: "var(--pm-brand, #AF272F)",
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
