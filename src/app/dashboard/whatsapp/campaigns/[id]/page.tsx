"use client";

import { use } from "react";
import CampaignDetail from "@/components/whatsapp/campaigns/detail/CampaignDetail";

// One WhatsApp campaign: progress, funnel, holds, failures, recipients.
export default function WhatsAppCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CampaignDetail key={id} id={id} />;
}
