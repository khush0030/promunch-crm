"use client";

// Pause / resume / cancel / delete / duplicate / edit for one campaign, with
// in-app confirm dialogs (never window.confirm) and plain-English results.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Pause, Pencil, Play, Trash2, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import type { Campaign } from "../types";
import { api, errorMessage, useInvalidateCampaigns } from "./api";
import { allowedActions, fmtInt, type CampaignAction } from "./logic";

type Pending = { action: "pause" | "cancel" | "delete"; campaign: Campaign } | null;

export const campaignHref = (id: string) => `/dashboard/whatsapp/campaigns/${id}`;
export const editHref = (id: string) => `/dashboard/whatsapp/campaigns/${id}/edit`;
export const duplicateHref = (id: string) => `/dashboard/whatsapp/campaigns/new?from=${id}`;

export function useCampaignActions(opts: { afterDelete?: () => void; followupCount?: (c: Campaign) => number } = {}) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateCampaigns();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function exec(action: "pause" | "resume" | "cancel" | "delete", c: Campaign) {
    setBusy(c.id);
    try {
      if (action === "delete") {
        await api.remove(c.id);
        toast.push({ kind: "success", text: `Deleted "${c.name}".` });
        opts.afterDelete?.();
      } else {
        await api.action(c.id, action);
        const text =
          action === "pause" ? `Paused "${c.name}". Nobody new gets it until you resume.`
          : action === "resume" ? `Resumed "${c.name}". It picks up where it stopped.`
          : `Cancelled "${c.name}". Nobody else will get it.`;
        toast.push({ kind: "success", text });
      }
      setPending(null);
      await invalidate(c.id);
    } catch (e) {
      toast.push({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  function run(action: CampaignAction, c: Campaign) {
    switch (action) {
      case "open":
        return router.push(campaignHref(c.id));
      case "edit":
        // Follow-ups are changed from the Journey card on their page.
        return router.push(c.followup_of ? `${campaignHref(c.id)}#journey` : editHref(c.id));
      case "duplicate":
        return router.push(duplicateHref(c.id));
      case "resume":
        return exec("resume", c);
      default:
        setPending({ action, campaign: c });
    }
  }

  let dialog: ReactNode = null;
  if (pending) {
    const c = pending.campaign;
    const reached = c.sent_count ?? 0;
    const kids = opts.followupCount?.(c) ?? 0;
    const alsoKids = kids > 0 ? ` This also cancels its ${kids === 1 ? "follow-up" : `${kids} follow-ups`}.` : "";
    const what = c.followup_of ? "follow-up" : "campaign";
    const copy = {
      pause: {
        title: `Pause "${c.name}"?`,
        body: `Nobody new gets it while it's paused. ${reached ? `${fmtInt(reached)} people already got it and won't get it again.` : ""} You can resume any time.`,
        confirm: `Pause ${what}`,
        danger: false,
      },
      cancel: {
        title: `Cancel "${c.name}"?`,
        body: `It stops for good. ${reached ? `${fmtInt(reached)} people already got it; everyone else won't.` : "Nobody has got it yet."}${alsoKids} This can't be undone${c.followup_of ? "" : ", but you can duplicate it later"}.`,
        confirm: `Cancel ${what}`,
        danger: true,
      },
      delete: {
        title: `Delete "${c.name}"?`,
        body: "It's removed from the list. Only possible because nobody has got it yet.",
        confirm: "Delete",
        danger: true,
      },
    }[pending.action];
    dialog = (
      <ConfirmDialog
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirm}
        keepLabel="Keep it"
        danger={copy.danger}
        busy={busy === c.id}
        onClose={() => setPending(null)}
        onConfirm={() => exec(pending.action, c)}
      />
    );
  }

  return { run, dialog, busy };
}

const ICON: Record<CampaignAction, ReactNode> = {
  open: <ExternalLink size={14} aria-hidden />,
  edit: <Pencil size={14} aria-hidden />,
  duplicate: <Copy size={14} aria-hidden />,
  pause: <Pause size={14} aria-hidden />,
  resume: <Play size={14} aria-hidden />,
  cancel: <XCircle size={14} aria-hidden />,
  delete: <Trash2 size={14} aria-hidden />,
};
const LABEL: Record<CampaignAction, string> = {
  open: "Open", edit: "Edit", duplicate: "Duplicate", pause: "Pause", resume: "Resume", cancel: "Cancel", delete: "Delete",
};

export function ActionButtons({
  campaign,
  run,
  busy,
  hide = [],
  compact = false,
}: {
  campaign: Campaign;
  run: (a: CampaignAction, c: Campaign) => void;
  busy: string | null;
  hide?: CampaignAction[];
  compact?: boolean;
}) {
  const actions = allowedActions(campaign).filter((a) => !hide.includes(a));
  return (
    <>
      {actions.map((a) => {
        // Duplicate stays labelled (it's the easy way to send something similar).
        const iconOnly = compact && a === "delete";
        return (
          <button
            key={a}
            type="button"
            className={`pm2-btn sm${a === "open" || a === "resume" ? " pri" : ""}`}
            disabled={busy === campaign.id}
            onClick={() => run(a, campaign)}
            aria-label={`${LABEL[a]} ${campaign.name}`}
            title={iconOnly ? LABEL[a] : undefined}
            // Destructive buttons stay neutral on the page (one red element per
            // screen); their confirm dialog carries the danger styling.
          >
            {ICON[a]}
            {!iconOnly && LABEL[a]}
          </button>
        );
      })}
    </>
  );
}
