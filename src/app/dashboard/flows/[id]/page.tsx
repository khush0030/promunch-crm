"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ShoppingCart,
  Clock,
  Mail,
  GitBranch,
  LogOut,
  Users,
  TrendingUp,
  DollarSign,
  Heart,
  Gift,
  Cake,
  Star,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const triggerIcons: Record<string, { icon: typeof ShoppingCart; color: string; bg: string }> = {
  checkout_abandoned: { icon: ShoppingCart, color: "#E87339", bg: "rgba(232, 115, 57, 0.1)" },
  order_placed: { icon: Gift, color: "var(--green)", bg: "rgba(16, 185, 129, 0.1)" },
  customer_created: { icon: Heart, color: "var(--accent)", bg: "rgba(185, 28, 74, 0.1)" },
  segment_entry: { icon: Star, color: "var(--amber)", bg: "rgba(245, 183, 49, 0.1)" },
  date_based: { icon: Cake, color: "#00B4D8", bg: "rgba(0, 180, 216, 0.1)" },
};

const triggerLabels: Record<string, string> = {
  checkout_abandoned: "Cart abandoned",
  order_placed: "Order placed",
  customer_created: "New customer",
  segment_entry: "Segment entry",
  date_based: "Date-based",
};

type Step = {
  type?: "wait" | "email" | "condition" | "exit" | string;
  label?: string;
  sub?: string;
  stats?: { sent?: number; opened?: number; clicked?: number };
};

type Flow = {
  id: string;
  name: string;
  description?: string | null;
  trigger_type?: string | null;
  status?: string;
  steps?: Step[] | null;
  total_entered?: number;
  total_completed?: number;
  total_converted?: number;
  revenue_attributed?: number;
};

const stepIconMap: Record<string, typeof Mail> = {
  wait: Clock,
  email: Mail,
  condition: GitBranch,
  exit: LogOut,
};

export default function FlowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await supabase.from("flows").select("*").eq("id", id).maybeSingle();
      if (res.error || !res.data) {
        setNotFound(true);
      } else {
        setFlow(res.data as Flow);
      }
      setLoaded(true);
    }
    load();
  }, [id]);

  async function toggleStatus() {
    if (!flow) return;
    const next = flow.status === "active" ? "paused" : "active";
    const res = await supabase.from("flows").update({ status: next }).eq("id", flow.id).select().maybeSingle();
    if (!res.error && res.data) setFlow(res.data as Flow);
  }

  if (!loaded) {
    return <div style={{ padding: "32px", color: "var(--text-2)" }}></div>;
  }

  if (notFound || !flow) {
    return (
      <div style={{ padding: "32px" }}>
        <Link href="/dashboard/flows" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "13px", textDecoration: "none", marginBottom: "20px" }}>
          <ChevronLeft size={16} />
          Back to Flows
        </Link>
        <div style={{ color: "var(--text-2)" }}>Flow not found.</div>
      </div>
    );
  }

  const triggerMeta = triggerIcons[flow.trigger_type || ""] || {
    icon: Mail,
    color: "var(--text-2)",
    bg: "rgba(161, 161, 170, 0.1)",
  };
  const TriggerIcon = triggerMeta.icon;
  const status = flow.status || "draft";
  const isActive = status === "active";
  const revenue = Number(flow.revenue_attributed) || 0;
  const entered = flow.total_entered || 0;
  const converted = flow.total_converted || 0;
  const convRate = entered > 0 ? ((converted / entered) * 100).toFixed(1) + "%" : "";
  const steps: Step[] = Array.isArray(flow.steps) ? flow.steps : [];

  return (
    <div style={{ padding: "32px" }}>
      <Link href="/dashboard/flows" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "13px", textDecoration: "none", marginBottom: "20px" }}>
        <ChevronLeft size={16} />
        Back to Flows
      </Link>

      <div
        style={{
          backgroundColor: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "50px",
              height: "50px",
              borderRadius: "12px",
              backgroundColor: triggerMeta.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TriggerIcon size={24} color={triggerMeta.color} />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>{flow.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
              <span
                style={{
                  padding: "2px 10px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: isActive ? "rgba(16,185,129,0.15)" : "rgba(245,183,49,0.15)",
                  color: isActive ? "var(--green)" : "var(--amber)",
                }}
              >
                {status}
              </span>
              <span style={{ fontSize: "13px", color: "var(--text-2)" }}>
                Trigger: {triggerLabels[flow.trigger_type || ""] || flow.trigger_type || ""}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--green)" }}>
              {revenue > 0 ? `₹${revenue.toLocaleString()}` : ""}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-2)" }}>Total Revenue</div>
          </div>
          <button
            onClick={toggleStatus}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--border)",
              color: "var(--text)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isActive ? "Pause Flow" : "Activate Flow"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "28px" }}>
        {[
          { label: "Total Processed", value: entered.toLocaleString(), icon: Users, color: "#00B4D8", bg: "rgba(0,180,216,0.1)" },
          { label: "Conversion Rate", value: convRate, icon: TrendingUp, color: "var(--green)", bg: "rgba(16,185,129,0.1)" },
          { label: "Revenue Generated", value: revenue > 0 ? `₹${revenue.toLocaleString()}` : "", icon: DollarSign, color: "var(--amber)", bg: "rgba(245,183,49,0.1)" },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              backgroundColor: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "20px",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                backgroundColor: card.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <card.icon size={22} color={card.color} />
            </div>
            <div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text)" }}>{card.value}</div>
              <div style={{ fontSize: "13px", color: "var(--text-2)" }}>{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "28px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "24px" }}>Flow Steps</h2>

        {steps.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "560px" }}>
            {steps.map((step, index) => {
              const Icon = stepIconMap[step.type || ""] || Mail;
              const isLast = index === steps.length - 1;
              return (
                <div key={index} style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                  <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          borderRadius: "50%",
                          backgroundColor: "rgba(0, 180, 216, 0.1)",
                          border: "2px solid #00B4D8",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon size={20} color="#00B4D8" />
                      </div>
                      {!isLast && (
                        <div style={{ width: "2px", height: "40px", backgroundColor: "var(--border)", margin: "4px 0" }} />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingTop: "6px", paddingBottom: isLast ? 0 : "20px" }}>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
                        {step.label || `Step ${index + 1}`}
                      </div>
                      {step.sub && (
                        <div style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "2px" }}>{step.sub}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "32px",
              border: "1px dashed var(--border)",
              borderRadius: "10px",
              color: "var(--text-2)",
              fontSize: "13px",
            }}
          >
            No steps configured yet. The flow builder is coming soon.
          </div>
        )}
      </div>
    </div>
  );
}
