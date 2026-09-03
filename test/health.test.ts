import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalApp as buildApp } from "../src/http-app.js";

test("health endpoint reports V36 fixture truth and async dispatch lifecycle mode", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    mode: "fixture",
    truth: "v36-offline",
    lifecycle: "async-dispatch",
  });
  await app.close();
});
