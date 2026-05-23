// Bulk WhatsApp marketing broadcast — static or AI-personalised.
//
// POST { campaign_id, _continue? }  (service-role bearer)
//   - Resolves the audience: opted-in wa_contacts, optional tag filter.
//   - Sends the campaign's APPROVED template to each recipient.
//   - Static mode: the same template_vars for everyone.
//   - AI mode (template_vars._ai_brief set): Claude fills the template
//     variables per recipient from the brief + that contact's profile.
//   - Records one wa_messages row per recipient (campaign_id-linked).
//   - Resumable + self-chaining: a batch that leaves recipients re-invokes
//     itself with _continue:true until the whole campaign is sent.

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { sendTemplate, TemplateComponent } from "../_shared/whatsapp.ts";

const THROTTLE_MS = 120;
// Per-invocation caps — kept well under the edge-function wall-clock limit so
// a batch always returns and chains its successor. 300 static sends ≈ 96s of
// throttle + send; 20 personalised sends ≈ 20 Claude calls. The campaign
// self-chains, so a lower cap just means more (safer) hops.
const MAX_STATIC = 300;        // per-invocation cap, static send
const MAX_PERSONALIZED = 20;   // per-invocation cap, AI send (a Claude call each)
const STALE_MS = 10 * 60_000;
const PERSONALIZE_MODEL = Deno.env.get("WA_PERSONALIZE_MODEL") ?? "gpt-4o-mini";

interface Body { campaign_id?: string; _continue?: boolean }

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "method" }, 405);

  const body = (await req.json().catch(() => ({}))) as Body;
  const campaignId = body.campaign_id;
  if (!campaignId) return j({ error: "campaign_id required" }, 400);

  const sb = db();
  const { data: campaign } = await sb.from("wa_campaigns").select("*").eq("id", campaignId).single();
  if (!campaign) return j({ error: "campaign not found" }, 404);
  if (campaign.status === "completed") return j({ error: "campaign already completed" }, 409);
  if (campaign.status === "cancelled") return j({ error: "campaign is cancelled" }, 409);
  if (campaign.status === "sending" && !body._continue) {
    const age = Date.now() - new Date(campaign.started_at ?? 0).getTime();
    if (age < STALE_MS) return j({ error: "campaign send already in progress" }, 409);
  }
  if (!campaign.template_id) return j({ error: "campaign has no template" }, 400);

  const { data: tpl } = await sb.from("wa_templates").select("*").eq("id", campaign.template_id).single();
  if (!tpl) return j({ error: "template not found" }, 404);
  if (tpl.status !== "approved") {
    return j({ error: `template '${tpl.name}' is '${tpl.status}' — must be 'approved' by Meta first` }, 400);
  }

  // ---- audience ----
  let q = sb.from("wa_contacts").select("id, wa_id, name, email, tags").eq("opted_in", true);
  const tags: string[] = Array.isArray(campaign.audience_filter?.tags) ? campaign.audience_filter.tags : [];
  if (tags.length) q = q.overlaps("tags", tags);
  const { data: contacts, error: cErr } = await q;
  if (cErr) return j({ error: cErr.message }, 500);
  if (!contacts || contacts.length === 0) {
    await sb.from("wa_campaigns").update({
      status: "completed", completed_at: new Date().toISOString(), last_error: "no opted-in recipients matched",
    }).eq("id", campaignId);
    return j({ ok: true, sent: 0, failed: 0, remaining: 0, status: "completed", note: "no recipients" });
  }

  // resumable: skip recipients already messaged for this campaign
  const { data: done } = await sb.from("wa_messages").select("contact_id").eq("campaign_id", campaignId);
  const doneSet = new Set((done ?? []).map((d) => d.contact_id));

  const baseVars: Record<string, string> = campaign.template_vars ?? {};
  const aiBrief = typeof baseVars._ai_brief === "string" ? baseVars._ai_brief.trim() : "";
  const personalized = aiBrief.length > 0;
  const cap = personalized ? MAX_PERSONALIZED : MAX_STATIC;
  const queue = contacts.filter((c) => !doneSet.has(c.id)).slice(0, cap);

  await sb.from("wa_campaigns").update({
    status: "sending",
    started_at: campaign.started_at ?? new Date().toISOString(),
    last_error: null,
  }).eq("id", campaignId);

  const varKeys = extractVarKeys(tpl.body ?? "");
  const openai = personalized ? new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! }) : null;

  let sent = 0, failed = 0;
  for (const c of queue) {
    let contactVars = baseVars;
    if (personalized && openai && varKeys.length) {
      const ai = await personalizeVars(openai, tpl.body ?? "", aiBrief, c, varKeys).catch(() => null);
      if (ai) contactVars = { ...baseVars, ...ai };
    }

    const components = buildComponents(contactVars, c.name);
    let res;
    try {
      res = await sendTemplate(c.wa_id, tpl.name, tpl.language, components);
    } catch (e) {
      res = { ok: false, message_id: null as string | null, raw: null, error: String(e) };
    }

    const { data: thread } = await sb.from("wa_threads")
      .upsert({ contact_id: c.id, wa_id: c.wa_id }, { onConflict: "contact_id" })
      .select("id").single();

    await sb.from("wa_messages").insert({
      thread_id: thread?.id ?? null,
      contact_id: c.id,
      campaign_id: campaignId,
      direction: "outbound",
      type: "template",
      body: `[campaign:${campaign.name}]`,
      template_name: tpl.name,
      template_lang: tpl.language,
      template_vars: contactVars,
      wa_message_id: res.message_id,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : res.error,
      sent_by: personalized ? "campaign-ai" : "campaign",
    });

    if (res.ok && thread?.id) {
      await sb.from("wa_threads").update({
        last_outbound_at: new Date().toISOString(),
        last_message_snippet: `📣 ${campaign.name}`,
      }).eq("id", thread.id);
    }

    res.ok ? sent++ : failed++;
    if (THROTTLE_MS) await sleep(THROTTLE_MS);
  }

  await sb.rpc("wa_campaign_recount", { p_campaign: campaignId });

  const remaining = contacts.length - doneSet.size - queue.length;
  if (remaining > 0) {
    // chain the next batch automatically — no await
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ campaign_id: campaignId, _continue: true }),
    }).catch(() => {});
  } else {
    await sb.from("wa_campaigns").update({
      status: "completed", completed_at: new Date().toISOString(),
    }).eq("id", campaignId);
  }

  return j({
    ok: true, sent, failed, processed: queue.length, remaining, personalized,
    status: remaining > 0 ? "sending" : "completed",
  });
});

