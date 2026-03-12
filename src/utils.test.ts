import assert from "node:assert/strict";
import test from "node:test";
import { toErrorMessage } from "./utils";

test("toErrorMessage includes a nested cause when it adds context", () => {
  const error = new Error("fetch failed", {
    cause: new Error("expect header not supported"),
  });

  assert.equal(
    toErrorMessage(error),
    "fetch failed (expect header not supported)",
  );
});

test("toErrorMessage keeps the base message when the cause is the same", () => {
  const error = new Error("fetch failed", {
    cause: new Error("fetch failed"),
  });

  assert.equal(toErrorMessage(error), "fetch failed");
});
