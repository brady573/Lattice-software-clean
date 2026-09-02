import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalOfflineModelRuntime,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";

class LocalQwenFixtureProvider implements ModelProvider {
  readonly kind = "openai-compatible-local";

  async generate(
    request: CanonicalModelRequest,
    _context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    return {
      response: {
        id: "local-qwen-test",
        model: request.model,
        output: [{ type: "text", text: "ok" }],
      },
      route: {
        actualModel: request.model,
        upstreamRequestId: "local-qwen-test",
      },
    };
  }
}

test("local offline runtime pins local execution provenance", async () => {
  const runtime = new LocalOfflineModelRuntime(new LocalQwenFixtureProvider());
  const result = await runtime.call({
    model: "qwen3:8b",
    messages: [{ role: "user", content: "hello" }],
  }, {
    correlationId: "local-qwen:test",
  });

  assert.deepEqual(result.audit.invocationProvenance, {
    executionClass: "LOCAL_OFFLINE",
    routeMode: "PINNED",
    requestedProvider: "local-openai-compatible",
    requestedModel: "qwen3:8b",
    actualProvider: null,
    actualModel: "qwen3:8b",
    brokerIdentity: null,
    brokerVersion: null,
    upstreamRequestId: "local-qwen-test",
    routeProvenance: "COMPLETE",
  });
});

test("local offline runtime rejects per-call route reclassification", async () => {
  const runtime = new LocalOfflineModelRuntime(new LocalQwenFixtureProvider());
  await assert.rejects(
    runtime.call({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "hello" }],
    }, {
      correlationId: "local-qwen:override",
      invocation: {
        executionClass: "LIVE_DIRECT",
        routeMode: "PINNED",
      },
    }),
    /does not allow per-call invocation overrides/,
  );
});
