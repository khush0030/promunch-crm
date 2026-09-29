import { NextResponse } from "next/server";
import { listProducts } from "@/lib/email-studio/server";

// Product picker for the builder: the Shopify catalog mirror (wa_catalog_items).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ products: await listProducts() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "products failed" }, { status: 500 });
  }
}
