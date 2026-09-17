// Actions on a Brevo campaign (email or SMS). Server-only. Routes pass an
// already-authorised actor; this module enforces the send guard and the
// one-send claim.

import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { brevo, brevoGet, listAll, BrevoError } from "@/lib/brevo";
import { getBrevoSettings } from "@/lib/brevo-settings";
import { evaluateSendGuard } from "@/lib/brevo-send-guard";
import { recordAudit } from "@/lib/audit";
import { SECRETS_OWNER } from "@/lib/secrets";

export type Channel = "email" | "sms";

export const ACTIONS = [
  "test",
  "send_now",
  "schedule",
  "suspend",
  "archive",
  "unarchive",
  "replicate",
  "export_recipients",
  "send_report",
  "release_claim",
] as const;
export type CampaignAction = (typeof ACTIONS)[number];

// Actions that can put a campaign in front of customers or undo a lock: owner only.
export const OWNER_ACTIONS = new Set<CampaignAction>(["send_now", "schedule", "release_claim"]);

const base = (channel: Channel) => (channel === "email" ? "/emailCampaigns" : "/smsCampaigns");

type RawCampaign = {
  id: number;
  name: string;
  status: string;
  modifiedAt?: string;
  scheduledAt?: string;
  recipients?: { lists?: number[]; listIds?: number[]; exclusionLists?: number[]; exclusionListIds?: number[]; segments?: number[]; segmentIds?: number[] };
};

export class ActionError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: string[],
  ) {
    super(message);
  }
}

async function loadCampaign(channel: Channel, id: number): Promise<RawCampaign> {
  const q = channel === "email" ? "?statistics=globalStats" : "";
  return brevoGet<RawCampaign>(`${base(channel)}/${id}${q}`);
}

const recipientsOf = (c: RawCampaign) => ({
  listIds: c.recipients?.lists ?? c.recipients?.listIds ?? [],
  exclusionListIds: c.recipients?.exclusionLists ?? c.recipients?.exclusionListIds ?? [],
  segmentIds: c.recipients?.segments ?? c.recipients?.segmentIds ?? [],
});

export type PreflightResult = {
  ok: boolean;
  errors: string[];
  recipientCount: number;
  lists: { id: number; name: string; size: number }[];
  syncTarget: "test" | "live";
  tested: boolean;
  claim: { action: string; result: string; claimed_by: string; claimed_at: string; error: string | null } | null;
};

/** The same checks send runs, for the confirm dialog. `confirmCount` null = just asking for the count. */
export async function preflight(channel: Channel, id: number, action: "send_now" | "schedule", confirmCount: number | null, scheduledAt: string | null): Promise<PreflightResult & { campaign: RawCampaign }> {
  const [campaign, settings, lists, tests, claim] = await Promise.all([
    loadCampaign(channel, id),
    getBrevoSettings(),
    listAll<{ id: number; name: string; uniqueSubscribers: number }>("/contacts/lists", "lists", 50),
    supabaseAdmin.from("brevo_campaign_tests").select("campaign_modified_at").eq("channel", channel).eq("campaign_id", id),
    supabaseAdmin.from("brevo_campaign_sends").select("action, result, claimed_by, claimed_at, error").eq("channel", channel).eq("campaign_id", id).maybeSingle(),
  ]);
  if (!settings.migrated || tests.error) throw new ActionError(409, "Brevo tables missing: apply migration 20260917100000_brevo_integration.sql");
  const r = recipientsOf(campaign);
  const sizes = new Map(lists.map((l) => [l.id, l.uniqueSubscribers]));
  const testedVersions = (tests.data ?? []).map((t) => t.campaign_modified_at as string);
  const guard = evaluateSendGuard({
    channel,
    action,
    status: campaign.status,
    modifiedAt: campaign.modifiedAt ?? null,
    testedVersions,
    listIds: r.listIds,
    exclusionListIds: r.exclusionListIds,
    segmentIds: r.segmentIds,
    listSizes: sizes,
    syncTarget: settings.sync_target,
    testListId: settings.test_list_id,
    confirmCount,
    scheduledAt,
    now: new Date(),
    smsEnabled: settings.sms_enabled,
    existingClaim: Boolean(claim.data),
  });
  return {
    campaign,
    ok: guard.ok,
    // Without a confirmation yet, the count mismatch is expected: don't show it as an error.
    errors: guard.ok ? [] : guard.errors.filter((e) => confirmCount != null || !e.startsWith("Confirm the recipient count")),
    recipientCount: guard.recipientCount,
    lists: r.listIds.map((lid) => ({ id: lid, name: lists.find((l) => l.id === lid)?.name ?? `List #${lid}`, size: sizes.get(lid) ?? 0 })),
    syncTarget: settings.sync_target,
    tested: Boolean(campaign.modifiedAt && testedVersions.includes(campaign.modifiedAt)),
    claim: (claim.data as PreflightResult["claim"]) ?? null,
  };
}

