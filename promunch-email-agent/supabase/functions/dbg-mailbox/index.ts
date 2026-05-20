import { processIncomingMessage } from "../_shared/process-email.ts";
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== Deno.env.get("SETUP_TOKEN")) {
    return new Response("forbidden", { status: 403 });
  }
  const id = url.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });
  try {
    const r = await processIncomingMessage(id);
    return new Response(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
  }
});
