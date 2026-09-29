// "Is this campaign ready to go?" in one place, shared by the Review step
// (GET .../send) and the Send action (POST .../send), so what the employee
// sees is exactly what the server enforces.

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { contentHash, parseDesign, productIds, type ProductInfo } from "@/lib/email-studio/design";
import { checkEmail, type Issue } from "@/lib/email-studio/checks";
import { describeRules } from "@/lib/email-studio/segments";
import { resolveAudience } from "@/lib/email-studio/audience-server";
import { getStudioSettings, productMap } from "@/lib/email-studio/server";
import { campaignRules, sendBlocker } from "@/lib/email/campaign-send";

export type Readiness = {
  campaign: Record<string, unknown>;
  issues: Issue[];
  recipients: number;
  audienceSummary: string;
  testIsCurrent: boolean;
  needsApproval: boolean;
  /** Hard stop even for an admin (warm-up cap exceeded, rejected, etc.). */
  capBlocker: string | null;
  warmupMax: number | null;
  approvalThreshold: number;
};

export async function campaignReadiness(id: string): Promise<Readiness | null> {
  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  const design = parseDesign(c.design);
  const [settings, rules] = await Promise.all([getStudioSettings(), campaignRules(c)]);
  const [audience, products] = await Promise.all([
    resolveAudience(rules),
    design ? productMap(productIds(design)) : Promise.resolve({} as Record<string, ProductInfo>),
  ]);
  const known = new Set(Object.values(products).filter((p) => p.inStock).map((p) => p.id));

  const issues: Issue[] = design
    ? checkEmail({ subject: c.subject ?? "", previewText: c.preview_text ?? "", design, knownProducts: known })
    : [{ level: "block", message: "This campaign has no builder design." }];
  if (audience.length === 0) issues.push({ level: "block", message: "Nobody subscribed matches this audience." });

  const testIsCurrent = !!c.test_sent_hash && c.test_sent_hash === contentHash(c.subject ?? "", c.preview_text ?? "", c.design);
  const needsApproval =
    c.approval_status !== "approved" &&
    (settings.warmup_max_recipients != null || audience.length > settings.approval_threshold);

  // Blocker as if approved: what an approval can't fix.
  const capBlocker = sendBlocker({ ...c, approval_status: c.approval_status === "rejected" ? "rejected" : "approved" }, audience.length, settings);

  return {
    campaign: c,
    issues,
    recipients: audience.length,
    audienceSummary: c.segment_id ? `Saved audience: ${describeRules(rules)}` : describeRules(rules),
    testIsCurrent,
    needsApproval,
    capBlocker,
    warmupMax: settings.warmup_max_recipients,
    approvalThreshold: settings.approval_threshold,
  };
}
