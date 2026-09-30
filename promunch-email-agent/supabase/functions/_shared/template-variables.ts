// wa_templates.variables: one entry per body blank, in order,
//   [{ name: "1", sample: "Aarav", label?: "First name" }, ...]
// `sample` is what Meta approved as the example value. `label` is the name the
// marketer gave the blank in the dashboard creator ("Offer details"). Meta
// never sees labels, so every writer that rebuilds `variables` from Meta data
// (create, edit, sync) must carry them over or the UI falls back to guessing.
// Pure, no Deno APIs: shared by wa-template-create and its tests.

export type TemplateVariable = { name: string; sample: string; label?: string };

/** Longest label we keep (a UI hint only). Mirrors MAX_BLANK_LABEL in the app. */
export const MAX_VARIABLE_LABEL = 60;

function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, MAX_VARIABLE_LABEL);
  return s || undefined;
}

/**
 * Labels sent by the dashboard: an array aligned to the blanks ({{1}} first,
 * "" = none) or a { "1": "First name" } map. Anything else = no labels.
 */
export function incomingLabels(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    raw.forEach((v, i) => {
      const l = clean(v);
      if (l) out[String(i + 1)] = l;
    });
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const l = clean(v);
      if (l && /^\d+$/.test(k)) out[k] = l;
    }
  }
  return out;
}

/** Labels already stored on a row's `variables` (rows without labels -> {}). */
export function storedLabels(variables: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(variables)) return out;
  for (const v of variables) {
    if (!v || typeof v !== "object") continue;
    const name = (v as { name?: unknown }).name;
    const l = clean((v as { label?: unknown }).label);
    if (name != null && l) out[String(name)] = l;
  }
  return out;
}

/**
 * Build `variables` from Meta-side samples (one per blank, in order). Each
 * blank takes its label from `labels` first, then `fallback` (the row's
 * existing labels, merged by blank number). Blanks with neither get no label
 * key at all, so the stored shape stays identical for unlabelled templates.
 */
export function buildVariables(
  samples: readonly unknown[],
  labels: Record<string, string> = {},
  fallback: Record<string, string> = {},
): TemplateVariable[] {
  return samples.map((sample, i) => {
    const name = String(i + 1);
    const label = labels[name] ?? fallback[name];
    return label ? { name, sample: String(sample ?? ""), label } : { name, sample: String(sample ?? "") };
  });
}
