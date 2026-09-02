import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityExecutorContext } from "../src/capability-execution-policy.js";
import {
  AllowlistedHttpResearchExecutionError,
  AllowlistedHttpResearchExecutor,
} from "../src/allowlisted-http-research-executor.js";

function context(overrides: Partial<CapabilityExecutorContext> = {}): CapabilityExecutorContext {
  return {
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    operationId: "operation-1",
    runId: "run-1",
    subjectId: "subject-1",
    intentVersionId: "intent-1",
    role: "RESEARCH",
    arguments: { query: "current bounded fact" },
    egress: { kind: "ALLOWLIST", origins: ["https://research.example"] },
    signal: new AbortController().signal,
    ...overrides,
  };
}

test("M9-5 allowlisted HTTP research executes one exact HTTPS JSON lookup with operational provenance", async () => {
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  const executor = new AllowlistedHttpResearchExecutor({
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    endpoint: "https://research.example/v1/search",
    fetchImpl: async (input, init) => {
      observedUrl = String(input);
      observedInit = init;
      return new Response(JSON.stringify({ answer: "observation" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const executionContext = context();
  const result = await executor.execute(executionContext) as Record<string, unknown>;
  assert.equal(observedUrl, "https://research.example/v1/search?q=current+bounded+fact");
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.redirect, "error");
  assert.equal(observedInit?.signal, executionContext.signal);
  assert.deepEqual(result, {
    kind: "HTTP_JSON_OBSERVATION",
    source: {
      origin: "https://research.example",
      path: "/v1/search",
      status: 200,
    },
    value: { answer: "observation" },
  });
});

test("M9-5 allowlisted HTTP research fails closed outside exact capability, role, or egress", async () => {
  let calls = 0;
  const executor = new AllowlistedHttpResearchExecutor({
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    endpoint: "https://research.example/v1/search",
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });

  for (const candidate of [
    context({ capabilityId: "research.other" }),
    context({ capabilityVersion: "2" }),
    context({ role: "MODEL_ASSISTANCE" }),
    context({ egress: { kind: "NONE" } }),
    context({ egress: { kind: "ALLOWLIST", origins: ["https://other.example"] } }),
  ]) {
    await assert.rejects(executor.execute(candidate), (error: unknown) => {
      assert.ok(error instanceof AllowlistedHttpResearchExecutionError);
      assert.ok(error.code === "CAPABILITY_MISMATCH" || error.code === "EGRESS_DENIED");
      return true;
    });
  }
  assert.equal(calls, 0);
});

test("M9-5 allowlisted HTTP research rejects invalid endpoint configuration before dispatch", () => {
  for (const endpoint of [
    "http://research.example/v1/search",
    "https://user:secret@research.example/v1/search",
    "https://research.example/",
    "https://research.example/v1/search?route=dynamic",
    "https://research.example/v1/search#fragment",
  ]) {
    assert.throws(
      () => new AllowlistedHttpResearchExecutor({
        capabilityId: "research.lookup",
        capabilityVersion: "1",
        endpoint,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AllowlistedHttpResearchExecutionError);
        assert.equal(error.code, "INVALID_CONFIG");
        return true;
      },
    );
  }
});

test("M9-5 allowlisted HTTP research preserves provider outage and malformed/oversized output as operational failures", async () => {
  const unavailable = new AllowlistedHttpResearchExecutor({
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    endpoint: "https://research.example/v1/search",
    fetchImpl: async () => new Response("down", { status: 503 }),
  });
  await assert.rejects(unavailable.execute(context()), (error: unknown) => {
    assert.ok(error instanceof AllowlistedHttpResearchExecutionError);
    assert.equal(error.code, "UNAVAILABLE");
    return true;
  });

  const malformed = new AllowlistedHttpResearchExecutor({
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    endpoint: "https://research.example/v1/search",
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(malformed.execute(context()), (error: unknown) => {
    assert.ok(error instanceof AllowlistedHttpResearchExecutionError);
    assert.equal(error.code, "MALFORMED_RESPONSE");
    return true;
  });

  const oversized = new AllowlistedHttpResearchExecutor({
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    endpoint: "https://research.example/v1/search",
    maxResponseBytes: 4,
    fetchImpl: async () => new Response("{\"value\":1}", { status: 200 }),
  });
  await assert.rejects(oversized.execute(context()), (error: unknown) => {
    assert.ok(error instanceof AllowlistedHttpResearchExecutionError);
    assert.equal(error.code, "RESPONSE_TOO_LARGE");
    return true;
  });
});

test("M9-5 allowlisted HTTP research forwards Product-owned cancellation without normalizing it into provider failure", async () => {
  const controller = new AbortController();
  const executor = new AllowlistedHttpResearchExecutor({
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    endpoint: "https://research.example/v1/search",
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });
  const pending = executor.execute(context({ signal: controller.signal }));
  controller.abort(new Error("cancelled-by-product"));
  await assert.rejects(pending, /cancelled-by-product/);
});