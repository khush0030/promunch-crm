// Server-side audience resolution for Email Studio (count + send list). Reads
// with 1000-row pagination everywhere (PostgREST truncates silently at 1000,
// the cause of a past duplicate incident) and builds only the lookups the
// rules actually need.

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  matchesAudience,
  type AudienceContact,
  type AudienceRules,
  type MatchContext,
} from "@/lib/email-studio/segments";

const PAGE = 1000;

const CONTACT_COLS =
  "id, email, first_name, last_name, phone, status, accepts_marketing, email_consent, total_orders, total_spent, first_purchase_date, last_purchase_date, city, state, tags";

export type ResolvedContact = AudienceContact & { phone: string | null };

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Last 10 digits: matches +91 98..., 9198..., 98... to one key. */
export function phoneKey(p: string | null | undefined): string | null {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export async function fetchSuppressed(): Promise<Set<string>> {
  const rows = await pageAll<{ email: string }>((a, b) =>
    supabase.from("suppressions").select("email").order("email").range(a, b),
  );
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

async function engagedSince(days: number): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const ev = await pageAll<{ contact_id: string | null }>((a, b) =>
    supabase
      .from("email_events")
      .select("contact_id")
      .in("event_type", ["opened", "clicked"])
      .gte("created_at", since)
      .order("id")
      .range(a, b),
  );
  const flows = await pageAll<{ contact_id: string | null }>((a, b) =>
    supabase.from("email_sends").select("contact_id").or(`opened_at.gte."${since}",clicked_at.gte."${since}"`).order("id").range(a, b),
  );
  return new Set([...ev, ...flows].map((r) => r.contact_id).filter((x): x is string => !!x));
}

/** Buyers of products whose name contains `needle`: emails + phone keys. */
async function buyersOf(needles: string[], contacts: ResolvedContact[]): Promise<Map<string, Set<string>>> {
  const orders = await pageAll<{ customer_email: string | null; customer_phone: string | null; line_items: unknown }>((a, b) =>
    supabase
      .from("shopify_orders")
      .select("customer_email, customer_phone, line_items")
      .is("cancelled_at", null)
      .order("id")
      .range(a, b),
  );
  // Phone → contact email, so phone-only orders still credit the contact.
  const emailByPhone = new Map<string, string>();
  for (const c of contacts) {
    const k = phoneKey(c.phone);
    if (k && c.email) emailByPhone.set(k, c.email.toLowerCase());
  }
  const out = new Map<string, Set<string>>();
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const set = new Set<string>();
    for (const o of orders) {
      const items = Array.isArray(o.line_items) ? (o.line_items as { name?: string; title?: string }[]) : [];
      if (!items.some((i) => String(i?.name ?? i?.title ?? "").toLowerCase().includes(n))) continue;
      if (o.customer_email) set.add(o.customer_email.toLowerCase());
      const viaPhone = emailByPhone.get(phoneKey(o.customer_phone) ?? "");
      if (viaPhone) set.add(viaPhone);
    }
    out.set(n, set);
  }
  return out;
}

async function fetchContacts(): Promise<ResolvedContact[]> {
  return pageAll<ResolvedContact>((a, b) =>
    supabase.from("contacts").select(CONTACT_COLS).not("email", "is", null).order("id").range(a, b),
  );
}

/** Everyone the rules select, after consent + suppression. */
export async function resolveAudience(rules: AudienceRules): Promise<ResolvedContact[]> {
  const [contacts, suppressed] = await Promise.all([fetchContacts(), fetchSuppressed()]);
  const ctx: MatchContext = { now: Date.now(), suppressed };

  const engagedWindows = [...new Set(rules.conditions.filter((c) => c.field === "engaged_days").map((c) => c.value as number))];
  if (engagedWindows.length) {
    ctx.engaged = new Map();
    for (const d of engagedWindows) ctx.engaged.set(d, await engagedSince(d));
  }
  const needles = rules.conditions.filter((c) => c.field === "bought").map((c) => String(c.value));
  if (needles.length) ctx.buyers = await buyersOf(needles, contacts);

  return contacts.filter((c) => matchesAudience(c, rules, ctx));
}

/** Count + a few sample names for the live audience preview. */
export async function countAudience(rules: AudienceRules): Promise<{ count: number; sample: string[] }> {
  const list = await resolveAudience(rules);
  const sample = list
    .slice(0, 5)
    .map((c) => [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.email ?? "").replace(/(.{2}).*(@.*)/, "$1…$2"));
  return { count: list.length, sample };
}
