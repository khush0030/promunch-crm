"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { sendJson } from "./api";

// Creates a draft (from a template when given) and opens it.
export function NewCampaignButton({
  templateKey,
  templateId,
  label = "New campaign",
  primary = true,
  name,
}: {
  templateKey?: string;
  templateId?: string;
  label?: string;
  primary?: boolean;
  name?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`pm2-btn ${primary ? "pri" : ""}`}
      disabled={busy}
      onClick={async () => {
        if (!templateKey && !templateId) {
          router.push("/dashboard/email/templates?pick=1");
          return;
        }
        setBusy(true);
        try {
          const r = await sendJson<{ id: string }>("/api/email-studio/campaigns", "POST", { templateKey, templateId, name });
          router.push(`/dashboard/email/campaigns/${r.id}`);
        } catch (e) {
          toast.push({ kind: "error", text: (e as Error).message });
          setBusy(false);
        }
      }}
    >
      <Plus size={14} /> {busy ? "Creating…" : label}
    </button>
  );
}
