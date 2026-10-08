import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { invokeOrmTick, jsonError } from "@/lib/orm/db";
import { isSourceKey } from "@/lib/orm/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/orm/sources/[key]/run (admin only): collect this one source now
// (edge orm-tick {source}: COLLECT + ENRICH per the build spec §1), ignoring
// its schedule. Nothing is posted publicly; collectors only fetch.
export async function POST(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { key } = await params;
  if (!isSourceKey(key)) return jsonError("unknown source", 404);
  if (key === "instagram") return jsonError("Instagram and Facebook are not available yet", 409);
  const r = await invokeOrmTick(key);
  console.info("orm_source_run", { by: gate.user.email, key, status: r.status, ok: r.ok });
  return NextResponse.json({ ok: r.ok, ...r.data }, { status: r.ok ? 200 : r.status >= 400 ? r.status : 502 });
}
