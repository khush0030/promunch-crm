// Create & sync WhatsApp message templates at Meta.
//
// The wa_templates table is only a LOCAL registry — marking a row
// status='approved' there does nothing. A template must also exist and be
// approved inside the WhatsApp Business Account, or wa-send gets Meta error
// 132001 ("Template name does not exist in the translation").
//
// POST modes (JSON body):
//   { names?: string[] }   — create one/all of the predefined journey set
//   { template: {...} }    — create one arbitrary template (dashboard builder)
//   { edit: true, names? } — resubmit existing templates' content (e.g. copy
//                            changes) to Meta by their stored meta_template_id
//   { sync: true }         — pull every template from Meta, mirror real
//                            status/body/category back into wa_templates
//   { waba?: "..." }       — optional explicit WABA id (else secret/discovery)
//
// GET ?debug=1 — dump token + WABA discovery diagnostics.
//
// Auth: verify_jwt = true. Called by the Next.js API routes with the
// service-role bearer.

import { db } from "../_shared/supabase.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

function token(): string {
  const t = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!t) throw new Error("Missing WHATSAPP_ACCESS_TOKEN");
  return t;
}

type MetaCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

interface TemplateDef {
  name: string;
  language: string;
  category: MetaCategory;
  header?: string;          // optional TEXT header
  body: string;             // positional {{1}} {{2}} …
  footer?: string;
  bodyExample: string[];    // one sample value per body variable, in order
  headerExample?: string[]; // one sample value per header variable
  // optional dynamic URL button — url carries a trailing {{1}}, filled per send
  button?: { text: string; url: string; example: string };
}

// Predefined journey set — variable contracts mirror what shopify-wa /
// wa-journey-tick actually send.
//   order_confirmation     : 1=name 2=orderRef 3=total
//   shipping_update        : 1=name 2=orderRef 3=tracking
//   abandoned_checkout     : 1=name 2=coupon   3=cartUrl
//   review_request         : 1=name 2=reviewUrl
//   replenishment_reminder : 1=name 2=siteUrl
const TEMPLATES: TemplateDef[] = [
  {
    name: "order_confirmation",
    language: "en",
    category: "UTILITY",
    body:
      "Hi {{1}}, your PROMUNCH order {{2}} is confirmed! 🎉\n\n" +
      "Order total: {{3}}\n\n" +
      "We'll message you the moment it ships. Thanks for snacking smart with PROMUNCH!",
    bodyExample: ["Aarav", "#PM1042", "₹598"],
    footer: "PROMUNCH — snack smart",
  },
  {
    name: "shipping_update",
    language: "en",
    category: "UTILITY",
    body:
      "Good news {{1}}! Your PROMUNCH order {{2}} has shipped 🚚\n\n" +
      "Track it here:\n{{3}}\n\n" +
      "Thanks for snacking smart with PROMUNCH!",
    bodyExample: ["Aarav", "#PM1042", "https://track.promunch.in/PM1042"],
    footer: "PROMUNCH — snack smart",
  },
  {
    // Abandoned-cart reminder (step 1) — NO discount. Just a nudge back to the
    // customer's own recovery checkout. The "Complete Order" URL button is a
    // dynamic link: base https://promunch.in/{{1}}, filled with the recovery
    // checkout path so tapping it drops them straight back on their cart.
    name: "abandoned_cart_reminder",
    language: "en",
    category: "MARKETING",
    body:
      "Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒\n\n" +
      "Complete your order before they sell out — tap below to pick up right where you left off!\n\n" +
      "— Your Munchy Pal 💚",
    bodyExample: ["Aarav"],
    footer: "Reply STOP to opt out",
    button: {
      text: "Complete Order",
      url: "https://promunch.in/{{1}}",
      example: "https://promunch.in/12345/checkouts/abc123/recover",
    },
  },
  {
    // Abandoned-cart recovery (step 2/3) — image-free, with a "Checkout Now"
    // URL button. The button is a dynamic Shopify discount link: it applies the
    // coupon and redirects to the customer's own recovery checkout (discount
    // pre-applied). Sent only after the reminder fails to convert.
    name: "abandoned_cart_recovery",
    language: "en",
    category: "MARKETING",
    body:
      "Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒\n\n" +
      "We've applied a special discount for you — tap below to grab them before they sell out!\n\n" +
      "— Your Munchy Pal 💚",
    bodyExample: ["Aarav"],
    footer: "Reply STOP to opt out",
    button: {
      text: "Checkout Now",
      url: "https://promunch.in/{{1}}",
      example: "https://promunch.in/discount/PROTEIN15?redirect=%2Fcart",
    },
  },
  {
    name: "review_request",
    language: "en",
    category: "MARKETING",
    body:
      "Hi {{1}}, hope you're loving your PROMUNCH snacks! 💚\n\n" +
      "Mind leaving a quick review? It really helps us:\n{{2}}\n\n" +
      "Thanks a ton — your Munchy Pal, Team PROMUNCH 💚",
    bodyExample: ["Aarav", "https://promunch.in/reviews"],
    footer: "Reply STOP to opt out",
  },
  {
    name: "replenishment_reminder",
    language: "en",
    category: "MARKETING",
    body:
      "Running low, {{1}}? 🥜\n\n" +
      "Restock your PROMUNCH favourites in a tap:\n{{2}}\n\n" +
      "Happy munching — your Munchy Pal! 💚",
    bodyExample: ["Aarav", "https://promunch.in"],
    footer: "Reply STOP to opt out",
  },
];

