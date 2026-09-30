import { redirect } from "next/navigation";

// The legacy flow editor wrote straight to the database with no copy checks
// and no admin gate on live automations. Editing now lives in Email Studio.
export default async function FlowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/email/automations/${encodeURIComponent(id)}`);
}
