// Variable substitution for saved B2B email templates. Templates are written
// by the user with {tokens}; sends render them per lead/contact. Unknown
// tokens are left visible on purpose so a typo is caught in preview, not
// silently mailed as an empty hole.

export interface TemplateVars {
  name?: string | null; // recipient person/team name (from contact role_hint or lead)
  company: string;
  city?: string | null;
  category?: string | null;
}

export const TEMPLATE_VARIABLES = ['{name}', '{company}', '{city}', '{category}'] as const as string[];

export function renderTemplate(text: string, vars: TemplateVars): string {
  const values: Record<string, string> = {
    name: vars.name?.trim() || 'there',
    company: vars.company,
    city: vars.city?.trim() || '',
    category: vars.category?.trim() || '',
  };
  const out = text.replace(/\{(name|company|city|category)\}/g, (_, key: string) => values[key]);
  // An empty optional var leaves a doubled space ("in  for") — collapse it.
  return out.replace(/ {2,}/g, ' ').replace(/ +([,.!?])/g, '$1').trim();
}
