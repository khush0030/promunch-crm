"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Send, Calendar } from "lucide-react";

const steps = [
  { num: 1, label: "Details" },
  { num: 2, label: "Audience" },
  { num: 3, label: "Content" },
  { num: 4, label: "Review" },
];

const audienceOptions = [
  { value: "all", label: "All Subscribers", count: "12,450" },
  { value: "vip", label: "VIP Customers", count: "1,240" },
  { value: "new", label: "New Customers (last 30 days)", count: "892" },
  { value: "lapsed", label: "Lapsed (90+ days no purchase)", count: "3,180" },
];

const inputStyle = {
  width: "100%",
  padding: "11px 14px",
  backgroundColor: "#1c1c1f",
  border: "1px solid #27272a",
  borderRadius: "8px",
  color: "#f4f4f5",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box" as const,
  transition: "border-color 0.15s",
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: 600 as const,
  color: "#a1a1aa",
  marginBottom: "6px",
  display: "block" as const,
};

export default function NewCampaignPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    subject: "",
    preview: "",
    audience: "all",
    body: "",
  });

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const selectedAudience = audienceOptions.find((a) => a.value === form.audience);

  const canNext = () => {
    if (step === 1) return form.name.trim() && form.subject.trim();
    if (step === 2) return !!form.audience;
    if (step === 3) return form.body.trim().length > 10;
    return true;
  };

  return (
    <div style={{ padding: "32px", maxWidth: "720px" }}>
      {/* Back */}
      <Link href="/dashboard/campaigns" style={{ textDecoration: "none" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#71717a", fontSize: "13px", marginBottom: "20px", cursor: "pointer" }}>
          <ArrowLeft size={14} />
          Back to Campaigns
        </div>
      </Link>

      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>Create Campaign</h1>
        <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>Build and send a new email campaign</p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          {steps.map((s, i) => (
            <div key={s.num} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : undefined }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  backgroundColor: step > s.num ? "#10b981" : step === s.num ? "#7c3aed" : "#27272a",
                  border: step === s.num ? "2px solid #a78bfa" : "2px solid transparent",
                  fontSize: "13px", fontWeight: 700,
                  color: step >= s.num ? "#fff" : "#71717a",
                  transition: "all 0.2s",
                }}>
                  {step > s.num ? <CheckCircle2 size={18} /> : s.num}
                </div>
                <span style={{ fontSize: "11px", fontWeight: step === s.num ? 600 : 400, color: step === s.num ? "#f4f4f5" : "#71717a" }}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: "2px", backgroundColor: step > s.num ? "#10b981" : "#27272a", margin: "0 8px", marginTop: "-16px", transition: "background-color 0.2s" }} />
              )}
            </div>
          ))}
        </div>
        <div style={{ fontSize: "12px", color: "#71717a", textAlign: "center" }}>
          Step {step} of {steps.length}
        </div>
      </div>

      {/* Form card */}
      <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "28px", marginBottom: "20px" }}>
        {/* Step 1 */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "6px" }}>Campaign Details</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Give your campaign a name and configure the subject line</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={labelStyle}>Campaign Name <span style={{ color: "#ef4444" }}>*</span></label>
                <input
                  style={inputStyle}
                  placeholder="e.g. Summer Protein Sale — June 2026"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                />
                <div style={{ fontSize: "12px", color: "#52525b", marginTop: "4px" }}>Internal name — not shown to subscribers</div>
              </div>
              <div>
                <label style={labelStyle}>Subject Line <span style={{ color: "#ef4444" }}>*</span></label>
                <input
                  style={inputStyle}
                  placeholder="e.g. 🔥 Your protein just got tastier"
                  value={form.subject}
                  onChange={(e) => update("subject", e.target.value)}
                />
                <div style={{ fontSize: "12px", color: "#52525b", marginTop: "4px" }}>
                  {form.subject.length}/60 characters — aim for under 50
                </div>
              </div>
              <div>
                <label style={labelStyle}>Preview Text</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. New mango flavour is here — order now and get free shipping"
                  value={form.preview}
                  onChange={(e) => update("preview", e.target.value)}
                />
                <div style={{ fontSize: "12px", color: "#52525b", marginTop: "4px" }}>Shown after subject in inbox preview</div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "6px" }}>Select Audience</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Choose who receives this campaign</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {audienceOptions.map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => update("audience", opt.value)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "16px 18px",
                    borderRadius: "10px",
                    border: form.audience === opt.value ? "1px solid #7c3aed" : "1px solid #27272a",
                    backgroundColor: form.audience === opt.value ? "rgba(124, 58, 237, 0.08)" : "#1c1c1f",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{
                      width: "20px", height: "20px", borderRadius: "50%",
                      border: form.audience === opt.value ? "6px solid #7c3aed" : "2px solid #3f3f46",
                      backgroundColor: "transparent", flexShrink: 0,
                    }} />
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "#f4f4f5" }}>{opt.label}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#a78bfa", backgroundColor: "rgba(124, 58, 237, 0.1)", padding: "3px 10px", borderRadius: "20px" }}>
                    {opt.count} contacts
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "6px" }}>Email Content</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Write your email body — drag-and-drop editor coming soon</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div style={{ padding: "14px 18px", backgroundColor: "rgba(124, 58, 237, 0.08)", border: "1px solid rgba(124, 58, 237, 0.2)", borderRadius: "8px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#a78bfa", marginBottom: "4px" }}>💡 Visual editor coming soon</div>
                <div style={{ fontSize: "12px", color: "#71717a" }}>For now, paste your HTML or plain text below. Drag-and-drop email builder will replace this in the next release.</div>
              </div>
              <div>
                <label style={labelStyle}>Email Body <span style={{ color: "#ef4444" }}>*</span></label>
                <textarea
                  style={{ ...inputStyle, minHeight: "220px", resize: "vertical" as const, fontFamily: "inherit", lineHeight: "1.6" }}
                  placeholder={"Hi {{first_name}},\n\nWe've got something exciting to share with you...\n\nYour ProMunch team"}
                  value={form.body}
                  onChange={(e) => update("body", e.target.value)}
                />
                <div style={{ fontSize: "12px", color: "#52525b", marginTop: "4px" }}>
                  Use {"{{first_name}}"} for personalisation. {form.body.length} characters.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f4f4f5", marginBottom: "6px" }}>Review & Send</h2>
            <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>Confirm everything looks right before sending</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
              {[
                { label: "Campaign Name", value: form.name || "—" },
                { label: "Subject Line", value: form.subject || "—" },
                { label: "Preview Text", value: form.preview || "(none)" },
                { label: "Audience", value: `${selectedAudience?.label} (${selectedAudience?.count} contacts)` },
                { label: "Email Body", value: form.body ? `${form.body.length} characters` : "—" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", gap: "16px", padding: "12px 16px", backgroundColor: "#1c1c1f", borderRadius: "8px", border: "1px solid #27272a" }}>
                  <span style={{ fontSize: "13px", color: "#71717a", fontWeight: 500, width: "140px", flexShrink: 0 }}>{row.label}</span>
                  <span style={{ fontSize: "13px", color: "#f4f4f5" }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "12px 20px", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", border: "none", borderRadius: "9px", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
                onClick={() => alert("Campaign sent! 🚀")}
              >
                <Send size={16} />
                Send Now
              </button>
              <button
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "12px 20px", backgroundColor: "#1c1c1f", border: "1px solid #27272a", borderRadius: "9px", color: "#f4f4f5", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
                onClick={() => alert("Schedule coming soon!")}
              >
                <Calendar size={16} />
                Schedule
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nav buttons */}
      {step < 4 && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            style={{ padding: "10px 22px", borderRadius: "8px", border: "1px solid #27272a", backgroundColor: "#18181b", color: step === 1 ? "#52525b" : "#f4f4f5", fontSize: "14px", fontWeight: 500, cursor: step === 1 ? "not-allowed" : "pointer" }}
          >
            ← Back
          </button>
          <button
            onClick={() => setStep((s) => Math.min(4, s + 1))}
            disabled={!canNext()}
            style={{ padding: "10px 22px", borderRadius: "8px", border: "none", background: canNext() ? "linear-gradient(135deg, #7c3aed, #4f46e5)" : "#27272a", color: canNext() ? "#fff" : "#52525b", fontSize: "14px", fontWeight: 600, cursor: canNext() ? "pointer" : "not-allowed" }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
