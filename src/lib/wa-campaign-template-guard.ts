import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAutomationTemplate, templateKind } from "@/lib/whatsapp/templateKind";

/**
 * A campaign may only broadcast an approved-for-marketing template that is not
 * tied to one automation. Returns a plain-English reason, or null when fine.
 * Mirrors the wizard's gallery filter so an API caller cannot bypass it.
 */
export async function campaignTemplateError(templateId: string | null | undefined): Promise<string | null> {
  if (!templateId) return null;
  const { data: tpl } = await supabaseAdmin
    .from("wa_templates")
    .select("name,category")
    .eq("id", templateId)
    .maybeSingle();
  if (!tpl) return "That template no longer exists. Pick another one.";
  if (templateKind(tpl) !== "marketing") {
    return "That message is for order updates or team alerts, so it can't be sent as a campaign. Pick a marketing template.";
  }
  if (isAutomationTemplate(tpl.name)) {
    return "That message is written for an automation (like a cart reminder), so it can't be sent to a whole group. Pick or create a campaign template.";
  }
  return null;
}