type ActionInput = {
  channel: Channel;
  id: number;
  action: CampaignAction;
  actor: User;
  confirmCount?: number | null;
  scheduledAt?: string | null;
  recipientsType?: string;
  reportTo?: string[];
  phoneNumber?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPORT_TYPES: Record<Channel, string[]> = {
  email: ["all", "nonClickers", "nonOpeners", "clickers", "openers", "softBounces", "hardBounces", "unsubscribed"],
  sms: ["all", "delivered", "answered", "softBounces", "hardBounces", "unsubscribed"],
};

export async function runCampaignAction(input: ActionInput): Promise<Record<string, unknown>> {
  const { channel, id, action, actor } = input;
  if (OWNER_ACTIONS.has(action) && (actor.email ?? "").toLowerCase() !== SECRETS_OWNER) {
    throw new ActionError(403, `Only ${SECRETS_OWNER} can send, schedule or unlock campaigns.`);
  }
  const path = `${base(channel)}/${id}`;
  const audit = (summary: string, metadata?: Record<string, unknown>) =>
    recordAudit({ action: `brevo.${channel}_campaign_${action}`, entityType: `brevo_${channel}_campaign`, entityId: String(id), summary, metadata, actor });

  switch (action) {
    case "test": {
      const [campaign, settings] = await Promise.all([loadCampaign(channel, id), getBrevoSettings()]);
      if (!settings.migrated) throw new ActionError(409, "Brevo tables missing: apply migration 20260917100000_brevo_integration.sql");
      let recipients: string[];
      if (channel === "email") {
        recipients = settings.test_emails;
        try {
          await brevo("POST", `${path}/sendTest`, { emailTo: recipients });
        } catch (e) {
          if (e instanceof BrevoError && /contact|exist|test list/i.test(e.message)) {
            throw new ActionError(422, `Brevo refused the test: ${e.message}. Run a test sync (Audience tab) so the test addresses exist in Brevo.`);
          }
          throw e;
        }
      } else {
        const phone = (input.phoneNumber ?? "").replace(/\D/g, "");
        if (!/^91\d{10}$/.test(phone)) throw new ActionError(400, "Give a test mobile number as 91XXXXXXXXXX.");
        recipients = [phone];
        await brevo("POST", `${path}/sendTest`, { phoneNumber: phone });
      }
      const { error } = await supabaseAdmin.from("brevo_campaign_tests").insert({
        channel,
        campaign_id: id,
        campaign_modified_at: campaign.modifiedAt ?? "",
        recipients,
        sent_by: actor.email ?? "unknown",
      });
      if (error) throw new ActionError(500, `Test sent, but recording it failed: ${error.message}`);
      await audit(`test to ${recipients.join(", ")}`);
      return { ok: true, sentTo: recipients };
    }

    case "send_now":
    case "schedule": {
      const scheduledAt = action === "schedule" ? input.scheduledAt ?? null : null;
      const pf = await preflight(channel, id, action, input.confirmCount ?? null, scheduledAt);
      if (!pf.ok) throw new ActionError(422, "Not sent", pf.errors);

      // The claim: primary key (channel, campaign_id). A double click or a
      // second tab loses here, before Brevo is ever called.
      const { error: claimErr } = await supabaseAdmin.from("brevo_campaign_sends").insert({
        channel,
        campaign_id: id,
        action,
        scheduled_at: scheduledAt,
        recipient_count: pf.recipientCount,
        claimed_by: actor.email ?? "unknown",
      });
      if (claimErr) {
        if (claimErr.code === "23505") throw new ActionError(409, "Already sent or scheduled from the dashboard.");
        throw new ActionError(500, `Could not take the send lock: ${claimErr.message}`);
      }

      try {
        if (action === "send_now") await brevo("POST", `${path}/sendNow`);
        else await brevo("PUT", path, { scheduledAt: new Date(scheduledAt!).toISOString() });
      } catch (e) {
        const definite = e instanceof BrevoError && e.status >= 400 && e.status < 500;
        if (definite) {
          // Brevo refused outright: nothing went out, so free the lock for a retry.
          await supabaseAdmin.from("brevo_campaign_sends").delete().eq("channel", channel).eq("campaign_id", id);
          throw new ActionError(422, `Brevo refused: ${(e as Error).message}`);
        }
        // Timeout / 5xx: it may have gone out. Keep the lock; the owner
        // checks Brevo and releases it only if the campaign is still a draft.
        await supabaseAdmin
          .from("brevo_campaign_sends")
          .update({ result: "failed", error: e instanceof Error ? e.message : String(e) })
          .eq("channel", channel)
          .eq("campaign_id", id);
        throw new ActionError(502, "Brevo didn't confirm. The campaign may or may not be sending: check it in Brevo before trying again. The send lock stays on.");
      }

      await supabaseAdmin.from("brevo_campaign_sends").update({ result: "ok" }).eq("channel", channel).eq("campaign_id", id);
      await audit(action === "send_now" ? `sent to up to ${pf.recipientCount}` : `scheduled for ${scheduledAt} to up to ${pf.recipientCount}`, {
        lists: pf.lists,
        syncTarget: pf.syncTarget,
      });
      return { ok: true, recipientCount: pf.recipientCount, scheduledAt };
    }

    case "suspend": {
      await brevo("PUT", `${path}/status`, { status: "suspended" });
      // A suspended schedule never went out: drop its schedule lock so it can be rescheduled.
      await supabaseAdmin.from("brevo_campaign_sends").delete().eq("channel", channel).eq("campaign_id", id).eq("action", "schedule");
      await audit("suspended");
      return { ok: true };
    }

    case "archive":
    case "unarchive": {
      await brevo("PUT", `${path}/status`, { status: action === "archive" ? "archive" : "darchive" });
      await audit(action);
      return { ok: true };
    }

    case "replicate": {
      if (channel === "sms") throw new ActionError(400, "Brevo can't duplicate SMS campaigns.");
      await brevo("PUT", `${path}/status`, { status: "replicate" });
      await audit("duplicated");
      return { ok: true };
    }

    case "export_recipients": {
      const type = input.recipientsType ?? "all";
      if (!EXPORT_TYPES[channel].includes(type)) throw new ActionError(400, `recipientsType must be one of ${EXPORT_TYPES[channel].join(", ")}`);
      const r = await brevo<{ processId: number }>("POST", `${path}/exportRecipients`, { recipientsType: type });
      await audit(`export ${type}`, { processId: r.processId });
      return { ok: true, processId: r.processId };
    }

    case "send_report": {
      const to = [...new Set((input.reportTo ?? []).map((e) => e.trim().toLowerCase()))];
      if (to.length === 0 || to.length > 10 || to.some((e) => !EMAIL_RE.test(e))) throw new ActionError(400, "Give 1 to 10 email addresses for the report.");
      await brevo("POST", `${path}/sendReport`, { language: "en", email: { to, body: "PROMUNCH campaign report from the CRM." } });
      await audit(`report to ${to.join(", ")}`);
      return { ok: true };
    }

    case "release_claim": {
      const campaign = await loadCampaign(channel, id);
      if (!["draft", "suspended"].includes(campaign.status)) {
        throw new ActionError(409, `Brevo says this campaign is "${campaign.status}", so it did go out (or is going). The lock stays.`);
      }
      await supabaseAdmin.from("brevo_campaign_sends").delete().eq("channel", channel).eq("campaign_id", id);
      await audit(`send lock released (Brevo status ${campaign.status})`);
      return { ok: true };
    }
  }
}
