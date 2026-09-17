import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { brevo, brevoGet, listAll, section, type Section } from "@/lib/brevo";
import { getBrevoSettings, type BrevoSettings } from "@/lib/brevo-settings";

// Brevo audience for the Audience tab: lists, folders, segments, attributes
// and the sync settings. POST creates a list or folder (admin).
//
// GET  /api/brevo/audience
// POST /api/brevo/audience {kind: "list", name, folderId} | {kind: "folder", name}
export const dynamic = "force-dynamic";

export type BrevoList = { id: number; name: string; folderId: number; uniqueSubscribers: number; totalBlacklisted: number; totalSubscribers: number };
export type BrevoFolder = { id: number; name: string; uniqueSubscribers: number; totalBlacklisted: number };
export type BrevoSegment = { id: number; segmentName: string; categoryName: string; updatedAt: string };
export type BrevoAttribute = { name: string; category: string; type?: string; calculatedValue?: string };

export type AudienceResponse = {
  lists: Section<BrevoList[]>;
  folders: Section<BrevoFolder[]>;
  segments: Section<BrevoSegment[]>;
  attributes: Section<BrevoAttribute[]>;
  settings: BrevoSettings & { migrated: boolean };
  fetchedAt: string;
};

export async function GET() {
  const [lists, folders, segments, attributes, settings] = await Promise.all([
    section(listAll<BrevoList>("/contacts/lists?sort=desc", "lists", 50)),
    section(listAll<BrevoFolder>("/contacts/folders?sort=desc", "folders", 50)),
    section(listAll<BrevoSegment>("/contacts/segments?sort=desc", "segments", 50)),
    section(brevoGet<{ attributes?: BrevoAttribute[] }>("/contacts/attributes").then((r) => (r.attributes ?? []).filter((a) => a.category === "normal" || a.category === "category"))),
    getBrevoSettings(),
  ]);
  const body: AudienceResponse = { lists, folders, segments, attributes, settings, fetchedAt: new Date().toISOString() };
  return NextResponse.json(body);
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as { kind?: string; name?: string; folderId?: number } | null;
  const name = b?.name?.trim();
  if (!name || name.length > 100) return NextResponse.json({ ok: false, error: "name is required (max 100 chars)" }, { status: 400 });
  try {
    if (b?.kind === "folder") {
      const r = await brevo<{ id: number }>("POST", "/contacts/folders", { name });
      await recordAudit({ action: "brevo.folder_create", entityType: "brevo_folder", entityId: String(r.id), summary: name, actor: gate.user, request: req });
      return NextResponse.json({ ok: true, id: r.id });
    }
    if (b?.kind === "list") {
      if (!Number.isInteger(b.folderId)) return NextResponse.json({ ok: false, error: "folderId is required" }, { status: 400 });
      const r = await brevo<{ id: number }>("POST", "/contacts/lists", { name, folderId: b.folderId });
      await recordAudit({ action: "brevo.list_create", entityType: "brevo_list", entityId: String(r.id), summary: name, actor: gate.user, request: req });
      return NextResponse.json({ ok: true, id: r.id });
    }
    return NextResponse.json({ ok: false, error: "kind must be list or folder" }, { status: 400 });
  } catch (e) {
    console.error("[brevo/audience] create", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "create failed" }, { status: 502 });
  }
}
