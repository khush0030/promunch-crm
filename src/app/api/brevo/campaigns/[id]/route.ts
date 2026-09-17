import { NextResponse } from "next/server";
import { brevoGet, BrevoError, listAll, section, type Section } from "@/lib/brevo";
import {
  funnel,
  deviceRows,
  browserRows,
  linkRows,
  domainRows,
  listRows,
  breakdownMissing,
  type BrevoCampaignDetail,
  type Funnel,
  type BreakdownRow,
  type LinkRow,
  type DomainRow,
  type ListRow,
} from "@/lib/brevo-shape";

// One Brevo email campaign with every report Brevo exposes for it. Read-only.
// Middleware gates /api/*.
//
// GET /api/brevo/campaigns/:id
export const dynamic = "force-dynamic";

type AbResult = {
  winningVersion?: string;
  winningCriteria?: string;
  winningSubjectLine?: string;
  openRate?: string;
  clickRate?: string;
  winningVersionRate?: string;
  statistics?: { openers?: { "Version A"?: number; "Version B"?: number }; clicks?: { "Version A"?: number; "Version B"?: number } } & Record<string, unknown>;
};

export type CampaignDetailResponse = {
  campaign: {
    id: number;
    name: string;
    subject: string;
    previewText: string;
    type: string;
    status: string;
    tag: string;
    sender: string;
    replyTo: string;
    shareLink: string | null;
    createdAt: string | null;
    modifiedAt: string | null;
    scheduledAt: string | null;
    sentDate: string | null;
    testSent: boolean;
    abTesting: boolean;
    lists: { id: number; name: string }[];
    exclusionLists: { id: number; name: string }[];
    segments: number[];
  };
  funnel: Funnel;
  estimatedViews: number;
  perList: ListRow[];
  links: LinkRow[];
  devices: { groups: BreakdownRow[]; systems: BreakdownRow[] };
  browsers: BreakdownRow[];
  domains: DomainRow[];
  breakdownMissing: { links: boolean; devices: boolean };
  ab: Section<AbResult> | null;
  fetchedAt: string;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "invalid campaign id" }, { status: 400 });

  try {
    // Brevo only fills the statistics block named in `statistics=`; the others
    // come back zeroed. Fetch each block and merge.
    const [c, links_, domains_, devices_, browsers_, lists] = await Promise.all([
      brevoGet<BrevoCampaignDetail>(`/emailCampaigns/${id}?statistics=globalStats`),
      brevoGet<BrevoCampaignDetail>(`/emailCampaigns/${id}?statistics=linksStats`),
      brevoGet<BrevoCampaignDetail>(`/emailCampaigns/${id}?statistics=statsByDomain`),
      brevoGet<BrevoCampaignDetail>(`/emailCampaigns/${id}?statistics=statsByDevice`),
      brevoGet<BrevoCampaignDetail>(`/emailCampaigns/${id}?statistics=statsByBrowser`),
      listAll<{ id: number; name: string }>("/contacts/lists", "lists", 50).catch(() => []),
    ]);
    const names = new Map(lists.map((l) => [l.id, l.name]));
    const s = {
      ...c.statistics,
      linksStats: links_.statistics?.linksStats,
      statsByDomain: domains_.statistics?.statsByDomain,
      statsByDevice: devices_.statistics?.statsByDevice,
      statsByBrowser: browsers_.statistics?.statsByBrowser,
    };
    const f = funnel(s.globalStats as never);
    const links = linkRows(s.linksStats);
    const devices = deviceRows(s.statsByDevice);
    const ab = c.abTesting ? await section(brevoGet<AbResult>(`/emailCampaigns/${id}/abTestCampaignResult`)) : null;
    const named = (ids: number[] | undefined) => (ids ?? []).map((lid) => ({ id: lid, name: names.get(lid) ?? `List #${lid}` }));

    const body: CampaignDetailResponse = {
      campaign: {
        id: c.id,
        name: c.name,
        subject: c.subject ?? "",
        previewText: c.previewText ?? "",
        type: c.type ?? "classic",
        status: c.status,
        tag: c.tag ?? "",
        sender: c.sender ? `${c.sender.name ?? ""} <${c.sender.email ?? ""}>`.trim() : "",
        replyTo: c.replyTo ?? "",
        shareLink: c.shareLink && /^https?:/.test(c.shareLink) ? c.shareLink : null,
        createdAt: c.createdAt ?? null,
        modifiedAt: c.modifiedAt ?? null,
        scheduledAt: c.scheduledAt || null,
        sentDate: c.sentDate ?? null,
        testSent: c.testSent === true,
        abTesting: c.abTesting === true,
        lists: named(c.recipients?.lists),
        exclusionLists: named(c.recipients?.exclusionLists),
        segments: c.recipients?.segments ?? [],
      },
      funnel: f,
      estimatedViews: typeof s.globalStats?.estimatedViews === "number" ? s.globalStats.estimatedViews : 0,
      perList: listRows(s.campaignStats, names),
      links,
      devices,
      browsers: browserRows(s.statsByBrowser),
      domains: domainRows(s.statsByDomain),
      breakdownMissing: {
        links: links.length > 0 && breakdownMissing({ ...f, opens: 0 }, links),
        devices: breakdownMissing(f, devices.groups),
      },
      ab,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (e) {
    const status = e instanceof BrevoError && e.notFound ? 404 : 502;
    console.error("[brevo/campaigns/:id]", id, e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "campaign failed" }, { status });
  }
}
