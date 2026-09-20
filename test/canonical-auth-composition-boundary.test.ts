import assert from "node:assert/strict";
import test from "node:test";
import * as supportedApp from "../src/app.js";

test("supported app module does not expose the unauthenticated lower-level HTTP builder", () => {
  assert.equal("buildCanonicalApp" in supportedApp, false);
});