function extractVarKeys(body: string): string[] {
  const m = body.match(/\{\{(\d+)\}\}/g) ?? [];
  return Array.from(new Set(m.map((s) => s.replace(/[^\d]/g, "")))).sort((a, b) => Number(a) - Number(b));
}

// Ask Claude for this contact's template variable values.
async function personalizeVars(
  client: OpenAI,
  templateBody: string,
  brief: string,
  contact: { name?: string | null; email?: string | null; tags?: string[] | null },
  varKeys: string[],
): Promise<Record<string, string> | null> {
  const system =
    "You write WhatsApp marketing template variable values for PROMUNCH (snack brand — protein munchies, edamame). " +
    "Given a template and one customer, output ONLY a JSON object mapping each numbered variable to a short, natural " +
    "value tailored to that customer. Values are template variables, not paragraphs — keep them short. " +
    "India-English, warm. Never include {{ }} braces in the values.";
  const user = [
    `TEMPLATE BODY:\n${templateBody}`,
    `\nCAMPAIGN BRIEF:\n${brief}`,
    `\nCUSTOMER:\nname: ${contact.name ?? "(unknown)"}\ntags: ${(contact.tags ?? []).join(", ") || "(none)"}\nemail: ${contact.email ?? "(none)"}`,
    `\nReturn JSON only — keys ${varKeys.map((k) => `"${k}"`).join(", ")}. Example: {"1":"...","2":"..."}`,
  ].join("\n");
  const resp = await client.chat.completions.create({
    model: PERSONALIZE_MODEL,
    max_tokens: 300,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const txt = resp.choices[0]?.message?.content ?? "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    const out: Record<string, string> = {};
    for (const k of varKeys) if (obj[k] != null) out[k] = String(obj[k]);
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

// Build the template body component from numbered variables.
// A value containing the {name} token is personalised with the contact's name.
function buildComponents(vars: Record<string, string>, contactName?: string | null): TemplateComponent[] {
  const keys = Object.keys(vars).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) return [];
  const name = (contactName ?? "").trim() || "there";
  return [{
    type: "body",
    parameters: keys.map((k) => ({ type: "text", text: String(vars[k] ?? "").replace(/\{name\}/gi, name) })),
  }];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
