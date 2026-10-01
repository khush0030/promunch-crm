import type { Issue } from "@/lib/whatsapp/template-rules";
import type { EditorDraft } from "@/lib/whatsapp/template-draft";

/** What every creator step gets from the shell. */
export type StepProps = {
  d: EditorDraft;
  update: (patch: Partial<EditorDraft>) => void;
  /** Errors / warnings for one field, already filtered to "touched or Next was pressed". */
  errorsFor: (field: string) => Issue[];
  warningsFor: (field: string) => Issue[];
  touch: (field: string) => void;
};

/** Which fields each step owns (prefix match, like issuesFor). */
export const STEP_FIELDS: Record<number, string[]> = {
  1: ["name", "language", "category", "body", "body_samples"],
  2: ["header", "header_samples", "footer", "buttons"],
};

export function stepOfField(field: string): number {
  for (const [step, fields] of Object.entries(STEP_FIELDS)) {
    if (fields.some((f) => field === f || field.startsWith(f + "."))) return Number(step);
  }
  return 1;
}
