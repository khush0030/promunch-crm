import { notFound } from "next/navigation";

// Unknown /dashboard/* URLs: render dashboard/not-found.tsx inside the app
// shell instead of the bare root 404.
export default function MissingDashboardPage() {
  notFound();
}
