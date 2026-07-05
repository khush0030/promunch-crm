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
import { requireInternal } from "../_shared/require-internal.ts";
import { sendTemplate, TemplateComponent } from "../_shared/whatsapp.ts";
import { appendUtm, mintCode } from "../_shared/links.ts";
import { alertWaSendFailure, postSlack, slackChannelFor } from "../_shared/connector-log.ts";

const THROTTLE_MS = 120;
// Per-invocation caps — kept well under the edge-function wall-clock limit so
// a batch always returns and chains its successor. 300 static sends ≈ 96s of
// throttle + send; 20 personalised sends ≈ 20 Claude calls. The campaign
// self-chains, so a lower cap just means more (safer) hops.
const MAX_STATIC = 50;         // per-invocation cap, static send — kept small so a
                              // batch (~0.8s/send via Meta) finishes well within the
                              // function's wall-clock budget and reliably self-chains.
const MAX_PERSONALIZED = 20;   // per-invocation cap, AI send (a Claude call each)
const STALE_MS = 10 * 60_000;

// Meta's per-user marketing cap (#131049). A contact who fails with this is NOT
// permanently lost — their cap resets, so we retry them on a later day.
const CAP_RE = /healthy ecosystem|131049/i;

// Next daily send slot = next 12:00 IST (06:30 UTC) strictly in the future.
function nextSendSlotISO(): string {
  const IST = 5.5 * 60 * 60 * 1000;
  const now = Date.now();
  const ist = new Date(now + IST);
  let slot = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 12, 0, 0) - IST;
  if (slot <= now) slot = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, 12, 0, 0) - IST;
  return new Date(slot).toISOString();
}
const PERSONALIZE_MODEL = Deno.env.get("WA_PERSONALIZE_MODEL") ?? "gpt-4o-mini";