Deno.serve(async (req) => {
  // GET ?debug=1 — diagnose WABA discovery.
  if (req.method === "GET" && new URL(req.url).searchParams.get("debug")) {
    return j(await diagnose());
  }
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  const b = await req.json().catch(() => ({} as Record<string, unknown>));

  // Resolve the WhatsApp Business Account id: explicit body > secret > discovery.
  let waba: string | null =
    (typeof b?.waba === "string" && b.waba.trim()) ||
    Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID") ||
    null;
  if (!waba) waba = await discoverWaba().catch(() => null);
  if (!waba) {
    return j({
      error:
        "Could not resolve WhatsApp Business Account id. Set the " +
        "WHATSAPP_BUSINESS_ACCOUNT_ID secret, or ensure the access token has " +
        "whatsapp_business_management permission.",
    }, 400);
  }

  const sb = db();

  // --- sync mode: pull Meta's templates into wa_templates --------------------
  if (b?.sync === true) {
    try {
      const synced = await syncFromMeta(waba, sb);
      return j({ ok: true, mode: "sync", waba, synced });
    } catch (e) {
      return j({ ok: false, error: String(e) }, 500);
    }
  }

  // --- edit mode: resubmit existing templates' content to Meta --------------
  // { edit: true, names?: [...] } — rebuild components from the local TEMPLATES
  // defs and PATCH them at Meta by their stored meta_template_id. Used to push
  // copy changes (e.g. the brand tagline) onto already-approved templates.
  if (b?.edit === true) {
    const names: string[] | undefined = Array.isArray(b?.names) && b.names.length
      ? (b.names as string[])
      : undefined;
    const editDefs = names ? TEMPLATES.filter((t) => names.includes(t.name)) : TEMPLATES;
    if (editDefs.length === 0) return j({ error: "no matching template names" }, 400);

    const results: Array<Record<string, unknown>> = [];
    for (const def of editDefs) {
      const { data: row } = await sb
        .from("wa_templates")
        .select("meta_template_id")
        .eq("name", def.name).eq("language", def.language)
        .maybeSingle();
      const id = row?.meta_template_id;
      if (!id) {
        results.push({ name: def.name, ok: false, error: "no meta_template_id on file — create it first" });
        continue;
      }
      const edited = await editTemplate(String(id), def);
      results.push({ name: def.name, ...edited });
      if (edited.ok) {
        await sb.from("wa_templates").update({
          status: "pending",
          body: def.body,
          footer: def.footer ?? null,
          variables: def.bodyExample.map((sample, i) => ({ name: String(i + 1), sample })),
          rejection_reason: null,
        }).eq("name", def.name).eq("language", def.language);
      }
    }
    return j({ ok: results.every((r) => r.ok), mode: "edit", waba, results });
  }

  // --- build the list of definitions to create ------------------------------
  let defs: TemplateDef[];
  if (b?.template) {
    try {
      defs = [normalizeIncoming(b.template as Record<string, unknown>)];
    } catch (e) {
      return j({ error: String(e instanceof Error ? e.message : e) }, 400);
    }
  } else {
    const names: string[] | undefined = Array.isArray(b?.names) && b.names.length
      ? (b.names as string[])
      : undefined;
    defs = names ? TEMPLATES.filter((t) => names.includes(t.name)) : TEMPLATES;
  }
  if (defs.length === 0) return j({ error: "no matching template names" }, 400);

  const results: Array<Record<string, unknown>> = [];
  for (const def of defs) {
    const created = await createTemplate(waba, def);
    results.push({ name: def.name, ...created });

    // Mirror Meta's response into the local registry.
    if (created.ok) {
      await sb.from("wa_templates").upsert({
        name: def.name,
        language: def.language,
        category: localCategory(def.category),
        status: localStatus(created.status),
        meta_template_id: created.id ?? null,
        header_type: def.header ? "TEXT" : null,
        header_text: def.header ?? null,
        body: def.body,
        footer: def.footer ?? null,
        variables: def.bodyExample.map((sample, i) => ({ name: String(i + 1), sample })),
        rejection_reason: null,
      }, { onConflict: "name,language" });
    }
  }

  return j({ ok: results.every((r) => r.ok), waba, results });
});

