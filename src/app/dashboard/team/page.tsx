import { redirect } from "next/navigation";

// Team folded into Settings → Team (warm-editorial redesign). Kept as a
// redirect so old links / bookmarks still resolve.
export default function TeamRedirect() {
  redirect("/dashboard/settings#team");
}
