import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelRuntime,
  OpenAiCompatibleModelProvider,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelExecutionClass,
  type ModelProvider,
  type ModelProviderResult,
  type ModelProviderRouteObservation,
  type ModelRouteMode,
  type ModelRouteProvenanceCompleteness,
} from "../src/model/index.js";

const request: CanonicalModelRequest = {
  model: "requested-model",
  messages: [{ role: "user", content: "test" }],
};

interface ProvenanceCase {
  readonly executionClass: ModelExecutionClass;
  readonly routeMode: ModelRouteMode;
  readonly route: ModelProviderRouteObservation;
  readonly expectedCompleteness: ModelRouteProvenanceCompleteness;
}

class RouteFixtureProvider implements ModelProvider {
  readonly kind = "route-fixture";
  calls = 0;

  constructor(
    private readonly route?: ModelProviderRouteObservation,
    private readonly responseModel?: string,
    private readonly metadata: Readonly<Record<string, unknown>> = { operationalOnly: true },
  ) {}

  async generate(
    _request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    return {
      response: {
        id: `fixture-${context.attempt}`,
        model: this.responseModel ?? this.route?.actualModel ?? "requested-model",
        output: [{ type: "text", text: "candidate-output" }],
      },
      metadata: this.metadata,
      ...(this.route === undefined ? {} : { route: this.route }),
    };
  }
}

test("M9-1 represents each execution class and route mode without changing canonical response authority", async () => {
  const cases: readonly ProvenanceCase[] = [
    {
      executionClass: "LOCAL_OFFLINE",
      routeMode: "PINNED",
      route: { actualModel: "local-model" },
      expectedCompleteness: "COMPLETE",
    },
    {
      executionClass: "LIVE_DIRECT",
      routeMode: "PRODUCT_ROUTED",
      route: { actualProvider: "provider-a", actualModel: "direct-model" },
      expectedCompleteness: "COMPLETE",
    },
    {
      executionClass: "LIVE_BROKERED",
      routeMode: "BROKER_AUTOMATIC",
      route: {
        brokerIdentity: "broker-a",
        brokerVersion: "1.2.3",
        actualProvider: "provider-b",
        actualModel: "brokered-model",
        upstreamRequestId: "upstream-123",
      },
      expectedCompleteness: "COMPLETE",
    },
  ];

  for (const entry of cases) {
    const runtime = new ModelRuntime(new RouteFixtureProvider(entry.route));
    const result = await runtime.call(request, {
      correlationId: `case-${entry.executionClass}`,
      invocation: {
        executionClass: entry.executionClass,
        routeMode: entry.routeMode,
        requestedProvider: "requested-provider",
      },
    });

    assert.equal(result.response.output[0]?.type, "text");
    assert.equal(result.audit.invocationProvenance.executionClass, entry.executionClass);
    assert.equal(result.audit.invocationProvenance.routeMode, entry.routeMode);
    assert.equal(result.audit.invocationProvenance.requestedProvider, "requested-provider");
    assert.equal(result.audit.invocationProvenance.requestedModel, "requested-model");
    assert.equal(result.audit.invocationProvenance.actualProvider, entry.route.actualProvider ?? null);
    assert.equal(result.audit.invocationProvenance.actualModel, entry.route.actualModel ?? null);
    assert.equal(result.audit.invocationProvenance.routeProvenance, entry.expectedCompleteness);
    assert.equal(result.audit.providerMetadata.operationalOnly, true);
  }
});

test("M9-1 distinguishes requested route from observed actual route", async () => {
  const runtime = new ModelRuntime(new RouteFixtureProvider({
    brokerIdentity: "broker-a",
    actualProvider: "provider-actual",
    actualModel: "model-actual",
    upstreamRequestId: "request-actual",
  }));

  const result = await runtime.call(request, {
    correlationId: "requested-vs-actual",
    invocation: {
      executionClass: "LIVE_BROKERED",
      routeMode: "PINNED",
      requestedProvider: "provider-requested",
    },
  });

  assert.deepEqual(result.audit.invocationProvenance, {
    executionClass: "LIVE_BROKERED",
    routeMode: "PINNED",
    requestedProvider: "provider-requested",
    requestedModel: "requested-model",
    actualProvider: "provider-actual",
    actualModel: "model-actual",
    brokerIdentity: "broker-a",
    brokerVersion: null,
    upstreamRequestId: "request-actual",
    routeProvenance: "COMPLETE",
  });
});

