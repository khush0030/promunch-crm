"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/pm/ConfirmDialog";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import type { TemplateProblem } from "@/lib/whatsapp/template-errors";
import { deleteTemplate, type TemplateRow } from "./api";
import { ProblemBox } from "./bits";

/** Delete confirm. At Meta: explains the ~30 day name lock and points to Edit & resubmit. */
export function DeleteTemplateDialog({
  t,
  onClose,
  onDeleted,
}: {
  t: TemplateRow;
  onClose: () => void;
  onDeleted: (t: TemplateRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<TemplateProblem | null>(null);
  const friendly = friendlyTemplateName(t.name);

  async function confirm() {
    setBusy(true);
    setProblem(null);
    const r = await deleteTemplate(t.id);
    setBusy(false);
    if (!r.ok) { setProblem(r.problem); return; }
    onDeleted(t);
  }

  return (
    <ConfirmDialog
      title={`Delete "${friendly}"?`}
      danger
      busy={busy}
      confirmLabel={t.meta_template_id ? "Delete at Meta and here" : "Delete draft"}
      onClose={() => { if (!busy) onClose(); }}
      onConfirm={confirm}
      body={
        <div>
          {t.meta_template_id ? (
            <>
              <p style={{ margin: "0 0 8px" }}>This deletes the template at Meta as well as here. Campaigns can no longer send it.</p>
              <p style={{ margin: "0 0 8px" }}>
                Meta does not let you reuse the name <strong>{t.name}</strong> for about 30 days. To change a template, Edit &amp; resubmit is usually better.
              </p>
            </>
          ) : (
            <p style={{ margin: "0 0 8px" }}>This draft was never sent to Meta, so it is only removed from this list.</p>
          )}
          {problem && <ProblemBox problem={problem} />}
        </div>
      }
    />
  );
}
