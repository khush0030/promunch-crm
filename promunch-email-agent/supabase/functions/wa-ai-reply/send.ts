// wa-send invocation + JSON response helper.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

export async function callSend(body: unknown): Promise<{ ok?: boolean; error?: string }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await r.json().catch(() => ({ ok: false, error: "send response unparseable" }));
}

export function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
