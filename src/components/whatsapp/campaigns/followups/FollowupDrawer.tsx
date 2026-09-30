"use client";

// Side drawer to add a follow-up to a campaign (running, finished or still a
// draft), or to change one nobody has got yet. Same sentence builder, blanks,
// picture and test send as the wizard.

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Callout } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import type { Campaign, FollowupStage } from "../../types";
import { api, errorMessage, useApprovedTemplates, useFollowupPreview, useInvalidateCampaigns, useJourney, type FollowupRule } from "../api";
import {
  draftFromCampaign,
  draftFromSuggestion,
  draftHours,
  followupName,
  sameJourneyMessage,
  followupProblems,
  followupTemplates,
  type FollowupDraft,
} from "../journey";
import { buildTemplateVars, fmtInt } from "../logic";
import { FollowupEditor } from "./FollowupEditor";
import s from "../campaigns.module.css";

type ButtonLike = { type?: string | null; url?: string | null };

export type DrawerTarget =
  | { mode: "add"; parent: Pick<Campaign, "id" | "name" | "status" | "sent_count"> & { template?: { buttons?: ButtonLike[] | null } | null }; siblings: number; stage?: FollowupStage }
  | {
      mode: "edit";
      step: Pick<Campaign, "id" | "name" | "status" | "followup_of" | "followup_after_hours" | "followup_stage" | "template_id" | "template_vars" | "header_media_url">;
      parentTpl: { buttons?: ButtonLike[] | null } | null | undefined;
      parentSent: number;
    };

export function FollowupDrawer({ target, onClose }: { target: DrawerTarget; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateCampaigns();
  const templatesQ = useApprovedTemplates();
  const templates = useMemo(() => followupTemplates(templatesQ.data ?? []), [templatesQ.data]);
  const [draft, setDraft] = useState<FollowupDraft>(() =>
    target.mode === "edit" ? draftFromCampaign(target.step) : draftFromSuggestion({ stage: target.stage ?? "not_read", hours: 48 }),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const parentId = target.mode === "add" ? target.parent.id : target.step.followup_of ?? "";
  const parentTpl = target.mode === "add" ? target.parent.template : target.parentTpl;
  const parentSent = target.mode === "add" ? target.parent.sent_count ?? 0 : target.parentSent;
  const tpl = templates.find((t) => t.id === draft.templateId) ?? null;
  const problems = followupProblems(draft, tpl, parentTpl);
  // Exact copy of a message already in this journey? The server refuses it,
  // so say so straight away.
  const journey = useJourney(parentId || null);
  const selfId = target.mode === "edit" ? target.step.id : null;
  const msg = { template_id: tpl?.id ?? null, template_vars: buildTemplateVars(draft.vars, false, "", tpl), header_media_url: draft.mediaUrl };
  const copyOf = tpl
    ? (journey.data?.steps ?? []).find((st) => st.id !== selfId && st.status !== "cancelled" && sameJourneyMessage(msg, st, tpl.header_media_url))
    : null;
  const warning = copyOf
    ? `This is exactly the same as "${copyOf.name}" in this journey. Change the picture or the text, or pick another message.`
    : null;
  const name = target.mode === "add" ? followupName(target.parent.name, target.siblings + 1) : target.step.name;

  // Live count once the first message has reached people.
  const hours = draftHours(draft);
  const [rule, setRule] = useState<FollowupRule | null>(null);
  useEffect(() => {
    if (!parentId || parentSent === 0 || hours == null) {
      setRule(null);
      return;
    }
    const t = setTimeout(() => setRule({ followup_of: parentId, followup_after_hours: hours, followup_stage: draft.stage }), 400);
    return () => clearTimeout(t);
  }, [parentId, parentSent, hours, draft.stage]);
  const preview = useFollowupPreview(rule);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  async function save() {
    if (problems.length || warning) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      const body = {
        template_id: draft.templateId!,
        template_vars: buildTemplateVars(draft.vars, false, "", tpl),
        header_media_url: draft.mediaUrl,
        followup_after_hours: hours!,
        followup_stage: draft.stage,
      };
      if (target.mode === "add") {
        await api.create({ ...body, name, followup_of: target.parent.id });
        toast.push({
          kind: "success",
          text:
            target.parent.status === "draft"
              ? "Follow-up added. It turns on by itself when the campaign is launched."
              : "Follow-up added. It sends by itself as each person reaches their time.",
        });
      } else {
        await api.patch(target.step.id, body);
        toast.push({ kind: "success", text: "Follow-up saved." });
      }
      await invalidate(target.mode === "add" ? target.parent.id : target.step.id);
      onClose();
    } catch (e) {
      toast.push({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const counts = preview.data?.counts;
  return (
    <div className={s.drawerBack} onClick={() => !busy && onClose()}>
      <div
        className={s.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fu-drawer-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className={s.drawerHead}>
          <div style={{ minWidth: 0 }}>
            <h2 id="fu-drawer-title" className={s.drawerTitle}>
              {target.mode === "add" ? "Add a follow-up" : "Change this follow-up"}
            </h2>
            <div className={s.help}>
              {target.mode === "add" ? <>After &quot;{target.parent.name}&quot;. Saved as &quot;{name}&quot;.</> : name}
            </div>
          </div>
          <button ref={closeRef} type="button" className="pm2-btn sm ghost" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className={s.drawerBody}>
          <p className={s.help} style={{ margin: 0 }}>
            The wait counts from when each person got the first message. It still follows the usual rules: at most 1 marketing message a
            day per person, nothing at night, and never the same follow-up twice.
          </p>
          {templatesQ.isError && <Callout tone="crit" title="Couldn't load your messages" body={errorMessage(templatesQ.error)} />}
          {templatesQ.isLoading ? (
            <div className="pm2-skel" />
          ) : (
            <FollowupEditor
              draft={draft}
              onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
              templates={templates}
              parentTpl={parentTpl}
              problems={problems}
              showErrors={showErrors}
              testName={name}
              warning={warning}
            />
          )}
          {parentSent > 0 && rule && (
            <div className={s.help} role="status">
              {preview.isLoading
                ? "Counting who fits…"
                : preview.isError
                  ? `Couldn't count who fits right now (${errorMessage(preview.error)}). You can still save it.`
                  : counts
                    ? (
                      <>
                        Right now <b>{fmtInt(counts.eligible_total)}</b> {counts.eligible_total === 1 ? "person fits" : "people fit"}
                        {counts.waiting_for_time ? <>, and <b>{fmtInt(counts.waiting_for_time)}</b> more are waiting for their time</> : null}.
                      </>
                    )
                    : null}
            </div>
          )}
          {parentSent === 0 && (
            <div className={s.help}>Nobody has got the first message yet, so there is nobody to count. People start to fit once it goes out.</div>
          )}
          {target.mode === "edit" && target.step.status === "scheduled" && (
            <div className={s.help}>It is on and waiting. Nobody has got it yet, so your changes apply to everyone.</div>
          )}
        </div>

        <div className={s.drawerFoot}>
          <button type="button" className="pm2-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="pm2-btn pri" onClick={save} disabled={busy || templatesQ.isLoading}>
            {busy ? "Saving…" : target.mode === "add" ? "Add follow-up" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
