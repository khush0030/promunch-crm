import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";
import { describeFlowRules, type FlowStats } from "@/lib/email-studio/automations";

// Automations list for Email Studio: every flow with its steps, audience rules
// in plain words, and delivery stats from the enrolment + send ledgers.
export const dynamic = "force-dynamic";

async function count(table: string, filter: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { count: n } = await filter(supabase.from(table).select("id", { count: "exact", head: true }));
  return n ?? 0;
}

export async function GET() {
  const me = await caller();
  if (isResponse(me)) return me;

  const { data: flows, error } = await supabase
    .from("flows")
    .select("id, name, description, trigger_type, trigger_config, status, steps, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) return bad(error.message, 500);

  const out = await Promise.all(
    (flows ?? []).map(async (f) => {
      const byFlow = (q: any) => q.eq("flow_id", f.id); // eslint-disable-line @typescript-eslint/no-explicit-any
      const [entered, active, converted, sent, opened, clicked] = await Promise.all([
        count("flow_enrollments", byFlow),
        count("flow_enrollments", (q) => byFlow(q).eq("status", "active")),
        count("flow_enrollments", (q) => byFlow(q).eq("status", "converted")),
        count("email_sends", (q) => byFlow(q).eq("status", "sent")),
        count("email_sends", (q) => byFlow(q).not("opened_at", "is", null)),
        count("email_sends", (q) => byFlow(q).not("clicked_at", "is", null)),
      ]);
      const stats: FlowStats = { entered, active, converted, sent, opened, clicked };
      const steps = (Array.isArray(f.steps) ? f.steps : []) as Array<{ delay_hours?: number; subject?: string }>;
      return {
        id: f.id as string,
        name: f.name as string,
        description: (f.description as string | null) ?? "",
        trigger_type: f.trigger_type as string,
        status: f.status as string,
        rules: describeFlowRules(f.trigger_type as string, (f.trigger_config ?? {}) as Record<string, unknown>),
        steps: steps.map((s) => ({ delay_hours: Number(s.delay_hours ?? 0), subject: String(s.subject ?? "") })),
        stats,
        updated_at: f.updated_at as string | null,
      };
    }),
  );
  return NextResponse.json({ flows: out, admin: me.admin });
}
