// Server-only: call the wa-template-create edge function with the service-role
// bearer (the function's requireInternal gate). Used by the templates API
// routes (submit, edit, sync, delete).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function callTemplateFn(
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-template-create`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && data.ok === undefined) data.ok = false;
    if (!res.ok && !data.error) data.error = `The template service answered ${res.status}.`;
    return { status: res.status, data };
  } catch (e) {
    return {
      status: 502,
      data: { ok: false, error: `Could not reach the template service: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
