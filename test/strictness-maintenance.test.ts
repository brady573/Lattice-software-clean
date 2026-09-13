import assert from "node:assert/strict";
import test from "node:test";
import { ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID } from "../src/decision/alpha-decision-capability.js";
import {
  ModelRuntime,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";
import { compileClaim } from "../src/truth/claim-compiler.js";
import type { KnowledgeEvidenceQualificationInput } from "../src/truth/knowledge-acquisition-pipeline.js";
import { NpmRuntimeDependencyAdmissionPolicy } from "../src/truth/npm-decision-admission.js";
import type { SourceArtifact } from "../src/truth/types.js";

const request: CanonicalModelRequest = {
  model: "strictness-maintenance-fixture",
  messages: [{ role: "user", content: "bounded state" }],
};

class CountingProvider implements ModelProvider {
  readonly kind = "strictness-maintenance";
  calls = 0;
  readonly attempts: number[] = [];

  async generate(
    requestValue: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    this.attempts.push(context.attempt);
    return {
      response: {
        id: `strictness-${this.calls}`,
        model: requestValue.model,
        output: [{ type: "text", text: `attempt:${context.attempt}` }],
      },
    };
  }
}

function npmQualificationInput(canonicalUri: string): KnowledgeEvidenceQualificationInput {
  const runId = "strictness-maintenance-run";
  const source: SourceArtifact = {
    id: "source-npm",
    runId,
    canonicalUri,
    artifactHash: "intentionally-not-a-valid-content-hash",
    publisher: "npm",
    originKey: null,
    provenanceComponentKey: null,
    provenanceConfidence: "UNKNOWN",
    authoritativePrimary: false,
    retrievedAt: "2026-09-13T00:00:00.000Z",
    publishedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    contentType: "application/json",
    metadata: {},
    untrusted: true,
  };
  const claim = compileClaim({
    runId,
    sourceClaimId: "npm-path-shape",
    text: "Path-shape fixture only.",
    claimType: "QUANTITATIVE",
    qualifiers: [{
      key: "decision-criterion",
      value: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
    }],
  }).claim;
  return {
    claim,
    source,
    sourceContent: "{}",
    proposed: {
      sourceId: source.id,
      relation: "SUPPORTS",
      excerpt: "fixture",
    },
  };
}

test("bounded model idempotency state preserves LRU eviction ordering", async () => {
  const provider = new CountingProvider();
  const runtime = new ModelRuntime(provider, { maxStateEntries: 2 });
  const call = async (key: string) => await runtime.call(request, {
    correlationId: `idempotency-${key}`,
    idempotencyKey: "delivery",
  });

  await call("a");
  await call("b");
  await call("a");
  assert.equal(provider.calls, 2, "reading a cached entry must refresh it without another provider call");

  await call("c");
  await call("a");
  assert.equal(provider.calls, 3, "the refreshed entry must survive the next bounded eviction");

  await call("b");
  assert.equal(provider.calls, 4, "the least-recently-used entry must be the one evicted");
});

test("bounded attempt state preserves per-key recency and resets only an evicted key", async () => {
  const provider = new CountingProvider();
  const runtime = new ModelRuntime(provider, { maxStateEntries: 2 });
  const call = async (key: string) => await runtime.call(request, { correlationId: `attempt-${key}` });

  await call("a");
  await call("b");
  await call("a");
  await call("c");
  await call("a");
  await call("b");

  assert.deepEqual(provider.attempts, [0, 0, 1, 0, 2, 0]);
});

test("npm package/latest path narrowing preserves accepted and rejected URI shapes", () => {
  const policy = new NpmRuntimeDependencyAdmissionPolicy();
  const pathRejection = "npm decision evidence is not bound to an exact package/latest source.";

  for (const canonicalUri of [
    "https://registry.npmjs.org/latest",
    "https://registry.npmjs.org/lodash/not-latest",
    "https://registry.npmjs.org/lodash/latest/extra",
    "https://registry.npmjs.org/%/latest",
  ]) {
    assert.equal(policy.disposition(npmQualificationInput(canonicalUri)).rejectionReason, pathRejection);
  }

  for (const canonicalUri of [
    "https://registry.npmjs.org/lodash/latest",
    "https://registry.npmjs.org/%40scope%2Fpackage/latest",
  ]) {
    assert.notEqual(policy.disposition(npmQualificationInput(canonicalUri)).rejectionReason, pathRejection);
  }
});
