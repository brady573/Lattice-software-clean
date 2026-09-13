import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../src/model/types.js";
import {
  buildPreparedResourceRecord,
  preparedResourceFromRecord,
} from "../src/action-preparation/prepared-resource-store.js";
import {
  ModelSolandraActionPreparer,
  type SolandraActionPreparationInput,
} from "../src/solandra/action-preparer.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-46-reproduction",
  requestedModel: "issue-46-reproduction",
  actualProvider: "issue-46-reproduction",
  actualModel: "issue-46-reproduction",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-46-reproduction-request",
  routeProvenance: "COMPLETE",
});

function runtimeResult(text: string) {
  return {
    response: {
      id: "issue-46-response",
      model: "issue-46-reproduction",
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
    assert.ok(output);
    return runtimeResult(output);
  }
}

const input: SolandraActionPreparationInput = {
  conversationId: "conversation-issue-46",
  runId: "46464646-4646-4646-8646-464646464646",
  intentVersionId: "intent-version-issue-46",
  userMessageId: "message-issue-46",
  userMessage: "Draft an email asking the vendor to extend our trial.",
  authoritativeObjective: "Ask the vendor to extend the trial.",
  knowledge: [{
    knowledgeId: "knowledge-issue-46",
    objective: "Ask the vendor to extend the trial.",
    findings: [{
      claimId: "claim-trial-end",
      text: "The current trial ends Friday.",
      status: "SUPPORTED",
    }],
    sourceCount: 1,
    uncertainties: ["No governed material establishes whether an extension is guaranteed."],
  }],
};

test("Issue #46: false-positive correlated grounding cannot give generated draft prose factual authority", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Our contract guarantees a free 30-day extension, so please extend the trial.",
      basis: [{ knowledgeId: "knowledge-issue-46", claimIds: ["claim-trial-end"] }],
    }),
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(
    runtime as unknown as Pick<ModelRuntime, "call">,
    "issue-46-reproduction",
  );

  const generated = await preparer.prepare(input);
  assert.equal(generated.result.status, "PREPARED");
  if (generated.result.status !== "PREPARED") return;
  assert.equal(runtime.calls.length, 2, "grounding remains a drafting-quality guard, not factual authority");

  const record = buildPreparedResourceRecord({
    conversationId: input.conversationId,
    runId: input.runId,
    intentScopeId: "intent-scope-issue-46",
    intentVersionId: input.intentVersionId,
    sourceMessageId: input.userMessageId,
    kind: "PREPARED_MESSAGE",
    title: "Prepared message",
    body: generated.result.body,
    basis: generated.result.basis,
    preservedUncertainties: generated.result.preservedUncertainties,
    createdAt: "2026-09-12T00:00:00.000Z",
  });
  const resource = preparedResourceFromRecord(record);

  assert.equal(resource.kind, "PREPARED_MESSAGE");
  if (resource.kind !== "PREPARED_MESSAGE") return;
  assert.match(resource.body, /guarantees a free 30-day extension/u);
  assert.deepEqual(resource.draftAuthority, {
    origin: "SOLANDRA",
    factualAuthority: false,
    userAuthored: false,
  });
  assert.deepEqual(resource.basis, [{ knowledgeId: "knowledge-issue-46", claimIds: ["claim-trial-end"] }]);
  assert.deepEqual(resource.preservedUncertainties, ["No governed material establishes whether an extension is guaranteed."]);
  assert.equal(resource.editable, true);
  assert.equal(resource.executionAuthorized, false);
  assert.equal("evidenceIds" in resource, false);
  assert.equal("sourceIds" in resource, false);
  assert.equal("truthStatus" in resource, false);
});
