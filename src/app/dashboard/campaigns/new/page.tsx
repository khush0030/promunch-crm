"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, CheckCircle2, Send, Calendar, Users, Mail, FileText, Eye } from "lucide-react";

const steps = [
  { id: 1, label: "Campaign Info", icon: FileText },
  { id: 2, label: "Audience", icon: Users },
  { id: 3, label: "Email Body", icon: Mail },
  { id: 4, label: "Review & Send", icon: Send },
];

const audiences = [
  "All Subscribers",
  "VIP Customers",
  "New Customers (last 30 days)",
  "Lapsed Customers (90d+)",
];

interface FormData {
  name: string;
  subject: string;
  preview: string;
  audience: string;
  body: string;
}

export default function NewCampaignPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({
    name: "",
    subject: "",
    preview: "",
    audience: "",
    body: "",
  });
  const [sent, setSent] = useState(false);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const canNext = () => {
    if (currentStep === 1) return formData.name.trim() && formData.subject.trim();
    if (currentStep === 2) return formData.audience !== "";
    if (currentStep === 3) return formData.body.trim().length > 0;
    return true;
  };

  if (sent) {
    return (
      <div style={{ padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            backgroundColor: "rgba(16,185,129,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        >
          <CheckCircle2 size={40} color="#10b981" />
        </div>
        <h2 style={{ fontSize: "24px", fontWeight: 700, color: "#f4f4f5", marginBottom: "8px" }}>Campaign Sent!</h2>
        <p style={{ fontSize: "15px", color: "#71717a", marginBottom: "28px" }}>
          &ldquo;{formData.name}&rdquo; has been sent to {formData.audience}.
        </p>
        <Link href="/dashboard/campaigns">
          <button
            style={{
              padding: "10px 24px",
              borderRadius: "9px",
              background: "linear-gradient(135deg, #B91C4A, #9b1740)",
              border: "none",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Back to Campaigns
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div style={{ padding: "32px" }}>
      {/* Back */}
      <Link href="/dashboard/campaigns" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#71717a", fontSize: "13px", textDecoration: "none", marginBottom: "20px" }}>
        <ChevronLeft size={16} />
        Back to Campaigns
      </Link>

      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>Create Campaign</h1>
        <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
          Set up and send your email campaign to PROMUNCH subscribers
        </p>
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "36px", position: "relative" }}>
        {/* Progress bar background */}
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            right: "20px",
            height: "2px",
            backgroundColor: "#27272a",
            zIndex: 0,
          }}
        />
        {/* Progress bar fill */}
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            height: "2px",
            backgroundColor: "#B91C4A",
            width: `${((currentStep - 1) / (steps.length - 1)) * 100}%`,
            zIndex: 1,
            transition: "width 0.3s ease",
          }}
        />

        {steps.map((step) => {
          const done = step.id < currentStep;
          const active = step.id === currentStep;
          return (
            <div
              key={step.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: 1,
                position: "relative",
                zIndex: 2,
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: done ? "#B91C4A" : active ? "#B91C4A" : "#27272a",
                  border: active ? "3px solid #f4f4f5" : done ? "none" : "2px solid #3f3f46",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "8px",
                  transition: "all 0.2s",
                }}
              >
                {done ? (
                  <CheckCircle2 size={18} color="#fff" />
                ) : (
                  <step.icon size={16} color={active ? "#fff" : "#52525b"} />
                )}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: active || done ? 600 : 400,
                  color: active ? "#f4f4f5" : done ? "#B91C4A" : "#52525b",
                  whiteSpace: "nowrap",
                }}
              >
                {step.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div
        style={{
          backgroundColor: "#18181b",
          border: "1px solid #27272a",
          borderRadius: "12px",
          padding: "32px",
          marginBottom: "20px",
          maxWidth: "680px",
        }}
      >
        {/* Step 1 */}
        {currentStep === 1 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "8px" }}>Campaign Details</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Give your campaign a name and set the email subject</p>

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#a1a1aa", display: "block", marginBottom: "8px" }}>
                  Campaign Name <span style={{ color: "#B91C4A" }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Summer Flash Sale"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    backgroundColor: "#27272a",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                    color: "#f4f4f5",
                    fontSize: "14px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#a1a1aa", display: "block", marginBottom: "8px" }}>
                  Subject Line <span style={{ color: "#B91C4A" }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. ⚡ Flash Sale — 30% off today only!"
                  value={formData.subject}
                  onChange={(e) => updateField("subject", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    backgroundColor: "#27272a",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                    color: "#f4f4f5",
                    fontSize: "14px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#a1a1aa", display: "block", marginBottom: "8px" }}>
                  Preview Text
                </label>
                <input
                  type="text"
                  placeholder="Short text shown in inbox preview..."
                  value={formData.preview}
                  onChange={(e) => updateField("preview", e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    backgroundColor: "#27272a",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                    color: "#f4f4f5",
                    fontSize: "14px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ fontSize: "12px", color: "#52525b", marginTop: "6px" }}>Optional. Displays after the subject line in email clients.</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {currentStep === 2 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "8px" }}>Select Audience</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Choose who will receive this campaign</p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {audiences.map((audience) => (
                <div
                  key={audience}
                  onClick={() => updateField("audience", audience)}
                  style={{
                    padding: "16px 20px",
                    borderRadius: "10px",
                    border: formData.audience === audience ? "2px solid #B91C4A" : "1px solid #3f3f46",
                    backgroundColor: formData.audience === audience ? "rgba(185,28,74,0.08)" : "#27272a",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <Users size={18} color={formData.audience === audience ? "#B91C4A" : "#71717a"} />
                    <span style={{ fontSize: "14px", fontWeight: 600, color: formData.audience === audience ? "#f4f4f5" : "#a1a1aa" }}>
                      {audience}
                    </span>
                  </div>
                  {formData.audience === audience && (
                    <CheckCircle2 size={18} color="#B91C4A" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 */}
        {currentStep === 3 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "8px" }}>Email Content</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Write your email body — a visual drag-drop builder is coming soon</p>

            <div
              style={{
                backgroundColor: "#27272a",
                border: "1px solid #3f3f46",
                borderRadius: "8px",
                marginBottom: "12px",
                padding: "8px 12px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
              }}
            >
              {["B", "I", "U", "Link", "Image"].map((tool) => (
                <button
                  key={tool}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "4px",
                    border: "1px solid #3f3f46",
                    backgroundColor: "transparent",
                    color: "#a1a1aa",
                    fontSize: "12px",
                    fontWeight: tool === "B" ? 700 : 400,
                    cursor: "pointer",
                  }}
                >
                  {tool}
                </button>
              ))}
            </div>

            <textarea
              placeholder={`Hi {{first_name}},\n\nWrite your email content here...\n\nThis is a preview area. A full drag-and-drop email builder is coming soon.\n\nBest,\nThe PROMUNCH Team`}
              value={formData.body}
              onChange={(e) => updateField("body", e.target.value)}
              rows={14}
              style={{
                width: "100%",
                padding: "16px",
                backgroundColor: "#27272a",
                border: "1px solid #3f3f46",
                borderRadius: "8px",
                color: "#f4f4f5",
                fontSize: "14px",
                lineHeight: "1.7",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            <p style={{ fontSize: "12px", color: "#52525b", marginTop: "8px" }}>
              Use {"{{first_name}}"} for personalisation. HTML is supported.
            </p>
          </div>
        )}

        {/* Step 4 */}
        {currentStep === 4 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "8px" }}>Review & Send</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Confirm your campaign details before sending</p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "28px" }}>
              {[
                { label: "Campaign Name", value: formData.name || "—", icon: FileText },
                { label: "Subject Line", value: formData.subject || "—", icon: Mail },
                { label: "Preview Text", value: formData.preview || "Not set", icon: Eye },
                { label: "Audience", value: formData.audience || "—", icon: Users },
                { label: "Email Body", value: formData.body ? `${formData.body.slice(0, 80)}...` : "—", icon: Mail },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: "14px 16px",
                    backgroundColor: "#27272a",
                    borderRadius: "10px",
                    border: "1px solid #3f3f46",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                  }}
                >
                  <item.icon size={16} color="#71717a" style={{ marginTop: "2px", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: "14px", color: "#f4f4f5" }}>{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => setSent(true)}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "12px 24px",
                  borderRadius: "9px",
                  background: "linear-gradient(135deg, #B91C4A, #9b1740)",
                  border: "none",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Send size={16} />
                Send Now
              </button>
              <button
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "12px 24px",
                  borderRadius: "9px",
                  border: "1px solid #3f3f46",
                  backgroundColor: "#27272a",
                  color: "#f4f4f5",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Calendar size={16} />
                Schedule
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      {currentStep < 4 && (
        <div style={{ display: "flex", justifyContent: "space-between", maxWidth: "680px" }}>
          <button
            onClick={() => setCurrentStep(s => Math.max(1, s - 1))}
            disabled={currentStep === 1}
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
              border: "1px solid #27272a",
              backgroundColor: "transparent",
              color: currentStep === 1 ? "#3f3f46" : "#a1a1aa",
              fontSize: "14px",
              fontWeight: 600,
              cursor: currentStep === 1 ? "not-allowed" : "pointer",
            }}
          >
            ← Back
          </button>
          <button
            onClick={() => setCurrentStep(s => Math.min(4, s + 1))}
            disabled={!canNext()}
            style={{
              padding: "10px 24px",
              borderRadius: "8px",
              background: canNext() ? "linear-gradient(135deg, #B91C4A, #9b1740)" : "#27272a",
              border: "none",
              color: canNext() ? "#fff" : "#52525b",
              fontSize: "14px",
              fontWeight: 600,
              cursor: canNext() ? "pointer" : "not-allowed",
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
