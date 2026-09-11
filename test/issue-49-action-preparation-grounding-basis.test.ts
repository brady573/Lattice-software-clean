import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../src/model/types.js";
import {
  ModelSolandraActionPreparer,
  type SolandraActionPreparationInput,
} from "../src/solandra/action-preparer.js";

const DECLARED_FINDING = "The governed inspection record reports visible ceiling staining.";
const SIBLING_FINDING = "The governed estimate reports that replacement would cost 4,000 dollars.";
const UNCERTAINTY = "The inspection record does not establish the cause of the staining.";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-49-provider",
  requestedModel: "issue-49-model",
  actualProvider: "issue-49-provider",
  actualModel: "issue-49-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-49-request",
  routeProvenance: "COMPLETE",
});

const INPUT: SolandraActionPreparationInput = {
  conversationId: "conversation-issue-49",
  runId: "22222222-2222-4222-8222-222222222222",
  intentVersionId: "intent-version-issue-49",
  userMessageId: "message-issue-49",
  userMessage: "Draft a message asking my landlord about the documented damage.",
  authoritativeObjective: "Address the documented property damage.",
  knowledge: [{
    knowledgeId: "knowledge-issue-49",
    objective: "Address the documented property damage.",
    findings: [
      { claimId: "claim-a", text: DECLARED_FINDING, status: "SUPPORTED" },
      { claimId: "claim-b", text: SIBLING_FINDING, status: "SUPPORTED" },
    ],
    sourceCount: 2,
    uncertainties: [UNCERTAINTY],
  }],
};

function runtimeResult(text: string) {
  return {
    response: {
      id: "issue-49-response",
      model: "issue-49-model",
      output: [{ type: "text" as const, text }],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "stop" as const,
      providerMetadata: {},
    },
    audit: { invocationProvenance: PROVENANCE },
  };
}

class ScriptedRuntime {
  readonly calls: CanonicalModelRequest[] = [];

  constructor(private readonly outputs: string[]) {}

  async call(request: CanonicalModelRequest) {
    this.calls.push(structuredClone(request));
    const output = this.outputs.shift();
    assert.ok(output, "scripted runtime output exhausted");
    return runtimeResult(output);
  }
}

function preparer(runtime: ScriptedRuntime): ModelSolandraActionPreparer {
  return new ModelSolandraActionPreparer(
    runtime as unknown as Pick<ModelRuntime, "call">,
    "issue-49-model",
  );
}

function groundingPayload(runtime: ScriptedRuntime): string {
  const request = runtime.calls[1];
  assert.ok(request, "grounding request was not issued");
  return request.messages[1]?.content ?? "";
}

test("Issue #49: grounding cannot inspect an undeclared sibling claim", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "The replacement would cost 4,000 dollars, so please proceed with the cheaper option.",
      basis: [{ knowledgeId: "knowledge-issue-49", claimIds: ["claim-a"] }],
    }),
    JSON.stringify({
      status: "UNSUPPORTED",
      unsupportedExternalPremises: ["The replacement would cost 4,000 dollars."],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);

  const result = await preparer(runtime).prepare(INPUT);
  const grounding = groundingPayload(runtime);

  assert.match(grounding, /claim-a/u);
  assert.match(grounding, new RegExp(DECLARED_FINDING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(grounding, /claim-b/u);
  assert.doesNotMatch(grounding, new RegExp(SIBLING_FINDING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.equal(result.result.status, "FIDELITY_REJECTED");
});

test("Issue #49: explicitly declared sibling claims are both available to grounding", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "The inspection reports ceiling staining, and the estimate reports a 4,000 dollar replacement cost.",
      basis: [{ knowledgeId: "knowledge-issue-49", claimIds: ["claim-b", "claim-a"] }],
    }),
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);

  const result = await preparer(runtime).prepare(INPUT);
  const grounding = groundingPayload(runtime);

  assert.match(grounding, /claim-a/u);
  assert.match(grounding, /claim-b/u);
  assert.match(grounding, new RegExp(DECLARED_FINDING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.match(grounding, new RegExp(SIBLING_FINDING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.equal(result.result.status, "PREPARED");
  if (result.result.status !== "PREPARED") return;
  assert.deepEqual(result.result.basis, [{
    knowledgeId: "knowledge-issue-49",
    claimIds: ["claim-a", "claim-b"],
  }]);
  assert.deepEqual(result.result.preservedUncertainties, [UNCERTAINTY]);
  assert.equal(result.result.body.includes("4,000"), true);
});

test("Issue #49: invented claim IDs still fail closed before grounding", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Please review the documented damage.",
      basis: [{ knowledgeId: "knowledge-issue-49", claimIds: ["claim-invented"] }],
    }),
  ]);

  const result = await preparer(runtime).prepare(INPUT);

  assert.equal(result.result.status, "FIDELITY_REJECTED");
  assert.equal(runtime.calls.length, 1);
});

test("Issue #49: valid single-claim preparation remains intact", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "The inspection record reports visible ceiling staining. Could you please inspect the damaged area?",
      basis: [{ knowledgeId: "knowledge-issue-49", claimIds: ["claim-a"] }],
    }),
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);

  const result = await preparer(runtime).prepare(INPUT);
  const grounding = groundingPayload(runtime);

  assert.match(grounding, /claim-a/u);
  assert.doesNotMatch(grounding, /claim-b/u);
  assert.equal(result.result.status, "PREPARED");
  if (result.result.status !== "PREPARED") return;
  assert.deepEqual(result.result.basis, [{ knowledgeId: "knowledge-issue-49", claimIds: ["claim-a"] }]);
  assert.deepEqual(result.result.preservedUncertainties, [UNCERTAINTY]);
});
