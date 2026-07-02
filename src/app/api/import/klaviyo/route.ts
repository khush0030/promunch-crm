import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  iterateAllProfiles,
  iterateMetricEvents,
  PLACED_ORDER_METRIC_ID,
  listAllLists,
  listAllSegments,
  getProfileIdsInList,
  getProfileIdsInSegment,
  type KlaviyoEvent,
} from '@/lib/klaviyo';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

interface ContactUpsert {
  email: string;
  klaviyo_id: string;
  external_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  address1: string | null;
  address2: string | null;
  zip: string | null;
  locale: string | null;
  timezone: string | null;
  organization: string | null;
  title: string | null;
  image_url: string | null;
  accepts_marketing: boolean | null;
  email_consent: string | null;
  sms_consent: string | null;
  consent_source: string | null;
  consent_timestamp: string | null;
  klaviyo_created_at: string | null;
  klaviyo_updated_at: string | null;
  last_event_at: string | null;
  properties: Record<string, unknown> | null;
  predictive_analytics: Record<string, unknown> | null;
  status: string;
  source: string;
}

interface OrderAgg {
  count: number;
  total: number;
  firstTs: number;
  lastTs: number;
}

interface OrderUpsert {
  contact_id: string;
  shopify_order_id: string | null;
  order_number: string | null;
  total_amount: number;
  currency: string;
  status: string | null;
  products: { items?: string[]; itemCount?: number; discountCodes?: string[] };
  placed_at: string;
}

const PROFILE_BATCH_SIZE = 200;
const UPDATE_CONCURRENCY = 20;
const ORDER_BATCH_SIZE = 200;

function getString(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function getBool(obj: Record<string, unknown> | null | undefined, key: string): boolean | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'boolean' ? v : null;
}

