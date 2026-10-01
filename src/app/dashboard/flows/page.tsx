import { redirect } from "next/navigation";

// The legacy flows list moved into Email Studio → Automations.
export default function FlowsPage() {
  redirect("/dashboard/email/automations");
}
