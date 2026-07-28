const BEA_ENDPOINT = "https://apps.bea.gov/api/data/";

export default async (request) => {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const incomingUrl = new URL(request.url);
  const parameters = new URLSearchParams(incomingUrl.search);
  const serverUserId = Netlify.env.get("BEA_USER_ID");

  if (serverUserId) parameters.set("USERID", serverUserId);

  try {
    const response = await fetch(`${BEA_ENDPOINT}?${parameters.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: "Unable to reach the BEA API", detail: error.message },
      { status: 502 },
    );
  }
};
