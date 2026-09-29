"use client";

import { Suspense, use } from "react";
import CampaignWizard from "@/components/whatsapp/campaigns/wizard/CampaignWizard";

// Edit a draft / scheduled WhatsApp campaign in the same wizard.
export default function EditWhatsAppCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="pm2-body"><div className="pm2-skel" /></div>}>
      <CampaignWizard key={id} editId={id} />
    </Suspense>
  );
}
