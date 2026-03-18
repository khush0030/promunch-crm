"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ShoppingCart,
  Clock,
  Mail,
  GitBranch,
  LogOut,
  CheckCircle2,
  XCircle,
  Users,
  TrendingUp,
  DollarSign,
} from "lucide-react";

const flowData = {
  id: "1",
  name: "Abandoned Cart Recovery",
  status: "Active",
  trigger: "Cart Abandoned",
  revenue: 8240,
  processed: 4672,
  conversion: "18.2%",
};

type StepType = "trigger" | "wait" | "email" | "condition" | "branch" | "exit";

interface Step {
  type: StepType;
  label: string;
  sub?: string;
  stats?: { sent?: number; opened?: number; clicked?: number };
  branches?: { yes: string; no: string };
  color?: string;
  bg?: string;
}

const steps: Step[] = [
  {
    type: "trigger",
    label: "Cart Abandoned",
    sub: "Customer leaves without checking out",
    color: "#E87339",
    bg: "rgba(232, 115, 57, 0.1)",
  },
  {
    type: "wait",
    label: "Wait 1 Hour",
    sub: "Give customer time to return",
    color: "#F5B731",
    bg: "rgba(245, 183, 49, 0.1)",
  },
  {
    type: "email",
    label: "Email 1: Did you forget something?",
    sub: "First reminder email",
    stats: { sent: 847, opened: 412, clicked: 89 },
    color: "#00B4D8",
    bg: "rgba(0, 180, 216, 0.1)",
  },
  {
    type: "condition",
    label: "Condition: Purchased?",
    sub: "Check if customer completed purchase",
    branches: { yes: "Exit Flow", no: "Continue" },
    color: "#B91C4A",
    bg: "rgba(185, 28, 74, 0.1)",
  },
  {
    type: "wait",
    label: "Wait 24 Hours",
    sub: "Second waiting period",
    color: "#F5B731",
    bg: "rgba(245, 183, 49, 0.1)",
  },
  {
    type: "email",
    label: "Email 2: Special offer for you",
    sub: "Second reminder with discount",
    stats: { sent: 691, opened: 298, clicked: 114 },
    color: "#00B4D8",
    bg: "rgba(0, 180, 216, 0.1)",
  },
  {
    type: "wait",
    label: "Wait 48 Hours",
    sub: "Final waiting period",
    color: "#F5B731",
    bg: "rgba(245, 183, 49, 0.1)",
  },
  {
    type: "email",
    label: "Email 3: Last chance — 20% off",
    sub: "Final urgency email",
    stats: { sent: 512, opened: 187, clicked: 76 },
    color: "#00B4D8",
    bg: "rgba(0, 180, 216, 0.1)",
  },
];

const iconMap: Record<StepType, React.ComponentType<{ size: number; color: string }>> = {
  trigger: ShoppingCart,
  wait: Clock,
  email: Mail,
  condition: GitBranch,
  branch: GitBranch,
  exit: LogOut,
};

