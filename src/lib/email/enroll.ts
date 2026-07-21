// App-side email-flow enrolment (the Next twin of the edge _shared/email-flows).
// Used by the public opt-in route to start the welcome flow. DB-only: the
// email-flow-tick cron does the sending. Idempotent via (flow_id, dedup_key).

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function enrollEmailFlow(
  trigger: string,
  opts: {
    email?: string | null;
    entityRef: string;
    dedupPrefix: string;
    firstName?: string | null;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const email = opts.email?.trim().toLowerCase();
  if (!email) return;

  const { data: flowRows } = await supabase
    .from("flows")
    .select("id, steps, trigger_config")
    .eq("trigger_type", trigger)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  const flow = flowRows?.[0];
  if (!flow) return; // no active flow → enrol nobody

  const steps = Array.isArray(flow.steps) ? (flow.steps as Array<{ delay_hours?: number }>) : [];
  if (steps.length === 0) return;

  const { data: c } = await supabase.from("contacts").select("id").eq("email", email).maybeSingle();
  const contactId = c?.id as string | undefined;
  if (!contactId) return;

  const cfg = (flow.trigger_config ?? {}) as Record<string, unknown>;
  const deadlineHours = typeof cfg.deadline_hours === "number" ? cfg.deadline_hours : null;
  const firstDelay = Number(steps[0]?.delay_hours ?? 0);

  await supabase.from("flow_enrollments").upsert(
    {
      flow_id: flow.id,
      contact_id: contactId,
      current_step: 0,
      status: "active",
      dedup_key: `${opts.dedupPrefix}:${opts.entityRef}`,
      context: { ...(opts.context ?? {}), first_name: opts.firstName ?? null },
      next_action_at: new Date(Date.now() + firstDelay * 3_600_000).toISOString(),
      deadline_at: deadlineHours ? new Date(Date.now() + deadlineHours * 3_600_000).toISOString() : null,
      entered_at: new Date().toISOString(),
    },
    { onConflict: "flow_id,dedup_key", ignoreDuplicates: true },
  );
}
