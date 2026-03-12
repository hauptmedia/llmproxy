import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedProxyRoute } from "./server";

test("accepts only supported completion proxy routes", () => {
  assert.equal(isSupportedProxyRoute("POST", "/v1/chat/completions"), true);
});

test("rejects unsupported or non-post OpenAI routes", () => {
  assert.equal(isSupportedProxyRoute("GET", "/v1/models"), false);
  assert.equal(isSupportedProxyRoute("POST", "/v1/completions"), false);
  assert.equal(isSupportedProxyRoute("POST", "/v1/embeddings"), false);
  assert.equal(isSupportedProxyRoute("POST", "/v1/responses"), false);
});