export default function FlowDetailPage() {
  const params = useParams();
  const [status, setStatus] = useState("Active");

  return (
    <div style={{ padding: "32px" }}>
      {/* Back */}
      <Link href="/dashboard/flows" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#71717a", fontSize: "13px", textDecoration: "none", marginBottom: "20px" }}>
        <ChevronLeft size={16} />
        Back to Flows
      </Link>

      {/* Header */}
      <div
        style={{
          backgroundColor: "#18181b",
          border: "1px solid #27272a",
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
              backgroundColor: "rgba(232, 115, 57, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShoppingCart size={24} color="#E87339" />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.3px" }}>{flowData.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
              <span
                style={{
                  padding: "2px 10px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: status === "Active" ? "rgba(16,185,129,0.15)" : "rgba(245,183,49,0.15)",
                  color: status === "Active" ? "#10b981" : "#F5B731",
                }}
              >
                {status}
              </span>
              <span style={{ fontSize: "13px", color: "#71717a" }}>Trigger: {flowData.trigger}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#10b981" }}>₹{flowData.revenue.toLocaleString()}</div>
            <div style={{ fontSize: "12px", color: "#71717a" }}>Total Revenue</div>
          </div>
          <button
            onClick={() => setStatus(s => s === "Active" ? "Paused" : "Active")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid #27272a",
              backgroundColor: "#27272a",
              color: "#f4f4f5",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {status === "Active" ? "Pause Flow" : "Resume Flow"}
          </button>
        </div>
      </div>

      {/* Analytics Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "28px" }}>
        {[
          { label: "Total Processed", value: flowData.processed.toLocaleString(), icon: Users, color: "#00B4D8", bg: "rgba(0,180,216,0.1)" },
          { label: "Conversion Rate", value: flowData.conversion, icon: TrendingUp, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
          { label: "Revenue Generated", value: `₹${flowData.revenue.toLocaleString()}`, icon: DollarSign, color: "#F5B731", bg: "rgba(245,183,49,0.1)" },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
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
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#f4f4f5" }}>{card.value}</div>
              <div style={{ fontSize: "13px", color: "#71717a" }}>{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Flow Builder */}
      <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "28px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "28px" }}>Flow Steps</h2>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: "560px" }}>
          {steps.map((step, index) => {
            const Icon = iconMap[step.type] || Mail;
            const color = step.color || "#a1a1aa";
            const bg = step.bg || "rgba(161,161,170,0.1)";
            const isLast = index === steps.length - 1;

            return (
              <div key={index} style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  {/* Icon + line */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                    <div
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "50%",
                        backgroundColor: bg,
                        border: `2px solid ${color}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon size={20} color={color} />
                    </div>
                    {!isLast && (
                      <div style={{ width: "2px", height: "40px", backgroundColor: "#27272a", margin: "4px 0" }} />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, paddingTop: "6px", paddingBottom: isLast ? 0 : "20px" }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#f4f4f5" }}>{step.label}</div>
                    {step.sub && (
                      <div style={{ fontSize: "12px", color: "#71717a", marginTop: "2px" }}>{step.sub}</div>
                    )}

                    {/* Email stats */}
                    {step.stats && (
                      <div style={{ display: "flex", gap: "16px", marginTop: "10px" }}>
                        {[
                          { label: "Sent", value: step.stats.sent, color: "#a1a1aa" },
                          { label: "Opened", value: step.stats.opened, color: "#00B4D8" },
                          { label: "Clicked", value: step.stats.clicked, color: "#10b981" },
                        ].map((s) => (
                          <div
                            key={s.label}
                            style={{
                              backgroundColor: "#27272a",
                              borderRadius: "8px",
                              padding: "6px 12px",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                            }}
                          >
                            <div style={{ fontSize: "14px", fontWeight: 700, color: s.color }}>{s.value?.toLocaleString()}</div>
                            <div style={{ fontSize: "10px", color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Condition branches */}
                    {step.type === "condition" && step.branches && (
                      <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 14px",
                            borderRadius: "8px",
                            backgroundColor: "rgba(16,185,129,0.1)",
                            border: "1px solid rgba(16,185,129,0.3)",
                          }}
                        >
                          <CheckCircle2 size={14} color="#10b981" />
                          <span style={{ fontSize: "13px", color: "#10b981", fontWeight: 600 }}>Yes → {step.branches.yes}</span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 14px",
                            borderRadius: "8px",
                            backgroundColor: "rgba(239,68,68,0.1)",
                            border: "1px solid rgba(239,68,68,0.3)",
                          }}
                        >
                          <XCircle size={14} color="#ef4444" />
                          <span style={{ fontSize: "13px", color: "#ef4444", fontWeight: 600 }}>No → {step.branches.no}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Exit node */}
          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(113,113,122,0.1)",
                  border: "2px dashed #52525b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <LogOut size={18} color="#52525b" />
              </div>
            </div>
            <div style={{ paddingTop: "10px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#52525b" }}>Exit Flow</div>
              <div style={{ fontSize: "12px", color: "#3f3f46" }}>All steps completed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
