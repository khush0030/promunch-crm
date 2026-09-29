import { redirect } from "next/navigation";

// The activity log moved into Admin (admins only). Kept so old links resolve.
export default function AuditLogRedirect() {
  redirect("/dashboard/admin?tab=activity");
}
