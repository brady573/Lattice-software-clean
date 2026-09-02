import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityStateGuard } from "../src/capability-execution-policy.js";
import type { LiveResearchBindingStores } from "../src/live-research-binding.js";
import type {
  LiveResearchCapabilityGrantSource,
  LiveResearchContextProjectionSource,
} from "../src/live-research-model-operation.js";
import {
  createLiveResearchWorkerExecutor,
  type LiveResearchWorkerCompositionOptions,
} from "../src/live-research-worker-composition.js";

function options(
  overrides: Partial<LiveResearchWorkerCompositionOptions> = {},
): LiveResearchWorkerCompositionOptions {
  const noNetwork = async (): Promise<never> => {
    throw new Error("construction must not dispatch network traffic");
  };
  const stores = {
    runStore: { async get() { return undefined; } },
    runBindingStore: { async getBinding() { return undefined; } },
    conversationStore: { async get() { return undefined; } },
  } as LiveResearchBindingStores;
  const contextSource = {
    async load() { throw new Error("context source must not be read during construction"); },
  } as LiveResearchContextProjectionSource;
  const grantSource = {
    async load() { throw new Error("grant source must not be read during construction"); },
  } as LiveResearchCapabilityGrantSource;
  const guard = {
    async check() { return "ACTIVE" as const; },
  } as CapabilityStateGuard;

  return {
    stores,
    model: {
      model: "provider/model",
      requestedProvider: "provider",
      executionClass: "LIVE_DIRECT",
    },
    modelProvider: {
      baseUrl: "https://model.example/v1",
      providerId: "provider",
      apiKey: "fixture-key-not-a-secret",
      fetchImpl: noNetwork as typeof fetch,
    },
    contextSource,
    grantSource,
    guard,
    capability: {
      capabilityId: "research.lookup",
      capabilityVersion: "1",
      endpoint: "https://research.example/v1/search",
      fetchImpl: noNetwork as typeof fetch,
    },
    ...overrides,
  };
}

test("M9-5 composes the validated live research seams into one durable ResearchTaskExecutor without dispatch", () => {
  const executor = createLiveResearchWorkerExecutor(options());
  assert.equal(typeof executor.execute, "function");
});

test("M9-5 standalone composition refuses brokered classification for the direct external provider", () => {
  assert.throws(
    () => createLiveResearchWorkerExecutor(options({
      model: {
        model: "provider/model",
        requestedProvider: "provider",
        executionClass: "LIVE_BROKERED",
      },
    })),
    /requires LIVE_DIRECT execution/,
  );
});

test("M9-5 standalone composition refuses requested-provider drift before constructing a runtime", () => {
  assert.throws(
    () => createLiveResearchWorkerExecutor(options({
      model: {
        model: "provider/model",
        requestedProvider: "other-provider",
        executionClass: "LIVE_DIRECT",
      },
    })),
    /requestedProvider must match the external provider identity/,
  );
});

test("M9-5 standalone composition preserves fail-closed endpoint configuration", () => {
  assert.throws(
    () => createLiveResearchWorkerExecutor(options({
      capability: {
        capabilityId: "research.lookup",
        capabilityVersion: "1",
        endpoint: "http://research.example/v1/search",
      },
    })),
    /credential-free HTTPS URL/,
  );
});
