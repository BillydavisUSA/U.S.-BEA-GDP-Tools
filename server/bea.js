const BEA_ENDPOINT = "https://apps.bea.gov/api/data/";
const json = (data, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function proxyBeaRequest(request, apiKey) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET" } });
  }
  const serverUserId = String(apiKey || "").trim();
  if (!serverUserId) return json({ error: "BEA API key is not configured on this server" }, 503);
  const parameters = new URLSearchParams(new URL(request.url).search);
  for (const name of [...parameters.keys()]) {
    if (name.toUpperCase() === "USERID") parameters.delete(name);
  }
  parameters.set("USERID", serverUserId);
  try {
    const response = await fetch(BEA_ENDPOINT + "?" + parameters.toString(), {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json();
    // BEA echoes its input parameters; the server key must not return to browsers.
    if (payload?.BEAAPI && typeof payload.BEAAPI === "object") delete payload.BEAAPI.Request;
    const body = JSON.stringify(payload).replaceAll(serverUserId, "[redacted]");
    return new Response(body, {
      status: response.status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return json({ error: "Unable to reach the BEA API" }, 502);
  }
}
