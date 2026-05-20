// Nitro (NitroCommerce) webhook receiver.
// Auth: caller pastes NITRO_AUTH_TOKEN in their dashboard; we check it on Authorization header.
// Tenant: NITRO_ORG_TOKEN must match body.org_token.
// Dedupe: (userId|eventName|timestamp) unique on nitro_events.dedupe_key.

import { db } from "../_shared/supabase.ts";

type Customer = { email?: string | null; phone?: string | null; name?: string | null };

function normPhone(p?: string | null): string | null {
  if (!p) return null;
  const t = p.trim();
  if (!t) return null;
  return t.startsWith("+") ? t : `+${t.replace(/\D/g, "")}`;
}

function priceToCents(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function checkAuth(req: Request): boolean {
  const expected = Deno.env.get("NITRO_AUTH_TOKEN");
  if (!expected) return false;
  const got = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const stripped = got.replace(/^Bearer\s+/i, "").trim();
  return stripped === expected || got === expected;
}

async function upsertContact(opts: {
  phone: string | null;
  email: string | null;
  name: string | null;
  nitro_user_id: string | null;
  geo?: { country?: string | null; state?: string | null; city?: string | null; postal?: string | null };
}): Promise<string | null> {
  const { phone, email, name, nitro_user_id, geo } = opts;
  if (!phone && !email) return null;

  const wa_id = phone ? phone.replace(/\D/g, "") : null;
  const patch: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
  };
  if (name) patch.name = name;
  if (email) patch.email = email;
  if (nitro_user_id) patch.nitro_user_id = nitro_user_id;
  if (geo?.country) patch.geo_country = geo.country;
  if (geo?.state) patch.geo_state = geo.state;
  if (geo?.city) patch.geo_city = geo.city;
  if (geo?.postal) patch.geo_postal = geo.postal;

  // Prefer phone match (wa_id is unique), fallback to email
  if (phone && wa_id) {
    const { data } = await db().from("wa_contacts").select("id").eq("wa_id", wa_id).maybeSingle();
    if (data?.id) {
      await db().from("wa_contacts").update(patch).eq("id", data.id);
      return data.id;
    }
    const { data: ins, error } = await db().from("wa_contacts").insert({
      wa_id, phone, name, email, nitro_user_id,
      geo_country: geo?.country, geo_state: geo?.state, geo_city: geo?.city, geo_postal: geo?.postal,
      last_seen_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    if (error) { console.error("contact insert (phone)", error); return null; }
    return ins?.id ?? null;
  }

  if (email) {
    const { data } = await db().from("wa_contacts").select("id").eq("email", email).maybeSingle();
    if (data?.id) {
      await db().from("wa_contacts").update(patch).eq("id", data.id);
      return data.id;
    }
    // Email-only contact: synthesise a wa_id placeholder so uniqueness holds.
    const synthetic = `email:${email}`;
    const { data: ins, error } = await db().from("wa_contacts").insert({
      wa_id: synthetic, phone: synthetic, name, email, nitro_user_id,
      opted_in: false,
      geo_country: geo?.country, geo_state: geo?.state, geo_city: geo?.city, geo_postal: geo?.postal,
      last_seen_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    if (error) { console.error("contact insert (email)", error); return null; }
    return ins?.id ?? null;
  }

  return null;
}

const INTENT_SCORE: Record<string, number> = {
  view: 1,
  visitor: 1,
  category_view: 2,
  product_view: 5,
  addtocart: 15,
  removefromcart: -5,
  checkout: 25,
  hiu_tagged: 40,
  "orders/create": 50,
  "orders/paid": 60,
  "orders/fulfilled": 10,
  "orders/updated": 5,
};

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return new Response("nitro-webhook ok", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("method", { status: 405 });
  }
  if (!checkAuth(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response("bad-json", { status: 400 }); }

  const expectedOrg = Deno.env.get("NITRO_ORG_TOKEN");
  // Contacts export uses "org_id" instead of "org_token"
  const orgToken: string | undefined = body.org_token || body.org_id;
  if (!orgToken) {
    return new Response("missing-org", { status: 400 });
  }
  // Bootstrap mode: if NITRO_ORG_TOKEN unset or "*", accept any org_token and log it.
  const bootstrap = !expectedOrg || expectedOrg === "*";
  if (bootstrap) {
    console.log(`[nitro-webhook] BOOTSTRAP — received org_token=${orgToken}`);
  } else if (orgToken !== expectedOrg) {
    return new Response("bad-org", { status: 401 });
  }

  // Branch: Contacts Export (different envelope)
  if (body.type === "PHONE" || body.type === "EMAIL") {
    const isPhone = body.type === "PHONE";
    const phone = isPhone ? normPhone(body.contact) : null;
    const email = isPhone ? null : (typeof body.contact === "string" ? body.contact : null);
    const contactId = await upsertContact({
      phone, email, name: body.name ?? null,
      nitro_user_id: body.nitro_id ?? null,
      geo: { country: body.country, state: body.state, city: body.city, postal: body.postal },
    });
    const dedupeKey = `contacts|${body.nitro_id}|${body.type}|${body.timestamp}`;
    await db().from("nitro_events").upsert({
      org_token: orgToken,
      event_name: `contacts/${body.type.toLowerCase()}`,
      nitro_user_id: body.nitro_id ?? null,
      contact_id: contactId,
      customer_phone: phone,
      customer_email: email,
      customer_name: body.name ?? null,
      payload: body,
      dedupe_key: dedupeKey,
      event_ts: body.timestamp ?? null,
    }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    return new Response(JSON.stringify({ ok: true, kind: "contact" }), {
      headers: { "content-type": "application/json" },
    });
  }

  // Activity / Consent / FBP / HIU envelope
  const eventName: string = body.eventName || "unknown";
  const userId: string | null = body.userId ?? null;
  const ts: string | null = body.timestamp ?? null;
  const eventVal = body.eventVal ?? {};
  const cust: Customer = (typeof eventVal === "object" && eventVal && eventVal.customer) || {};
  const phone = normPhone(cust.phone);
  const email = (cust.email && typeof cust.email === "string") ? cust.email : null;
  const name = cust.name ?? null;

  const contactId = await upsertContact({
    phone, email, name,
    nitro_user_id: userId,
    geo: { country: body.country, state: body.state, city: body.city, postal: body.pincode },
  });

  // Pull common per-event fields
  const cartValueCents = priceToCents(eventVal?.cart_value);
  const orderId = eventVal?.order_id ?? null;
  const orderNumber = eventVal?.order_number ?? null;
  const resourceId = eventVal?.resource_id ?? null;
  const pageUrl = eventVal?.page ?? body.u ?? null;

  const dedupeKey = `${userId ?? "nouser"}|${eventName}|${ts ?? Date.now()}`;
  const { error: evErr } = await db().from("nitro_events").upsert({
    org_token: orgToken,
    event_name: eventName,
    nitro_user_id: userId,
    contact_id: contactId,
    customer_phone: phone,
    customer_email: email,
    customer_name: name,
    cart_value_cents: cartValueCents,
    order_id: orderId,
    order_number: orderNumber,
    resource_id: resourceId,
    page_url: pageUrl,
    payload: body,
    dedupe_key: dedupeKey,
    event_ts: ts,
  }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (evErr) console.error("nitro_events upsert", evErr);

  // Derived updates on wa_contacts
  if (contactId) {
    const updates: Record<string, unknown> = {};

    // Order lifecycle → LTV
    if (eventName === "orders/create" || eventName === "orders/paid") {
      const cents = priceToCents(eventVal?.price);
      if (cents && cents > 0) {
        const { data } = await db().from("wa_contacts")
          .select("ltv_cents, order_count").eq("id", contactId).maybeSingle();
        updates.ltv_cents = (data?.ltv_cents ?? 0) + cents;
        updates.order_count = (data?.order_count ?? 0) + 1;
        updates.last_order_at = ts ?? new Date().toISOString();
      }
    }

    // Cart snapshot
    if (cartValueCents !== null && cartValueCents > 0) {
      updates.last_cart_value_cents = cartValueCents;
    }

    // Intent
    const bump = INTENT_SCORE[eventName];
    if (typeof bump === "number") {
      const { data } = await db().from("wa_contacts")
        .select("intent_score").eq("id", contactId).maybeSingle();
      const current = data?.intent_score ?? 0;
      const next = Math.max(0, Math.min(500, current + bump));
      updates.intent_score = next;
      updates.last_intent_at = ts ?? new Date().toISOString();
      updates.last_intent_event = eventName;
    }

    // HIU first_session_date
    if (eventName === "hiu_tagged" && eventVal?.first_session_date) {
      updates.first_session_at = eventVal.first_session_date;
    }

    // Consent
    if (eventName === "is_consented" || eventName === "otp_verified" || eventName === "tc_verified") {
      updates.opted_in = true;
      updates.consent_source = eventVal?.source || eventName;
      updates.consent_verified_at = ts ?? new Date().toISOString();
    }

    // Facebook FBP
    if (eventName === "facebook_identify" && typeof body.eventVal === "string") {
      updates.fbp = body.eventVal;
    }

    if (Object.keys(updates).length > 0) {
      await db().from("wa_contacts").update(updates).eq("id", contactId);
    }
  }

  return new Response(JSON.stringify({ ok: true, event: eventName, contact: contactId }), {
    headers: { "content-type": "application/json" },
  });
});
