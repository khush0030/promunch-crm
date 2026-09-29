"use client";

import { Suspense } from "react";
import CampaignWizard from "@/components/whatsapp/campaigns/wizard/CampaignWizard";

// New WhatsApp campaign (full-page wizard). useSearchParams needs Suspense.
export default function NewWhatsAppCampaignPage() {
  return (
    <Suspense fallback={<div className="pm2-body"><div className="pm2-skel" /></div>}>
      <CampaignWizard />
    </Suspense>
  );
}