export async function POST() {
  const start = Date.now();
  let scanned = 0;
  let imported = 0;
  let skippedNoEmail = 0;
  let ordersScanned = 0;
  let ordersUpserted = 0;
  let contactsWithOrders = 0;
  let listsCount = 0;
  let segmentsCount = 0;
  const seenEmails = new Set<string>();
  const klaviyoIdToEmail = new Map<string, string>();
  let batch: ContactUpsert[] = [];
  let lastError: string | null = null;

  async function flushProfiles() {
    if (batch.length === 0) return;
    const { error } = await supabase
      .from('contacts')
      .upsert(batch, { onConflict: 'email', ignoreDuplicates: false });
    if (error) lastError = error.message;
    else imported += batch.length;
    batch = [];
  }

  try {
    for await (const profile of iterateAllProfiles(100)) {
      scanned++;
      const a = profile.attributes;
      const email = a.email?.trim().toLowerCase();
      if (!email) {
        skippedNoEmail++;
        continue;
      }
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
      klaviyoIdToEmail.set(profile.id, email);

      const props = a.properties || null;
      const subs = a.subscriptions || null;
      const emailMarketing = subs?.email?.marketing || null;
      const smsMarketing = subs?.sms?.marketing || null;

      batch.push({
        email,
        klaviyo_id: profile.id,
        external_id: a.external_id,
        first_name: a.first_name,
        last_name: a.last_name,
        phone: a.phone_number,
        city: a.location?.city || null,
        state: a.location?.region || null,
        country: a.location?.country || null,
        address1: a.location?.address1 || null,
        address2: a.location?.address2 || null,
        zip: a.location?.zip || null,
        locale: a.locale,
        timezone: a.location?.timezone || null,
        organization: a.organization,
        title: a.title,
        image_url: a.image,
        accepts_marketing: getBool(props, 'Accepts Marketing'),
        email_consent: emailMarketing?.consent || null,
        sms_consent: smsMarketing?.consent || null,
        consent_source: getString(props, '$source'),
        consent_timestamp: getString(props, '$consent_timestamp'),
        klaviyo_created_at: a.created,
        klaviyo_updated_at: a.updated,
        last_event_at: a.last_event_date,
        properties: props,
        predictive_analytics: a.predictive_analytics || null,
        status: 'active',
        source: 'klaviyo',
      });

      if (batch.length >= PROFILE_BATCH_SIZE) await flushProfiles();
    }
    await flushProfiles();

    const lists = await listAllLists();
    listsCount = lists.length;
    const segments = await listAllSegments();
    segmentsCount = segments.length;

    const listsByProfile = new Map<string, string[]>();
    const segmentsByProfile = new Map<string, string[]>();

    await Promise.all(
      lists.map(async (l) => {
        const ids = await getProfileIdsInList(l.id);
        for (const pid of ids) {
          const arr = listsByProfile.get(pid) || [];
          arr.push(l.name);
          listsByProfile.set(pid, arr);
        }
      })
    );

    await Promise.all(
      segments.map(async (s) => {
        const ids = await getProfileIdsInSegment(s.id);
        for (const pid of ids) {
          const arr = segmentsByProfile.get(pid) || [];
          arr.push(s.name);
          segmentsByProfile.set(pid, arr);
        }
      })
    );

    const profileMembershipEntries = Array.from(klaviyoIdToEmail.entries()).filter(
      ([pid]) => listsByProfile.has(pid) || segmentsByProfile.has(pid)
    );

    for (let i = 0; i < profileMembershipEntries.length; i += UPDATE_CONCURRENCY) {
      const chunk = profileMembershipEntries.slice(i, i + UPDATE_CONCURRENCY);
      await Promise.all(
        chunk.map(async ([pid, email]) => {
          const { error } = await supabase
            .from('contacts')
            .update({
              klaviyo_lists: listsByProfile.get(pid) || null,
              klaviyo_segments: segmentsByProfile.get(pid) || null,
            })
            .eq('email', email);
          if (error) lastError = error.message;
        })
      );
    }

    const aggByEmail = new Map<string, OrderAgg>();
    const eventsByEmail = new Map<string, KlaviyoEvent[]>();
    for await (const { event, email } of iterateMetricEvents(PLACED_ORDER_METRIC_ID, 200)) {
      ordersScanned++;
      if (!email) continue;
      const key = email.trim().toLowerCase();
      const value = Number(event.attributes.event_properties.$value) || 0;
      const ts = event.attributes.timestamp;
      const cur = aggByEmail.get(key);
      if (!cur) aggByEmail.set(key, { count: 1, total: value, firstTs: ts, lastTs: ts });
      else {
        cur.count += 1;
        cur.total += value;
        cur.firstTs = Math.min(cur.firstTs, ts);
        cur.lastTs = Math.max(cur.lastTs, ts);
      }
      const list = eventsByEmail.get(key) || [];
      list.push(event);
      eventsByEmail.set(key, list);
    }
    contactsWithOrders = aggByEmail.size;

    const aggEntries = Array.from(aggByEmail.entries());
    for (let i = 0; i < aggEntries.length; i += UPDATE_CONCURRENCY) {
      const chunk = aggEntries.slice(i, i + UPDATE_CONCURRENCY);
      await Promise.all(
        chunk.map(async ([email, agg]) => {
          const aov = agg.count > 0 ? agg.total / agg.count : 0;
          const { error } = await supabase
            .from('contacts')
            .update({
              total_orders: agg.count,
              total_spent: agg.total,
              average_order_value: aov,
              first_purchase_date: new Date(agg.firstTs * 1000).toISOString(),
              last_purchase_date: new Date(agg.lastTs * 1000).toISOString(),
            })
            .eq('email', email);
          if (error) lastError = error.message;
        })
      );
    }

    const emailsWithOrders = Array.from(eventsByEmail.keys());
    const emailToContactId = new Map<string, string>();
    for (let i = 0; i < emailsWithOrders.length; i += 100) {
      const chunk = emailsWithOrders.slice(i, i + 100);
      const { data, error } = await supabase
        .from('contacts')
        .select('id, email')
        .in('email', chunk);
      if (error) {
        lastError = error.message;
        continue;
      }
      for (const c of data || []) emailToContactId.set(c.email, c.id);
    }

    const orderRows: OrderUpsert[] = [];
    for (const [email, events] of eventsByEmail) {
      const contactId = emailToContactId.get(email);
      if (!contactId) continue;
      for (const ev of events) {
        const props = ev.attributes.event_properties;
        const extra = props.$extra || {};
        const eventId = props.$event_id || null;
        const orderNum = extra.order_number ? String(extra.order_number) : null;
        const placedAtStr = extra.processed_at || new Date(ev.attributes.timestamp * 1000).toISOString();
        const total = Number(props.$value) || 0;
        const currency = props.$currency_code || extra.currency || 'INR';
        orderRows.push({
          contact_id: contactId,
          shopify_order_id: eventId,
          order_number: orderNum,
          total_amount: total,
          currency,
          status: 'confirmed',
          products: {
            items: Array.isArray(props.Items) ? props.Items : [],
            itemCount: typeof props['Item Count'] === 'number' ? (props['Item Count'] as number) : undefined,
            discountCodes: Array.isArray(props['Discount Codes']) ? (props['Discount Codes'] as string[]) : [],
          },
          placed_at: new Date(placedAtStr).toISOString(),
        });
      }
    }

    for (let i = 0; i < orderRows.length; i += ORDER_BATCH_SIZE) {
      const chunk = orderRows.slice(i, i + ORDER_BATCH_SIZE);
      const { error } = await supabase
        .from('orders')
        .upsert(chunk, { onConflict: 'shopify_order_id', ignoreDuplicates: false });
      if (error) lastError = error.message;
      else ordersUpserted += chunk.length;
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  const elapsedMs = Date.now() - start;
  return NextResponse.json({
    ok: !lastError,
    scanned,
    imported,
    skippedNoEmail,
    ordersScanned,
    ordersUpserted,
    contactsWithOrders,
    listsCount,
    segmentsCount,
    elapsedMs,
    error: lastError,
  });
}
