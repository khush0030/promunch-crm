import { redirect } from "next/navigation";

// New automations start from Email Studio → Automations → New automation.
export default function NewFlowPage() {
  redirect("/dashboard/email/automations");
}
