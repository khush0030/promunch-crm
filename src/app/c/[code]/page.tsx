// Public creator portal. Reachable without a session (middleware allowlists
// /c). The unguessable deal code is the credential; the view never carries
// address, phone, email or any other deal. Actions go through
// /api/public/collab/[code]/*.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildPortalView, loadPortalDeal } from "@/lib/influencers/portal-server";
import { isValidPortalCode } from "@/lib/influencers/portal-rules";
import CreatorPortal from "./CreatorPortal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your PROMUNCH collab",
  description: "Your brief, your box and your posting checklist. Team PROMUNCH, Your Munchy Pal.",
  robots: { index: false, follow: false },
};

export default async function CollabPortalPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isValidPortalCode(code)) notFound();
  const deal = await loadPortalDeal(code).catch(() => null);
  if (!deal) notFound();
  const view = await buildPortalView(deal);
  return <CreatorPortal initialView={view} />;
}
