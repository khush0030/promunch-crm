import { redirect } from "next/navigation";

// The campaign list lives on the WhatsApp marketing page's Campaigns tab.
export default function WhatsAppCampaignsIndex() {
  redirect("/dashboard/whatsapp?tab=campaigns");
}
