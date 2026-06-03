// Outbound WhatsApp send. Called by Next.js API route from dashboard.
//
// POST body:
//   { thread_id?: string, to?: string, kind: 'text'|'template'|'image',
//     text?: string,
//     template?: { name, language, components },
//     image?: { link, caption } }
//
// Auth: requires service-role bearer (since verify_jwt = false, also accept SETUP_TOKEN
// or just trust it for now — tighten later).

import { db } from "../_shared/supabase.ts";
import { sendText, sendTemplate, sendImage, TemplateComponent } from "../_shared/whatsapp.ts";
import { alertWaSendFailure } from "../_shared/connector-log.ts";

interface SendBody {
  thread_id?: string;
  to?: string;
  kind: "text" | "template" | "image";
  text?: string;
  template?: { name: string; language?: string; components?: TemplateComponent[]; vars?: Record<string, string> };
  image?: { link: string; caption?: string };
  sent_by?: string;
  ai_generated?: boolean;
  ai_meta?: unknown;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let body: SendBody;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const sb = db();

  // resolve thread + contact
  let threadId = body.thread_id ?? null;
  let waId: string | null = null;
  let contactId: string | null = null;

  if (threadId) {
    const { data: t } = await sb.from("wa_threads").select("id, wa_id, contact_id").eq("id", threadId).single();
    if (!t) return j({ error: "thread not found" }, 404);
    waId = t.wa_id; contactId = t.contact_id;
  } else if (body.to) {
    waId = body.to.replace(/^\+/, "").replace(/\D/g, "");
    const phone = "+" + waId;
    const { data: c } = await sb
      .from("wa_contacts")
      .upsert({ wa_id: waId, phone }, { onConflict: "wa_id" })
      .select("id").single();
    if (!c) return j({ error: "contact upsert failed" }, 500);
    contactId = c.id;
    const { data: th } = await sb
      .from("wa_threads")
      .upsert({ contact_id: contactId, wa_id: waId }, { onConflict: "contact_id" })
      .select("id").single();
    if (!th) return j({ error: "thread upsert failed" }, 500);
    threadId = th.id;
  } else {
    return j({ error: "thread_id or to required" }, 400);
  }

  // dispatch to Meta
  let result;
  let recorded: Record<string, unknown> = {
    thread_id: threadId,
    contact_id: contactId,
    direction: "outbound",
    sent_by: body.sent_by ?? "dashboard",
    ai_meta: body.ai_meta ?? null,
  };

  try {
    if (body.kind === "text") {
      if (!body.text) return j({ error: "text required" }, 400);
      result = await sendText(waId!, body.text);
      recorded = { ...recorded, type: "text", body: body.text };
    } else if (body.kind === "template") {
      if (!body.template?.name) return j({ error: "template.name required" }, 400);
      const lang = body.template.language ?? "en";
      const comps = body.template.components ?? buildSimpleBodyComponents(body.template.vars);
      result = await sendTemplate(waId!, body.template.name, lang, comps);
      // Store what the customer actually received — not a "[template:name]" stub.
      const rendered = await renderTemplate(sb, body.template.name, lang, body.template.vars, comps);
      recorded = {
        ...recorded,
        type: "template",
        template_name: body.template.name,
        template_lang: lang,
        template_vars: body.template.vars ?? null,
        body: rendered ?? `[template:${body.template.name}]`,
      };
    } else if (body.kind === "image") {
      if (!body.image?.link) return j({ error: "image.link required" }, 400);
      result = await sendImage(waId!, body.image.link, body.image.caption);
      recorded = { ...recorded, type: "image", media_url: body.image.link, body: body.image.caption ?? "[image]" };
    } else {
      return j({ error: "bad kind" }, 400);
    }
  } catch (e) {
    return j({ error: String(e) }, 500);
  }

  recorded.wa_message_id = result.message_id;
  recorded.status = result.ok ? "sent" : "failed";
  recorded.error = result.ok ? null : result.error;

  await sb.from("wa_messages").insert(recorded);
  if (result.ok) {
    await sb.from("wa_threads").update({
      last_outbound_at: new Date().toISOString(),
      last_message_snippet: String(recorded.body ?? "").slice(0, 240),
    }).eq("id", threadId);
  } else {
    // Every failed send alerts Slack with the Meta reason — no silent failures.
    await alertWaSendFailure({
      to: waId!,
      kind: body.kind,
      templateName: body.template?.name ?? null,
      error: result.error,
      errorCode: result.error_code,
      errorDetail: result.error_detail,
      sentBy: typeof recorded.sent_by === "string" ? recorded.sent_by : undefined,
    }).catch(() => {});
  }

  return j({ ok: result.ok, message_id: result.message_id, error: result.error ?? null });
});

// Render a template's text with its variables filled in, so wa_messages.body
// holds the message the customer actually received. Reads the local
// wa_templates registry (kept in sync with Meta by wa-template-create).
async function renderTemplate(
  sb: ReturnType<typeof db>,
  name: string,
  language: string,
  vars?: Record<string, string>,
  components?: TemplateComponent[],
): Promise<string | null> {
  const { data } = await sb
    .from("wa_templates")
    .select("body, header_text, footer")
    .eq("name", name)
    .eq("language", language)
    .maybeSingle();
  if (!data?.body) return null;
  // Component-based sends (e.g. the abandoned-cart journey) carry their body
  // values in the BODY component's parameters rather than as flat vars.
  const merged: Record<string, string> = { ...(vars ?? {}) };
  if (!vars || Object.keys(vars).length === 0) {
    const bodyComp = (components ?? []).find((c) => c.type === "body");
    (bodyComp?.parameters ?? []).forEach((p: any, i) => {
      if (p?.type === "text" && typeof p.text === "string") merged[String(i + 1)] = p.text;
    });
  }
  const fill = (s: string) => s.replace(/\{\{(\d+)\}\}/g, (_, n) => merged[n] ?? `{{${n}}}`);
  return [
    data.header_text ? fill(data.header_text) : null,
    fill(data.body),
    data.footer ? fill(data.footer) : null,
  ].filter(Boolean).join("\n\n");
}

function buildSimpleBodyComponents(vars?: Record<string, string>): TemplateComponent[] {
  if (!vars || Object.keys(vars).length === 0) return [];
  const sorted = Object.entries(vars).sort(([a], [b]) => Number(a) - Number(b));
  return [{ type: "body", parameters: sorted.map(([_, v]) => ({ type: "text", text: v })) }];
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
