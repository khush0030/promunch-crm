// Create WhatsApp message templates at Meta.
//
// The wa_templates table is only a LOCAL registry — marking a row
// status='approved' there does nothing. A template must also exist and be
// approved inside the WhatsApp Business Account, or wa-send gets Meta error
// 132001 ("Template name does not exist in the translation").
//
// This function pushes the journey template set to Meta via the Graph API
// and mirrors Meta's real status back into wa_templates.
//
// POST { names?: string[] }  — omit `names` to create every defined template.
// Auth: verify_jwt = true; invoke with `supabase functions invoke` (CLI
// attaches a valid Supabase JWT automatically). One-shot admin tool.

import { db } from "../_shared/supabase.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

function token(): string {
  const t = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!t) throw new Error("Missing WHATSAPP_ACCESS_TOKEN");
  return t;
}

interface TemplateDef {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  body: string;        // positional {{1}} {{2}} … — must match the codebase's vars
  example: string[];   // one sample value per variable, in order
  footer?: string;
}

// Variable contracts mirror what shopify-wa / wa-journey-tick actually send.
//   order_confirmation : 1=name 2=orderRef 3=total
//   shipping_update    : 1=name 2=orderRef 3=tracking
//   abandoned_checkout : 1=name 2=coupon   3=cartUrl
//   review_request     : 1=name 2=reviewUrl
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
    example: ["Aarav", "#PM1042", "₹598"],
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
    example: ["Aarav", "#PM1042", "https://track.promunch.in/PM1042"],
    footer: "PROMUNCH — snack smart",
  },
  {
    name: "abandoned_checkout",
    language: "en",
    category: "MARKETING",
    body:
      "Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒\n\n" +
      "Here's {{2}} to finish your order before they're gone:\n{{3}}\n\n" +
      "Tap the link above to complete your order.",
    example: ["Aarav", "10% off (SNACK10)", "https://promunch.in/cart"],
    footer: "Reply STOP to opt out",
  },
  {
    name: "review_request",
    language: "en",
    category: "MARKETING",
    body:
      "Hi {{1}}, hope you're loving your PROMUNCH snacks! 💚\n\n" +
      "Mind leaving a quick review? It really helps us:\n{{2}}\n\n" +
      "Thanks a ton — Team PROMUNCH!",
    example: ["Aarav", "https://promunch.in/reviews"],
    footer: "Reply STOP to opt out",
  },
  {
    name: "replenishment_reminder",
    language: "en",
    category: "MARKETING",
    body:
      "Running low, {{1}}? 🥜\n\n" +
      "Restock your PROMUNCH favourites in a tap:\n{{2}}\n\n" +
      "Happy munching!",
    example: ["Aarav", "https://promunch.in"],
    footer: "Reply STOP to opt out",
  },
];

Deno.serve(async (req) => {
  // GET ?debug=1 — dump what we can see, to diagnose WABA discovery.
  if (req.method === "GET" && new URL(req.url).searchParams.get("debug")) {
    return j(await diagnose());
  }
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  let names: string[] | undefined;
  let bodyWaba: string | undefined;
  try {
    const b = await req.json().catch(() => ({}));
    if (Array.isArray(b?.names) && b.names.length) names = b.names;
    if (typeof b?.waba === "string" && b.waba.trim()) bodyWaba = b.waba.trim();
  } catch { /* no body — create all */ }

  const defs = names
    ? TEMPLATES.filter((t) => names!.includes(t.name))
    : TEMPLATES;
  if (defs.length === 0) return j({ error: "no matching template names" }, 400);

  // Resolve the WhatsApp Business Account id: explicit body > secret > discovery.
  let waba = bodyWaba ?? Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID") ?? null;
  if (!waba) {
    waba = await discoverWaba().catch(() => null);
  }
  if (!waba) {
    return j({
      error:
        "Could not resolve WhatsApp Business Account id. Set WHATSAPP_BUSINESS_ACCOUNT_ID " +
        "secret, or ensure the access token has whatsapp_business_management permission.",
    }, 400);
  }

  const sb = db();
  const results: Array<Record<string, unknown>> = [];

  for (const def of defs) {
    const created = await createTemplate(waba, def);
    results.push({ name: def.name, ...created });

    // Mirror Meta's real status into the local registry.
    if (created.ok) {
      const status = String(created.status ?? "PENDING").toLowerCase();
      await sb.from("wa_templates").upsert({
        name: def.name,
        language: def.language,
        category: def.category.toLowerCase(),
        status,                       // 'pending' until Meta reviews it
        body: def.body,
        footer: def.footer ?? null,
        variables: def.example.map((_, i) => String(i + 1)),
      }, { onConflict: "name,language" });
    }
  }

  return j({ ok: results.every((r) => r.ok), waba, results });
});

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

// Dump everything we can see, so WABA discovery can be diagnosed.
async function diagnose(): Promise<Record<string, unknown>> {
  const t = token();
  const out: Record<string, unknown> = {};

  // debug_token — granular_scopes carry the WABA id in target_ids.
  try {
    const r = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`,
    );
    out.debug_token = await r.json().catch(() => ({}));
  } catch (e) { out.debug_token_error = String(e); }

  // The phone number node — its parent WABA may be exposed here.
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (phoneId) {
    try {
      const r = await fetch(
        `${GRAPH}/${phoneId}?fields=id,display_phone_number,verified_name,whatsapp_business_account` +
        `&access_token=${encodeURIComponent(t)}`,
      );
      out.phone_number = await r.json().catch(() => ({}));
    } catch (e) { out.phone_number_error = String(e); }
  }

  out.discovered_waba = await discoverWaba().catch(() => null);
  return out;
}

async function createTemplate(
  waba: string,
  def: TemplateDef,
): Promise<{ ok: boolean; id?: string; status?: string; error?: string; meta?: unknown }> {
  const components: Array<Record<string, unknown>> = [
    {
      type: "BODY",
      text: def.body,
      example: { body_text: [def.example] },
    },
  ];
  if (def.footer) components.push({ type: "FOOTER", text: def.footer });

  const reqBody = {
    name: def.name,
    language: def.language,
    category: def.category,
    components,
  };
  const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
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

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });
}
