"use client";

// Campaigns tab of the WhatsApp dashboard. The list, status strip and audience
// insights live in ./campaigns/; creating and editing a campaign happens on the
// full-page wizard (/dashboard/whatsapp/campaigns/new), and each campaign has
// its own report page (/dashboard/whatsapp/campaigns/[id]).
export { default } from "./campaigns/CampaignsHome";
