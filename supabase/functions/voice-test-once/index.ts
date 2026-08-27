// THROWAWAY live-test proxy for voice-call-start. Token gated. DELETE after use.
Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("t") !== "dc9158aa90a72120afd47030bd1bb82b") return new Response("no", { status: 401 });
  const body = await req.text();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-call-start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body,
  });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
});
