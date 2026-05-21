// Bulk WhatsApp marketing broadcast.
//
// POST { campaign_id }  (service-role bearer)
//   - Resolves the campaign audience: opted-in wa_contacts, optional tag filter.
//   - Sends the campaign's APPROVED template to each recipient.
//   - Records one wa_messages row per recipient, linked via campaign_id.
//   - Recomputes campaign counters via the wa_campaign_recount() RPC.
//
// Resumable: recipients already messaged for this campaign are skipped, so a
// re-invocation continues a partial run. MAX_PER_RUN caps a single invocation
// so it never approaches the function wall-clock limit.

import { db } from "../_shared/supabase.ts";
import { sendTemplate, TemplateComponent } from "../_shared/whatsapp.ts";

const THROTTLE_MS = 120;          // ~8 msg/s — safely under Meta's throughput cap
const MAX_PER_RUN = 800;          // per-invocation safety cap (~96s at THROTTLE_MS)
const STALE_MS = 5 * 60_000;      // a 'sending' campaign older than this is resumable

interface Body { campaign_id?: string }

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "method" }, 405);

  const { campaign_id } = (await req.json().catch(() => ({}))) as Body;
  if (!campaign_id) return j({ error: "campaign_id required" }, 400);

  const sb = db();

  const { data: campaign } = await sb.from("wa_campaigns").select("*").eq("id", campaign_id).single();
  if (!campaign) return j({ error: "campaign not found" }, 404);
  if (campaign.status === "completed") return j({ error: "campaign already completed" }, 409);
  if (campaign.status === "cancelled") return j({ error: "campaign is cancelled" }, 409);
  if (campaign.status === "sending") {
    const age = Date.now() - new Date(campaign.started_at ?? 0).getTime();
    if (age < STALE_MS) return j({ error: "campaign send already in progress" }, 409);
    // otherwise: a stalled run — fall through and resume it
  }
  if (!campaign.template_id) return j({ error: "campaign has no template" }, 400);

  const { data: tpl } = await sb.from("wa_templates").select("*").eq("id", campaign.template_id).single();
  if (!tpl) return j({ error: "template not found" }, 404);
  if (tpl.status !== "approved") {
    return j({ error: `template '${tpl.name}' is '${tpl.status}' — it must be 'approved' by Meta first` }, 400);
  }

  // ---- resolve audience: opted-in contacts, optional tag overlap ----
  let q = sb.from("wa_contacts").select("id, wa_id, name").eq("opted_in", true);
  const tags: string[] = Array.isArray(campaign.audience_filter?.tags) ? campaign.audience_filter.tags : [];
  if (tags.length) q = q.overlaps("tags", tags);
  const { data: contacts, error: cErr } = await q;
  if (cErr) return j({ error: cErr.message }, 500);

  if (!contacts || contacts.length === 0) {
    await sb.from("wa_campaigns").update({
      status: "completed", completed_at: new Date().toISOString(), last_error: "no opted-in recipients matched",
    }).eq("id", campaign_id);
    return j({ ok: true, sent: 0, failed: 0, remaining: 0, status: "completed", note: "no recipients" });
  }

  // resumable: skip contacts already messaged for this campaign
  const { data: done } = await sb.from("wa_messages").select("contact_id").eq("campaign_id", campaign_id);
  const doneSet = new Set((done ?? []).map((d) => d.contact_id));
  const queue = contacts.filter((c) => !doneSet.has(c.id)).slice(0, MAX_PER_RUN);

  await sb.from("wa_campaigns").update({
    status: "sending",
    started_at: campaign.started_at ?? new Date().toISOString(),
    last_error: null,
  }).eq("id", campaign_id);

  const vars: Record<string, string> = campaign.template_vars ?? {};
  let sent = 0, failed = 0;

  for (const c of queue) {
    const components = buildComponents(vars, c.name);
    let res;
    try {
      res = await sendTemplate(c.wa_id, tpl.name, tpl.language, components);
    } catch (e) {
      res = { ok: false, message_id: null as string | null, raw: null, error: String(e) };
    }

    // every contact needs a thread to anchor the message in the inbox
    const { data: thread } = await sb.from("wa_threads")
      .upsert({ contact_id: c.id, wa_id: c.wa_id }, { onConflict: "contact_id" })
      .select("id").single();

    await sb.from("wa_messages").insert({
      thread_id: thread?.id ?? null,
      contact_id: c.id,
      campaign_id: campaign_id,
      direction: "outbound",
      type: "template",
      body: `[campaign:${campaign.name}]`,
      template_name: tpl.name,
      template_lang: tpl.language,
      template_vars: vars,
      wa_message_id: res.message_id,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : res.error,
      sent_by: "campaign",
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

  // recompute counters from the source of truth
  await sb.rpc("wa_campaign_recount", { p_campaign: campaign_id });

  const remaining = contacts.length - doneSet.size - queue.length;
  const status = remaining > 0 ? "sending" : "completed";
  await sb.from("wa_campaigns").update({
    status,
    completed_at: remaining > 0 ? null : new Date().toISOString(),
  }).eq("id", campaign_id);

  return j({ ok: true, sent, failed, processed: queue.length, remaining, status });
});

// Build the template's body component from numbered variables.
// A variable value containing the {name} token is personalised per contact.
function buildComponents(vars: Record<string, string>, contactName?: string | null): TemplateComponent[] {
  const keys = Object.keys(vars).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) return [];
  const name = (contactName ?? "").trim() || "there";
  return [{
    type: "body",
    parameters: keys.map((k) => ({
      type: "text",
      text: String(vars[k] ?? "").replace(/\{name\}/gi, name),
    })),
  }];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
