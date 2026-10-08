// Serves the promunch.in bulk order form as a self-contained script. On the
// bulk-orders page, add a Custom Liquid block with:
//   <div id="promunch-bulk-form"></div>
//   <script src="https://<crm host>/api/public/bulk-form-embed" async></script>
// Optional: data-promise="..." overrides "Quote within one working day".
// Public GET (middleware allowlists /api/public/*). Posts to /api/public/bulk-inquiry.

import { NextResponse } from "next/server";
import { bulkFormScript } from "@/lib/bulk-inquiry/embed-script";

export const dynamic = "force-dynamic";

function appBaseUrl(): string {
  return (process.env.SITE_APP_URL || "https://admin.promunch.in").replace(/\/+$/, "");
}

export function GET() {
  return new NextResponse(bulkFormScript(`${appBaseUrl()}/api/public/bulk-inquiry`), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
