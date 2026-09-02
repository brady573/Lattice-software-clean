import assert from "node:assert/strict";
import test from "node:test";

import {
  assertHealthContract,
  createConversation,
  waitForTargetHealth,
} from "../tools/render-blackbox-probes.mjs";

test("Render blackbox health gate retries transient edge failures with bounded backoff", async () => {
  const responses = [
    { status: 502, data: "Bad Gateway" },
    { status: 503, data: "Service Unavailable" },
    {
      status: 200,
      data: {
        status: "ok",
        mode: "fixture",
        truth: "v36-offline",
        lifecycle: "async-dispatch",
      },
    },
  ];
  const delays: number[] = [];
  const logs: string[] = [];
  let calls = 0;

  const health = await waitForTargetHealth({
    call: async () => {
      const response = responses[calls];
      calls += 1;
      if (!response) throw new Error("unexpected extra call");
      return response;
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    attempts: 5,
    initialBackoffMs: 500,
    maxBackoffMs: 5_000,
    log: (line) => logs.push(line),
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1_000]);
  assert.equal(logs.length, 2);
  assert.equal(health.status, 200);
  assertHealthContract(health);
});

test("Render blackbox health gate retries transport failures", async () => {
  const delays: number[] = [];
  let calls = 0;

  const health = await waitForTargetHealth({
    call: async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket unavailable");
      return {
        status: 200,
        data: {
          status: "ok",
          mode: "fixture",
          truth: "v36-offline",
          lifecycle: "async-dispatch",
        },
      };
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    attempts: 3,
    initialBackoffMs: 250,
    maxBackoffMs: 1_000,
    log: () => {},
  });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
  assertHealthContract(health);
});

test("Render blackbox health gate does not mask a non-transient application response", async () => {
  let slept = false;

  await assert.rejects(
    waitForTargetHealth({
      call: async () => ({ status: 404, data: { error: "not found" } }),
      sleep: async () => {
        slept = true;
      },
      attempts: 5,
      log: () => {},
    }),
    /target health unavailable/,
  );

  assert.equal(slept, false);
});

test("Render blackbox preserves the exact health contract after target availability", () => {
  assert.throws(
    () =>
      assertHealthContract({
        status: 200,
        data: {
          status: "ok",
          mode: "durable",
          truth: "v36-offline",
          lifecycle: "async-dispatch",
        },
      }),
    /health contract/,
  );
});

test("Render blackbox creates a durable conversation before authoritative USER writes", async () => {
  const calls: Array<{ method: string; path: string }> = [];

  const conversationId = await createConversation(async (method, path) => {
    calls.push({ method, path });
    return {
      status: 201,
      data: { conversation: { id: "conversation-created-for-blackbox" } },
    };
  }, "clear");

  assert.equal(conversationId, "conversation-created-for-blackbox");
  assert.deepEqual(calls, [{ method: "POST", path: "/api/v1/conversations" }]);
});

test("Render blackbox fails closed when durable conversation creation is invalid", async () => {
  await assert.rejects(
    createConversation(
      async () => ({ status: 201, data: { conversation: {} } }),
      "ambiguous",
    ),
    /ambiguous conversation creation/,
  );
});