test("M9-1 keeps a loopback transport classified as brokered when Product invocation says LIVE_BROKERED", async () => {
  const provider = new OpenAiCompatibleModelProvider({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetchImpl: async () => new Response(JSON.stringify({
      id: "loopback-broker-request",
      model: "observed-loopback-model",
      choices: [{ message: { content: "candidate-output" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  const result = await new ModelRuntime(provider).call(request, {
    correlationId: "brokered-loopback",
    invocation: {
      executionClass: "LIVE_BROKERED",
      routeMode: "BROKER_AUTOMATIC",
      requestedProvider: "loopback-broker",
    },
  });

  assert.equal(result.audit.invocationProvenance.executionClass, "LIVE_BROKERED");
  assert.equal(result.audit.invocationProvenance.routeMode, "BROKER_AUTOMATIC");
  assert.equal(result.audit.invocationProvenance.actualModel, "observed-loopback-model");
  assert.equal(result.audit.invocationProvenance.actualProvider, null);
  assert.equal(result.audit.invocationProvenance.brokerIdentity, null);
  assert.equal(result.audit.invocationProvenance.routeProvenance, "PARTIAL");
});

test("M9-1 fails provider-specific provenance closed as partial or missing without turning it into model truth", async () => {
  const partial = await new ModelRuntime(new RouteFixtureProvider({ actualModel: "observed-model" })).call(
    request,
    {
      correlationId: "partial-route",
      invocation: {
        executionClass: "LIVE_BROKERED",
        routeMode: "BROKER_AUTOMATIC",
      },
    },
  );
  assert.equal(partial.audit.invocationProvenance.routeProvenance, "PARTIAL");
  assert.equal(partial.audit.invocationProvenance.actualProvider, null);
  assert.equal(partial.response.output[0]?.type, "text");

  const missing = await new ModelRuntime(new RouteFixtureProvider()).call(request, {
    correlationId: "missing-route",
    invocation: {
      executionClass: "LIVE_DIRECT",
      routeMode: "PINNED",
      requestedProvider: "provider-requested",
    },
  });
  assert.equal(missing.audit.invocationProvenance.routeProvenance, "MISSING");
  assert.equal(missing.audit.invocationProvenance.actualProvider, null);
  assert.equal(missing.audit.invocationProvenance.actualModel, null);
  assert.equal(missing.response.output[0]?.type, "text");
});

test("M9-1 rejects malformed observed route identity instead of normalizing fabricated provenance", async () => {
  const runtime = new ModelRuntime(new RouteFixtureProvider({
    actualProvider: "provider-a",
    actualModel: "   ",
  }, "requested-model"));

  await assert.rejects(
    runtime.call(request, {
      correlationId: "malformed-route",
      invocation: {
        executionClass: "LIVE_DIRECT",
        routeMode: "PINNED",
        requestedProvider: "provider-a",
      },
    }),
    /route\.actualModel must be non-empty/,
  );
});

test("M9-1 sanitizes malformed provider metadata without granting it canonical response authority", async () => {
  const runtime = new ModelRuntime(new RouteFixtureProvider(
    { actualProvider: "provider-a", actualModel: "model-a" },
    undefined,
    {
      safeBoolean: true,
      safeString: "operational-observation",
      nested: { authority: "fabricated" },
      nonFinite: Number.NaN,
    },
  ));

  const result = await runtime.call(request, {
    correlationId: "malformed-provider-metadata",
    invocation: {
      executionClass: "LIVE_DIRECT",
      routeMode: "PINNED",
      requestedProvider: "provider-a",
    },
  });

  assert.deepEqual(result.audit.providerMetadata, {
    safeBoolean: true,
    safeString: "operational-observation",
  });
  assert.equal(result.response.model, "model-a");
  assert.deepEqual(result.response.output, [{ type: "text", text: "candidate-output" }]);
});

test("M9-1 keeps configured provider credentials out of audit and provenance surfaces", async () => {
  const credential = "m9-secret-credential-value";
  let observedAuthorization: string | null = null;
  const provider = new OpenAiCompatibleModelProvider({
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: credential,
    fetchImpl: async (_input, init) => {
      const headers = new Headers(init?.headers);
      observedAuthorization = headers.get("authorization");
      return new Response(JSON.stringify({
        id: "upstream-credential-test",
        model: "requested-model",
        choices: [{ message: { content: "candidate-output" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await new ModelRuntime(provider).call(request, {
    correlationId: "credential-redaction",
    invocation: {
      executionClass: "LOCAL_OFFLINE",
      routeMode: "PINNED",
      requestedProvider: "local-openai-compatible",
    },
  });

  assert.equal(observedAuthorization, `Bearer ${credential}`);
  assert.deepEqual(result.audit.providerMetadata, {
    upstreamStatus: 200,
    upstreamRequestId: "upstream-credential-test",
  });
  assert.equal(JSON.stringify(result.audit).includes(credential), false);
  assert.equal(JSON.stringify(result.audit.invocationProvenance).includes(credential), false);
});

test("M9-1 preserves correlation, request identity, attempt, and idempotent duplicate behavior", async () => {
  const provider = new RouteFixtureProvider({ actualModel: "local-model" });
  const runtime = new ModelRuntime(provider);
  const options = {
    correlationId: "stable-correlation",
    idempotencyKey: "stable-idempotency",
    invocation: {
      executionClass: "LOCAL_OFFLINE" as const,
      routeMode: "PINNED" as const,
    },
  };

  const first = await runtime.call(request, options);
  const second = await runtime.call(request, options);

  assert.equal(provider.calls, 1);
  assert.equal(first.audit.correlationId, "stable-correlation");
  assert.equal(second.audit.correlationId, first.audit.correlationId);
  assert.equal(second.audit.requestIdentity, first.audit.requestIdentity);
  assert.equal(second.audit.attempt, first.audit.attempt);
  assert.deepEqual(second.audit.invocationProvenance, first.audit.invocationProvenance);
});

test("legacy callers remain compatible but route provenance is explicitly missing", async () => {
  const result = await new ModelRuntime(new RouteFixtureProvider({ actualModel: "observed-model" })).call(
    request,
    { correlationId: "legacy-compatible" },
  );

  assert.equal(result.audit.invocationProvenance.executionClass, null);
  assert.equal(result.audit.invocationProvenance.routeMode, null);
  assert.equal(result.audit.invocationProvenance.routeProvenance, "MISSING");
  assert.equal(result.audit.invocationProvenance.requestedModel, "requested-model");
});
