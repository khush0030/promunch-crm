// One-shot: register the WhatsApp phone number with the Cloud API.
// POST { pin: "<6 digits>" }  (service-role bearer)
// Uses the WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID secrets so the
// token never has to be handled by hand. Safe to delete after a successful run.

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "method" }, 405);

  const { pin } = await req.json().catch(() => ({}));
  if (!pin || !/^\d{6}$/.test(String(pin))) {
    return j({ error: "a 6-digit pin is required" }, 400);
  }

  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) {
    return j({ error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set" }, 500);
  }

  const res = await fetch(`${GRAPH}/${phoneId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin: String(pin) }),
  });
  const body = await res.json().catch(() => ({}));

  return j({ phone_number_id: phoneId, http_status: res.status, response: body });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
