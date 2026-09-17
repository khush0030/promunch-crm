"use client";

import { use } from "react";
import { CampaignEditor } from "@/components/brevo/CampaignEditor";

export default function EditBrevoCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CampaignEditor id={Number(id)} />;
}