interface Body { campaign_id?: string; _continue?: boolean }

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
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
  // Authoritative dormancy: a campaign deferred to a future daily wave must NOT
  // send until resume_at passes — for ANY caller (worker, self-chain, a stale
  // pre-deploy cron tick, manual kick). resume_at was previously honoured only
  // by the worker, so a single stray kick would clear it (productive-batch path)
  // and run a full out-of-slot wave into an exhausted cap. Gate it here too so
  // resume_at is the single source of truth everywhere. (At the real slot it has
  // just passed, so > now is false and the wave proceeds normally.)
  if (campaign.resume_at && new Date(campaign.resume_at).getTime() > Date.now()) {
    return j({ ok: true, status: "sending", deferred: true, note: `dormant until ${campaign.resume_at}` });
  }
  if (!campaign.template_id) return j({ error: "campaign has no template" }, 400);

  const { data: tpl } = await sb.from("wa_templates").select("*").eq("id", campaign.template_id).single();
  if (!tpl) return j({ error: "template not found" }, 404);
  if (tpl.status !== "approved") {
    return j({ error: `template '${tpl.name}' is '${tpl.status}' — must be 'approved' by Meta first` }, 400);
  }

  // ---- atomic send lock ----
  // Only ONE sender may run a campaign at a time. A guarded UPDATE: we win the
  // lock only if it's free or stale (TTL). Without this, concurrent invocations
  // (manual resume + self-chain + worker) re-send to the same people — the
  // duplicate incident. Released before chaining the next batch.
  const LOCK_TTL_MS = 100_000;
  const lockCutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const { data: lockRow, error: lockErr } = await sb
    .from("wa_campaigns")
    .update({ send_lock_at: new Date().toISOString() })
    .eq("id", campaignId)
    .or(`send_lock_at.is.null,send_lock_at.lt.${lockCutoff}`)
    .select("id")
    .maybeSingle();
  if (lockErr) {
    return j({ error: "send lock unavailable — run the send_lock migration", detail: lockErr.message }, 500);
  }
  if (!lockRow) {
    // Another sender holds the lock — bail quietly (NOT an error). The holder
    // will finish + chain; the worker re-kicks if it ever dies.
    return j({ ok: true, skipped: "another sender holds the lock for this campaign" });
  }
  const releaseLock = () => sb.from("wa_campaigns").update({ send_lock_at: null }).eq("id", campaignId);

  // Reclaim claims orphaned by a crashed/timed-out prior batch (sender died
  // between the claim insert and its finalize). Anything still 'queued' older
  // than the lock TTL can't be a live in-flight claim, so demote it to 'failed'
  // (which is outside the unique index) → eligible to retry. Without this a
  // crash would permanently block that contact.
  await sb.from("wa_messages").update({ status: "failed", error: "stale claim reclaimed" })
    .eq("campaign_id", campaignId).eq("status", "queued")
    .lt("created_at", new Date(Date.now() - 5 * 60_000).toISOString());

  // ---- audience ----
  let q = sb.from("wa_contacts").select("id, wa_id, name, email, tags").eq("opted_in", true);
  const tags: string[] = Array.isArray(campaign.audience_filter?.tags) ? campaign.audience_filter.tags : [];
  if (tags.length) q = q.overlaps("tags", tags);
  const { data: contacts, error: cErr } = await q;
  if (cErr) return j({ error: cErr.message }, 500);
  if (!contacts || contacts.length === 0) {
    await sb.from("wa_campaigns").update({
      status: "completed", completed_at: new Date().toISOString(), last_error: "no opted-in recipients matched",
      send_lock_at: null,
    }).eq("id", campaignId);
    return j({ ok: true, sent: 0, failed: 0, remaining: 0, status: "completed", note: "no recipients" });
  }

  // Classify the ledger so multi-day cap-aware sending works:
  //   reached       = got a sent/delivered/read row (NEVER message again)
  //   permanentFail = failed for a non-cap reason (not on WhatsApp, etc.) — give up
  //   triedToday    = any attempt since 00:00 IST (so we attempt each contact at
  //                   most once per day; cap-failed ones become eligible again
  //                   tomorrow, never re-sent to the reached)
  // Page through the FULL ledger. PostgREST caps a single response at 1000 rows;
  // a campaign with >1000 message rows was silently deduped against only the
  // first 1000, so everyone past that window was re-sent every batch (the 195-
  // duplicate Edamame incident). Paginate so the reached/triedToday sets are
  // complete. (The DB unique index is the hard guarantee; this keeps the
  // wave/completion logic correct so a campaign actually finishes.)
  const done: { contact_id: string | null; status: string; error: string | null; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await sb.from("wa_messages")
      .select("contact_id,status,error,created_at").eq("campaign_id", campaignId)
      .range(from, from + 999);
    if (!page || page.length === 0) break;
    done.push(...(page as typeof done));
    if (page.length < 1000) break;
  }
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_MS);
  const todayStartUTC = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - IST_MS;
  const reached = new Set<string>(), permanentFail = new Set<string>(), triedToday = new Set<string>();
  for (const r of (done ?? []) as { contact_id: string | null; status: string; error: string | null; created_at: string }[]) {
    if (!r.contact_id) continue;
    if (["sent", "delivered", "read"].includes(r.status)) reached.add(r.contact_id);
    else if (r.status === "failed" && !CAP_RE.test(r.error ?? "")) permanentFail.add(r.contact_id);
    if (new Date(r.created_at).getTime() >= todayStartUTC) triedToday.add(r.contact_id);
  }

  // Never market to a customer with a LIVE support ticket. Blasting "leave a
  // review" / "restock now" at someone mid-complaint reads as tone-deaf. They
  // re-enter automatically once the ticket is resolved.
  const { data: ticketed } = await sb.from("wa_threads")
    .select("contact_id")
    .in("ticket_status", ["open", "pending"])
    .not("contact_id", "is", null);
  const blockedSet = new Set((ticketed ?? []).map((t) => t.contact_id));

  const baseVars: Record<string, string> = campaign.template_vars ?? {};
  const aiBrief = typeof baseVars._ai_brief === "string" ? baseVars._ai_brief.trim() : "";
  const personalized = aiBrief.length > 0;
  const cap = personalized ? MAX_PERSONALIZED : MAX_STATIC;

  // everyone still owed a message (not reached, not permanently failed, not in a ticket)
  const trulyRemaining = contacts.filter((c) => !reached.has(c.id) && !permanentFail.has(c.id) && !blockedSet.has(c.id));
  if (trulyRemaining.length === 0) {
    await sb.from("wa_campaigns").update({
      status: "completed", completed_at: new Date().toISOString(), send_lock_at: null, resume_at: null,
    }).eq("id", campaignId);
    fireReport(campaignId);
    return j({ ok: true, status: "completed", reached: reached.size, note: "all eligible contacts reached or permanently failed" });
  }
  // today's wave already attempted everyone left → wait for tomorrow's reset
  const eligibleToday = trulyRemaining.filter((c) => !triedToday.has(c.id));
  if (eligibleToday.length === 0) {
    await sb.from("wa_campaigns").update({
      status: "sending", send_lock_at: null, resume_at: nextSendSlotISO(),
    }).eq("id", campaignId);
    return j({ ok: true, status: "sending", deferred: true, remaining: trulyRemaining.length, note: "daily cap reached — resuming next day" });
  }
  const ticketSkipped = contacts.filter((c) => !reached.has(c.id) && !permanentFail.has(c.id) && blockedSet.has(c.id)).length;
  const queue = eligibleToday.slice(0, cap);

  await sb.from("wa_campaigns").update({
    status: "sending",
    started_at: campaign.started_at ?? new Date().toISOString(),
    last_error: null,
  }).eq("id", campaignId);

  const varKeys = extractVarKeys(tpl.body ?? "");
  const openai = personalized ? new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! }) : null;

  let sent = 0, failed = 0, capFails = 0, skipped = 0;
  let firstError: string | null = null;
  for (const c of queue) {
    let contactVars = baseVars;
    if (personalized && openai && varKeys.length) {
      const ai = await personalizeVars(openai, tpl.body ?? "", aiBrief, c, varKeys).catch(() => null);
      if (ai) contactVars = { ...baseVars, ...ai };
    }
    // Any link riding in a body variable gets utm_source=whatsapp + this
    // campaign's name, so Shopify attributes the resulting order to it.
    contactVars = Object.fromEntries(
      Object.entries(contactVars).map(([k, v]) => [
        k,
        typeof v === "string" ? appendUtm(v, { medium: "campaign", campaign: campaign.name }) : v,
      ]),
    ) as Record<string, string>;

    // ---- CLAIM BEFORE SEND (the hard no-duplicate guarantee) ----
    // Insert a 'queued' row FIRST. The partial unique index
    // wa_messages_campaign_recipient_uniq on (campaign_id, contact_id) WHERE
    // status IN (queued,sent,delivered,read) makes a second row impossible — so
    // if this contact was already messaged (or is being messaged by a racing
    // sender) the insert fails and we SKIP, never calling Meta twice. This holds
    // regardless of query caps, lock TTLs, concurrent schedulers, or future code
    // bugs: correctness lives in the database, not in this loop. 'failed' rows
    // are outside the index so a cap-deferred contact is still retried tomorrow.
    const { data: thread } = await sb.from("wa_threads")
      .upsert({ contact_id: c.id, wa_id: c.wa_id }, { onConflict: "contact_id" })
      .select("id").single();
    const { data: claim, error: claimErr } = await sb.from("wa_messages").insert({
      thread_id: thread?.id ?? null,
      contact_id: c.id,
      campaign_id: campaignId,
      direction: "outbound",
      type: "template",
      status: "queued",
      template_name: tpl.name,
      template_lang: tpl.language,
      sent_by: personalized ? "campaign-ai" : "campaign",
    }).select("id").maybeSingle();
    if (claimErr || !claim) { skipped++; continue; } // lost the claim → already handled, do NOT send

    const components = buildComponents(tpl, contactVars, c.name);
    // Per-recipient click tracking: if the template has a dynamic URL button
    // (base SITE_URL/r/, needs Meta approval) and the campaign carries a
    // destination in _track_url, append a tracked code so clicks are
    // attributable to this campaign + contact. Inert (no-op) otherwise.
    const trackUrl = typeof contactVars._track_url === "string" ? contactVars._track_url
      : (typeof baseVars._track_url === "string" ? baseVars._track_url : null);
    const btn = await buildTrackedButton(sb, tpl, trackUrl, { contact_id: c.id, campaign_id: campaignId });
    if (btn) components.push(btn);
    let res;
    try {
      res = await sendTemplate(c.wa_id, tpl.name, tpl.language, components);
    } catch (e) {
      res = { ok: false, message_id: null as string | null, raw: null, error: String(e), error_code: undefined as number | undefined, error_detail: undefined as string | undefined };
    }

    // Finalize the claimed row IN PLACE (update, never a second insert).
    await sb.from("wa_messages").update({
      body: `[campaign:${campaign.name}]`,
      template_vars: contactVars,
      wa_message_id: res.message_id,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : res.error,
    }).eq("id", claim.id);

    // NOTE: we deliberately do NOT bump the thread's last_outbound_at or
    // last_message_snippet here. A marketing broadcast is not a support
    // conversation — bumping these would shove every recipient to the top of the
    // human support inbox (which sorts by last_activity_at = greatest(inbound,
    // outbound)) and bury real queries. Campaign performance lives in the
    // Analytics tab + the per-campaign Recipients view, not the chat inbox. The
    // send is still fully recorded in wa_messages (campaign_id set); if the
    // customer REPLIES, their inbound bumps the thread and it surfaces normally.

    if (!res.ok) {
      if (CAP_RE.test(res.error ?? "")) capFails++;
      if (!firstError) firstError = res.error ?? "unknown";
      // Per-recipient alert (throttled to one Slack ping per error-code per 5 min,
      // so a wholesale-failing blast pings once — not once per recipient).
      await alertWaSendFailure({
        to: c.wa_id,
        kind: "template",
        templateName: tpl.name,
        error: res.error,
        errorCode: (res as { error_code?: number }).error_code,
        errorDetail: (res as { error_detail?: string }).error_detail,
        sentBy: personalized ? "campaign-ai" : "campaign",
      }).catch(() => {});
    }

    res.ok ? sent++ : failed++;
    if (THROTTLE_MS) await sleep(THROTTLE_MS);
  }

  await sb.rpc("wa_campaign_recount", { p_campaign: campaignId });

  // Release the lock now that this batch's rows are committed. The next batch
  // (chain) or the worker will re-claim it cleanly. Done before any return below
  // so the lock is never left held.
  await releaseLock();

  const realFails = failed - capFails;

  // Structural-failure circuit breaker: nothing delivered and the failures are
  // NOT the marketing cap — a bad template / params / token. Halt loudly so a
  // launch blast can never fail silently.
  if (sent === 0 && realFails > 0) {
    await sb.from("wa_campaigns").update({
      status: "failed",
      last_error: `Halted: ${failed}/${queue.length} sends failed, 0 delivered. First error: ${firstError ?? "unknown"}`,
    }).eq("id", campaignId);
    await postSlack(
      slackChannelFor("whatsapp"),
      `🚨 *Campaign halted — wholesale send failure*\n` +
      `*Campaign:* ${campaign.name}\n` +
      `*Result:* 0 delivered, ${failed} failed in this batch (campaign paused before blasting the rest).\n` +
      `*Meta said:* ${firstError ?? "unknown"}\n` +
      `Fix the template/params, then re-run. Nobody else was messaged.`,
    ).catch(() => {});
    fireReport(campaignId);
    return j({ ok: false, sent, failed, processed: queue.length, status: "failed", error: firstError });
  }

  // Whole batch hit the per-user marketing cap (#131049) → today's daily limit
  // is exhausted. Defer the rest to the next daily wave (no re-sends; the capped
  // contacts retry tomorrow because they're not marked reached).
  if (sent === 0 && capFails > 0) {
    await sb.from("wa_campaigns").update({ status: "sending", resume_at: nextSendSlotISO() }).eq("id", campaignId);
    return j({ ok: true, status: "sending", deferred: true, sent, failed, note: "daily marketing cap reached — resuming next day" });
  }

  // Productive batch → chain. The next invocation re-classifies the ledger and
  // will COMPLETE (everyone reached), DEFER (only cap-failed remain today), or
  // CONTINUE (more eligible today). resume_at cleared = wave active.
  await sb.from("wa_campaigns").update({ resume_at: null }).eq("id", campaignId);
  const chain = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ campaign_id: campaignId, _continue: true }),
  }).catch(() => {});
  try { (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(chain); } catch { /* not on edge runtime */ }

  return j({ ok: true, sent, failed, claim_skipped: skipped, processed: queue.length, personalized, ticket_skipped: ticketSkipped, status: "sending" });
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

// Build the template's components: a media header (when the template was created
// with an IMAGE/VIDEO/DOCUMENT header) plus the body from numbered variables.
// Meta error #132012 ("Parameter format does not match") fires when we OMIT the
// header component for a media-header template — so it must always be sent.
// A value containing the {name} token is personalised with the contact's name.
// Build a tracked dynamic-URL button component for one recipient. Returns null
// unless the template has a URL button whose stored URL is dynamic (contains a
// {{n}} placeholder or our /r/ base) AND a track destination is given.
async function buildTrackedButton(
  sb: ReturnType<typeof db>,
  tpl: { buttons?: unknown },
  trackUrl: string | null,
  meta: { contact_id: string; campaign_id: string },
): Promise<TemplateComponent | null> {
  if (!trackUrl) return null;
  const buttons = Array.isArray(tpl.buttons) ? (tpl.buttons as { type?: string; url?: string }[]) : [];
  const idx = buttons.findIndex(
    (b) => (b.type ?? "").toUpperCase() === "URL" && typeof b.url === "string" && (b.url.includes("/r/") || b.url.includes("{{")),
  );
  if (idx < 0) return null;
  const c = await mintCode(sb, trackUrl, meta);
  if (!c) return null;
  return { type: "button", sub_type: "url", index: String(idx), parameters: [{ type: "text", text: c }] } as unknown as TemplateComponent;
}

function buildComponents(
  tpl: { header_type?: string | null; header_media_url?: string | null },
  vars: Record<string, string>,
  contactName?: string | null,
): TemplateComponent[] {
  const comps: TemplateComponent[] = [];

  // Media header — required whenever the template carries one, even with no body vars.
  const ht = (tpl.header_type ?? "").toUpperCase();
  const link = tpl.header_media_url ?? null;
  if (link && ht === "IMAGE") {
    comps.push({ type: "header", parameters: [{ type: "image", image: { link } }] });
  } else if (link && ht === "VIDEO") {
    comps.push({ type: "header", parameters: [{ type: "video", video: { link } }] });
  } else if (link && ht === "DOCUMENT") {
    comps.push({ type: "header", parameters: [{ type: "document", document: { link } }] });
  }

  // Body — only when the template has numbered {{n}} placeholders.
  const keys = Object.keys(vars).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  if (keys.length > 0) {
    const name = (contactName ?? "").trim() || "there";
    comps.push({
      type: "body",
      parameters: keys.map((k) => ({ type: "text", text: String(vars[k] ?? "").replace(/\{name\}/gi, name) })),
    });
  }

  return comps;
}

// Fire-and-forget: post the analytics report to Slack the moment the campaign
// finishes. wa-jobs-tick fires the settled follow-up ~15 min later.
function fireReport(campaignId: string, settled = false) {
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-report`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ campaign_id: campaignId, settled }),
  }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
