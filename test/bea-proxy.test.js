import test from "node:test";
import assert from "node:assert/strict";
import { proxyBeaRequest } from "../server/bea.js";
import { buildRequestParameters, buildNipaRequestParameters, DEFAULT_PARAMETERS } from "../src/bea.js";

test("both client request formats exclude API credentials", () => {
  for (const parameters of [DEFAULT_PARAMETERS,
    buildRequestParameters({ userId: "client-secret", geoFips: "01000" }),
    buildNipaRequestParameters({ userId: "client-secret" })]) {
    assert.equal(Object.hasOwn(parameters, "USERID"), false);
    assert.equal(JSON.stringify(parameters).includes("client-secret"), false);
  }
});

test("missing configuration and non-GET requests never call BEA", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upstream request"); });
  const missing = await proxyBeaRequest(new Request("https://example.test/api/bea"), "");
  assert.equal(missing.status, 503);
  const post = await proxyBeaRequest(new Request("https://example.test/api/bea", { method: "POST" }), "server-secret");
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET");
  assert.equal(upstream.mock.callCount(), 0);
});

test("server key wins and BEA request echoes never expose it", async (t) => {
  const secret = "server-test-key";
  const upstream = t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://apps.bea.gov");
    assert.deepEqual([...parsed.searchParams.keys()].filter(key => key.toUpperCase() === "USERID"), ["USERID"]);
    assert.equal(parsed.searchParams.get("USERID"), secret);
    assert.equal(parsed.searchParams.get("GEOFIPS"), "01000");
    return Response.json({ BEAAPI: {
      Request: { RequestParam: [{ ParameterName: "USERID", ParameterValue: secret }] },
      Results: { Data: [{ DataValue: "123", TimePeriod: "2024" }], Note: secret },
    } });
  });
  const result = await proxyBeaRequest(new Request("https://example.test/api/bea?USERID=bad&userid=bad2&GEOFIPS=01000"), secret);
  const body = await result.text();
  const payload = JSON.parse(body);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(body.includes(secret), false);
  assert.equal(Object.hasOwn(payload.BEAAPI, "Request"), false);
  assert.equal(payload.BEAAPI.Results.Data[0].DataValue, "123");
  assert.equal(upstream.mock.callCount(), 1);
});

test("upstream failures do not leak request URLs or credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("url?USERID=server-test-key"); });
  const result = await proxyBeaRequest(new Request("https://example.test/api/bea"), "server-test-key");
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: "Unable to reach the BEA API" });
});
