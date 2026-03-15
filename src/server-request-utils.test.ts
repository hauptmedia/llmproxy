import assert from "node:assert/strict";
import test from "node:test";
import { isErrorStatus } from "./server-request-utils";

test("isErrorStatus treats every non-2xx status as an error", () => {
  assert.equal(isErrorStatus(undefined), false);
  assert.equal(isErrorStatus(199), true);
  assert.equal(isErrorStatus(200), false);
  assert.equal(isErrorStatus(204), false);
  assert.equal(isErrorStatus(299), false);
  assert.equal(isErrorStatus(300), true);
  assert.equal(isErrorStatus(302), true);
  assert.equal(isErrorStatus(400), true);
  assert.equal(isErrorStatus(500), true);
});