// Accept a dashboard-builder template object and shape it into a TemplateDef.
function normalizeIncoming(t: Record<string, unknown>): TemplateDef {
  const name = String(t.name ?? "").trim();
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error("name must be lowercase letters, digits and underscores only");
  }
  const body = String(t.body ?? "").trim();
  if (!body) throw new Error("body is required");

  const header = t.header_text ? String(t.header_text).trim() : undefined;
  const footer = t.footer ? String(t.footer).trim() : undefined;

  // body_samples / header_samples: one value per {{n}}, in order.
  const bodyVars = countVars(body);
  const bodyExample = (Array.isArray(t.body_samples) ? t.body_samples : []).map(String);
  if (bodyExample.length < bodyVars) {
    throw new Error(`body has ${bodyVars} variable(s) — provide a sample value for each`);
  }
  const headerVars = header ? countVars(header) : 0;
  const headerExample = (Array.isArray(t.header_samples) ? t.header_samples : []).map(String);
  if (headerVars && headerExample.length < headerVars) {
    throw new Error(`header has ${headerVars} variable(s) — provide a sample value for each`);
  }

  return {
    name,
    language: String(t.language ?? "en").trim() || "en",
    category: metaCategory(String(t.category ?? "utility")),
    header,
    body,
    footer,
    bodyExample: bodyExample.slice(0, bodyVars),
    headerExample: headerExample.slice(0, headerVars),
  };
}

function countVars(s: string): number {
  const m = s.match(/\{\{(\d+)\}\}/g) ?? [];
  return new Set(m.map((x) => x.replace(/[{}]/g, ""))).size;
}

// Local category ('offer' is a CRM-only bucket) → Meta category.
function metaCategory(c: string): MetaCategory {
  const v = c.toLowerCase();
  if (v === "authentication") return "AUTHENTICATION";
  if (v === "utility") return "UTILITY";
  return "MARKETING"; // marketing + offer
}
function localCategory(c: MetaCategory): string {
  return c.toLowerCase();
}
// Meta template status → wa_templates.status check set.
function localStatus(s?: string): string {
  const v = String(s ?? "PENDING").toUpperCase();
  if (v === "APPROVED") return "approved";
  if (v === "REJECTED") return "rejected";
  if (v === "PAUSED" || v === "DISABLED") return "disabled";
  return "pending";
}

// debug_token on the token itself exposes granular_scopes; the WhatsApp scopes
// carry the WABA id(s) in target_ids.
async function discoverWaba(): Promise<string | null> {
  const t = token();
  const res = await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`,
  );
  const json = await res.json().catch(() => ({}));
  const scopes = json?.data?.granular_scopes;
  if (!Array.isArray(scopes)) return null;
  for (const s of scopes) {
    if (typeof s?.scope === "string" && s.scope.includes("whatsapp")) {
      const ids = s?.target_ids;
      if (Array.isArray(ids) && ids.length) return String(ids[0]);
    }
  }
  return null;
}

async function diagnose(): Promise<Record<string, unknown>> {
  const t = token();
  const out: Record<string, unknown> = {};
  try {
    const r = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`,
    );
    out.debug_token = await r.json().catch(() => ({}));
  } catch (e) { out.debug_token_error = String(e); }
  out.discovered_waba = await discoverWaba().catch(() => null);
  return out;
}

