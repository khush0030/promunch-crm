const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export const PLACED_ORDER_METRIC_ID = 'XZHFcf';

function getKey(): string {
  const key = process.env.KLAVIYO_API_KEY;
  if (!key) throw new Error('KLAVIYO_API_KEY is not set');
  return key;
}

async function klaviyoFetch(url: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Klaviyo-API-Key ${getKey()}`,
        revision: KLAVIYO_REVISION,
        Accept: 'application/json',
      },
    });
    if (res.status === 429) {
      const wait = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Klaviyo API ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }
  throw new Error('Klaviyo API: rate limit retries exhausted');
}

export interface KlaviyoLocation {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  zip?: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ip?: string | null;
}

export interface KlaviyoSubscriptionConsent {
  consent?: string | null;
  timestamp?: string | null;
  method?: string | null;
}

export interface KlaviyoProfile {
  type: 'profile';
  id: string;
  attributes: {
    email: string | null;
    phone_number: string | null;
    external_id: string | null;
    anonymous_id: string | null;
    first_name: string | null;
    last_name: string | null;
    organization: string | null;
    title: string | null;
    image: string | null;
    locale: string | null;
    created: string | null;
    updated: string | null;
    last_event_date: string | null;
    location: KlaviyoLocation | null;
    properties: Record<string, unknown> | null;
    predictive_analytics?: Record<string, unknown> | null;
    subscriptions?: {
      email?: { marketing?: KlaviyoSubscriptionConsent };
      sms?: { marketing?: KlaviyoSubscriptionConsent };
    } | null;
  };
}

interface KlaviyoProfilesPage {
  data: KlaviyoProfile[];
  links: { next: string | null };
}

export async function* iterateAllProfiles(pageSize = 100): AsyncGenerator<KlaviyoProfile, void, void> {
  let url: string | null =
    `${KLAVIYO_BASE}/profiles/?page%5Bsize%5D=${pageSize}` +
    `&additional-fields%5Bprofile%5D=subscriptions,predictive_analytics`;
  while (url) {
    const res = await klaviyoFetch(url);
    const json = (await res.json()) as KlaviyoProfilesPage;
    for (const profile of json.data) yield profile;
    url = json.links?.next || null;
  }
}

export interface KlaviyoEvent {
  type: 'event';
  id: string;
  attributes: {
    timestamp: number;
    event_properties: {
      $value?: number;
      $event_id?: string;
      $currency_code?: string;
      Items?: string[];
      'Item Count'?: number;
      'Discount Codes'?: string[];
      $extra?: Record<string, unknown> & {
        order_number?: number;
        name?: string;
        currency?: string;
        total_tax?: string;
        total_discounts?: string;
        processed_at?: string;
        token?: string;
      };
      [key: string]: unknown;
    };
  };
  relationships: {
    profile: { data: { type: 'profile'; id: string } };
    metric: { data: { type: 'metric'; id: string } };
  };
}

interface KlaviyoEventsPage {
  data: KlaviyoEvent[];
  included?: Array<{
    type: string;
    id: string;
    attributes: { email?: string | null };
  }>;
  links: { next: string | null };
}

export interface KlaviyoEventWithEmail {
  event: KlaviyoEvent;
  email: string | null;
}

export async function* iterateMetricEvents(
  metricId: string,
  pageSize = 200
): AsyncGenerator<KlaviyoEventWithEmail, void, void> {
  let url: string | null =
    `${KLAVIYO_BASE}/events/?filter=equals(metric_id,%22${metricId}%22)&include=profile&page%5Bsize%5D=${pageSize}`;
  while (url) {
    const res = await klaviyoFetch(url);
    const json = (await res.json()) as KlaviyoEventsPage;
    const profileEmailById = new Map<string, string | null>();
    for (const inc of json.included || []) {
      if (inc.type === 'profile') profileEmailById.set(inc.id, inc.attributes.email || null);
    }
    for (const event of json.data) {
      const profileId = event.relationships.profile.data.id;
      yield { event, email: profileEmailById.get(profileId) || null };
    }
    url = json.links?.next || null;
  }
}

export interface KlaviyoList {
  id: string;
  name: string;
}

export async function listAllLists(): Promise<KlaviyoList[]> {
  const out: KlaviyoList[] = [];
  let url: string | null = `${KLAVIYO_BASE}/lists/?page%5Bsize%5D=10`;
  while (url) {
    const res = await klaviyoFetch(url);
    const json: { data: Array<{ id: string; attributes: { name: string } }>; links: { next: string | null } } =
      await res.json();
    for (const l of json.data) out.push({ id: l.id, name: l.attributes.name });
    url = json.links?.next || null;
  }
  return out;
}

export async function listAllSegments(): Promise<KlaviyoList[]> {
  const out: KlaviyoList[] = [];
  let url: string | null = `${KLAVIYO_BASE}/segments/?page%5Bsize%5D=10`;
  while (url) {
    const res = await klaviyoFetch(url);
    const json: { data: Array<{ id: string; attributes: { name: string } }>; links: { next: string | null } } =
      await res.json();
    for (const s of json.data) out.push({ id: s.id, name: s.attributes.name });
    url = json.links?.next || null;
  }
  return out;
}

export async function getProfileIdsInList(listId: string): Promise<string[]> {
  const out: string[] = [];
  let url: string | null = `${KLAVIYO_BASE}/lists/${listId}/relationships/profiles/?page%5Bsize%5D=1000`;
  while (url) {
    const res = await klaviyoFetch(url);
    const json: { data: Array<{ id: string }>; links: { next: string | null } } = await res.json();
    for (const p of json.data) out.push(p.id);
    url = json.links?.next || null;
  }
  return out;
}

export async function getProfileIdsInSegment(segmentId: string): Promise<string[]> {
  const out: string[] = [];
  let url: string | null = `${KLAVIYO_BASE}/segments/${segmentId}/relationships/profiles/?page%5Bsize%5D=1000`;
  while (url) {
    const res = await klaviyoFetch(url);
    const json: { data: Array<{ id: string }>; links: { next: string | null } } = await res.json();
    for (const p of json.data) out.push(p.id);
    url = json.links?.next || null;
  }
  return out;
}
