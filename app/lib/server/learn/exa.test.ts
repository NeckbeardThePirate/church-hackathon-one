import assert from "node:assert/strict";
import test from "node:test";
import { EXA_GATEWAY_PROVIDER, exaEndpoint, exaHeaders, exaReady, type ExaAuth } from "./exa.ts";

test("Exa requests omit the Exa key when it is unset and still authenticate to AI Gateway", () => {
  const headers = exaHeaders(undefined, "gateway-token");
  assert.equal(headers["x-api-key"], undefined);
  assert.equal(headers["cf-aig-authorization"], "Bearer gateway-token");
  assert.equal(EXA_GATEWAY_PROVIDER, "custom-exa");
});

test("Exa requests send x-api-key only when a key is set", () => {
  const headers = exaHeaders("exa-key", undefined);
  assert.equal(headers["x-api-key"], "exa-key");
  assert.equal(headers["cf-aig-authorization"], undefined);
});

test("Exa calls use the gateway custom-provider URL when a base is available", () => {
  assert.equal(
    exaEndpoint("/search", "https://gateway.ai.cloudflare.com/v1/account/study-buddy/custom-exa/"),
    "https://gateway.ai.cloudflare.com/v1/account/study-buddy/custom-exa/search",
  );
  assert.equal(exaEndpoint("/contents", undefined), "https://api.exa.ai/contents");
});

test("Exa is skipped when neither the gateway token nor an Exa key is set", () => {
  const missing: ExaAuth = { gatewayId: "study-buddy", ai: { gateway: () => ({ getUrl: async () => "" }) } };
  assert.equal(exaReady(missing), false);
  assert.equal(exaReady({ ...missing, gatewayToken: "gateway-token" }), true);
  assert.equal(exaReady({ apiKey: "exa-key" }), true);
});
