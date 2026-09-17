import { NextResponse } from "next/server";
import { brevoGet, listAll, section, orNull, type Section } from "@/lib/brevo";
import {
  planLines,
  healthIssues,
  dnsRows,
  type BrevoAccount,
  type BrevoSender,
  type BrevoDomainConfig,
  type BrevoWebhook,
  type PlanLine,
  type HealthIssue,
  type DnsRow,
} from "@/lib/brevo-shape";

// Brevo account + sending health for Marketing > Email (Brevo) > Health.
// Read-only. Each block is settled separately so one failing Brevo endpoint
// does not blank the page. Middleware gates /api/*.
//
// GET /api/brevo/health[?fresh=1]
export const dynamic = "force-dynamic";

type Process = { id: number; name: string; status: string };
type BlockedContact = { email: string; reason?: { code?: string; message?: string }; blockedAt?: string; senderEmail?: string };

export type HealthResponse = {
  account: Section<{ companyName: string | null; email: string | null; relayEnabled: boolean; plans: PlanLine[] }>;
  senders: Section<BrevoSender[]>;
  domains: Section<{ domain: string; verified: boolean; authenticated: boolean; dns: DnsRow[] }[]>;
  webhooks: Section<BrevoWebhook[]>;
  processes: Section<Process[]>;
  blockedContacts: Section<{ count: number; recent: BlockedContact[] }>;
  blockedDomains: Section<string[]>;
  issues: HealthIssue[];
  fetchedAt: string;
};

const CACHE_TTL_MS = 2 * 60_000;
let cache: { at: number; body: HealthResponse } | null = null;

async function domainConfigs(): Promise<BrevoDomainConfig[]> {
  const { domains } = await brevoGet<{ domains?: { domain_name: string }[] }>("/senders/domains");
  return Promise.all((domains ?? []).map((d) => brevoGet<BrevoDomainConfig>(`/senders/domains/${encodeURIComponent(d.domain_name)}`)));
}

async function webhooks(): Promise<BrevoWebhook[]> {
  // Brevo answers "document_not_found" instead of [] when none exist.
  const [m, t] = await Promise.all([
    orNull(brevoGet<{ webhooks?: BrevoWebhook[] }>("/webhooks?type=marketing")),
    orNull(brevoGet<{ webhooks?: BrevoWebhook[] }>("/webhooks?type=transactional")),
  ]);
  return [...(m?.webhooks ?? []), ...(t?.webhooks ?? [])];
}

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body, { headers: { "x-cache": "hit" } });
  }
  const now = new Date();
  const [accountRaw, senders, domainsRaw, hooks, processes, blocked, blockedDomains] = await Promise.all([
    section(brevoGet<BrevoAccount>("/account")),
    section(brevoGet<{ senders?: BrevoSender[] }>("/senders").then((r) => r.senders ?? [])),
    section(domainConfigs()),
    section(webhooks()),
    section(listAll<Process>("/processes", "processes", 50).then((p) => p.slice(0, 20))),
    section(brevoGet<{ contacts?: BlockedContact[]; count?: number }>("/smtp/blockedContacts?limit=20&sort=desc")),
    section(brevoGet<{ domains?: string[] }>("/smtp/blockedDomains").then((r) => r.domains ?? [])),
  ]);

  const plans = accountRaw.state === "ok" ? planLines(accountRaw.data, now) : [];
  const body: HealthResponse = {
    account:
      accountRaw.state === "ok"
        ? {
            state: "ok",
            data: {
              companyName: accountRaw.data.companyName ?? null,
              email: accountRaw.data.email ?? null,
              relayEnabled: accountRaw.data.relay?.enabled === true,
              plans,
            },
          }
        : accountRaw,
    senders,
    domains:
      domainsRaw.state === "ok"
        ? { state: "ok", data: domainsRaw.data.map((d) => ({ domain: d.domain, verified: d.verified, authenticated: d.authenticated, dns: dnsRows(d) })) }
        : domainsRaw,
    webhooks: hooks,
    processes,
    blockedContacts:
      blocked.state === "ok" ? { state: "ok", data: { count: blocked.data.count ?? 0, recent: blocked.data.contacts ?? [] } } : blocked,
    blockedDomains,
    issues: healthIssues({
      plans,
      senders: senders.state === "ok" ? senders.data : [],
      domains: domainsRaw.state === "ok" ? domainsRaw.data : [],
      webhooks: hooks.state === "ok" ? hooks.data : null,
    }),
    fetchedAt: now.toISOString(),
  };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "x-cache": "miss" } });
}