// Build the Meta component array for a template def. Shared by create + edit so
// an edit always resends the FULL component set (body + footer + buttons) — Meta
// drops any component you omit on an edit.
function buildComponents(def: TemplateDef): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];

  if (def.header) {
    const h: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: def.header };
    if (countVars(def.header) > 0) h.example = { header_text: def.headerExample ?? [] };
    components.push(h);
  }

  const bodyComp: Record<string, unknown> = { type: "BODY", text: def.body };
  if (countVars(def.body) > 0) bodyComp.example = { body_text: [def.bodyExample] };
  components.push(bodyComp);

  if (def.footer) components.push({ type: "FOOTER", text: def.footer });

  if (def.button) {
    components.push({
      type: "BUTTONS",
      buttons: [{
        type: "URL",
        text: def.button.text,
        url: def.button.url,            // ends with {{1}} — dynamic suffix
        example: [def.button.example],  // one full sample URL
      }],
    });
  }
  return components;
}

async function createTemplate(
  waba: string,
  def: TemplateDef,
): Promise<{ ok: boolean; id?: string; status?: string; error?: string; meta?: unknown }> {
  const components = buildComponents(def);

  const reqBody = {
    name: def.name,
    language: def.language,
    category: def.category,
    components,
  };
  const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    const error = [
      e.message,
      e.error_user_title,
      e.error_user_msg,
      e.error_data?.details,
      e.error_subcode ? `subcode ${e.error_subcode}` : null,
    ].filter(Boolean).join(" | ") || `HTTP ${res.status}`;
    // surface the full Meta error AND the request we sent, for diagnosis
    return { ok: false, error, meta: { status: res.status, error: e, sent: reqBody } };
  }
  return { ok: true, id: json?.id, status: json?.status ?? "PENDING" };
}

// Edit an EXISTING approved template at Meta (POST /{template_id}). Category and
// name can't change on an edit — only components. Meta puts the template back
// into PENDING review; it keeps delivering with the OLD content until approved,
// so an edit never causes a send gap (unlike a delete+recreate).
async function editTemplate(
  templateId: string,
  def: TemplateDef,
): Promise<{ ok: boolean; status?: string; error?: string; meta?: unknown }> {
  const reqBody = { components: buildComponents(def) };
  const res = await fetch(`${GRAPH}/${templateId}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    const error = [
      e.message,
      e.error_user_title,
      e.error_user_msg,
      e.error_data?.details,
      e.error_subcode ? `subcode ${e.error_subcode}` : null,
    ].filter(Boolean).join(" | ") || `HTTP ${res.status}`;
    return { ok: false, error, meta: { status: res.status, error: e, sent: reqBody } };
  }
  return { ok: true, status: "PENDING" };
}

// Pull every template Meta has for this WABA and mirror it into wa_templates.
async function syncFromMeta(
  waba: string,
  sb: ReturnType<typeof db>,
): Promise<Array<{ name: string; status: string }>> {
  const url = `${GRAPH}/${waba}/message_templates` +
    `?fields=name,language,status,category,components,rejected_reason,id` +
    `&limit=200&access_token=${encodeURIComponent(token())}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);

  const list: any[] = Array.isArray(json?.data) ? json.data : [];
  const out: Array<{ name: string; status: string }> = [];

  for (const t of list) {
    const comps: any[] = Array.isArray(t.components) ? t.components : [];
    const find = (type: string) => comps.find((c) => c?.type === type);
    const bodyC = find("BODY");
    const headerC = find("HEADER");
    const footerC = find("FOOTER");
    const buttonsC = find("BUTTONS");

    const status = localStatus(t.status);
    const cat = String(t.category ?? "marketing").toLowerCase();

    await sb.from("wa_templates").upsert({
      name: t.name,
      language: t.language ?? "en",
      category: ["marketing", "utility", "authentication", "offer"].includes(cat) ? cat : "marketing",
      status,
      meta_template_id: t.id ?? null,
      header_type: headerC?.format ?? null,
      header_text: headerC?.format === "TEXT" ? (headerC?.text ?? null) : null,
      body: bodyC?.text ?? "",
      footer: footerC?.text ?? null,
      buttons: buttonsC?.buttons ?? null,
      rejection_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    }, { onConflict: "name,language" });

    out.push({ name: t.name, status });
  }
  return out;
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });
}
