import { redirect } from "next/navigation";

// Integrations folded into Settings → Connections (warm-editorial redesign).
// Kept as a redirect so old links / bookmarks still resolve.
export default function IntegrationsRedirect() {
  redirect("/dashboard/settings#connections");
}
