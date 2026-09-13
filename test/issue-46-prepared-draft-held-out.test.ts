import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import type { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../src/model/types.js";
import type { KnowledgeOutcome, RunOutcome } from "../src/outcome.js";
import {
  buildPreparedResourceRecord,
  preparedResourceFromRecord,
} from "../src/action-preparation/prepared-resource-store.js";
import {
  composeSolandraPresentation,
  hydrateSolandraResource,
} from "../src/presentation/solandra-presentation.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";
import {
  ModelSolandraActionPreparer,
  type SolandraActionPreparationInput,
} from "../src/solandra/action-preparer.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-46-held-out",
  requestedModel: "issue-46-held-out",
  actualProvider: "issue-46-held-out",
  actualModel: "issue-46-held-out",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-46-held-out-request",
  routeProvenance: "COMPLETE",
});

function runtimeResult(text: string) {
  return {
    response: {
      id: "issue-46-held-out-response",
      model: "issue-46-held-out",
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
    assert.ok(output, "scripted Action Preparation output exhausted");
    return runtimeResult(output);
  }
}

async function userOnlyDraft(input: {
  runId: string;
  userMessageId: string;
  userMessage: string;
  objective: string;
  body: string;
}) {
  const runtime = new ScriptedRuntime([
    JSON.stringify({ status: "PREPARED", body: input.body, basis: [] }),
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(
    runtime as unknown as Pick<ModelRuntime, "call">,
    "issue-46-held-out",
  );
  const prepared = await preparer.prepare({
    conversationId: `conversation-${input.userMessageId}`,
    runId: input.runId,
    intentVersionId: `intent-${input.userMessageId}`,
    userMessageId: input.userMessageId,
    userMessage: input.userMessage,
    authoritativeObjective: input.objective,
    knowledge: [],
  });
  assert.equal(prepared.result.status, "PREPARED");
  if (prepared.result.status !== "PREPARED") throw new Error("expected PREPARED");
  assert.equal(runtime.calls.length, 2);
  const record = buildPreparedResourceRecord({
    conversationId: `conversation-${input.userMessageId}`,
    runId: input.runId,
    intentScopeId: `scope-${input.userMessageId}`,
    intentVersionId: `intent-${input.userMessageId}`,
    sourceMessageId: input.userMessageId,
    kind: "PREPARED_MESSAGE",
    title: "Prepared message",
    body: prepared.result.body,
    basis: prepared.result.basis,
    preservedUncertainties: prepared.result.preservedUncertainties,
    createdAt: "2026-09-13T01:00:00.000Z",
  });
  const resource = preparedResourceFromRecord(record);
  assert.equal(resource.kind, "PREPARED_MESSAGE");
  if (resource.kind !== "PREPARED_MESSAGE") throw new Error("expected PREPARED_MESSAGE");
  return resource;
}

test("post-freeze: ordinary user-only scheduling, service, and technical drafts remain unrestricted model drafting", async () => {
  const cases = [
    {
      runId: "46111111-1111-4111-8111-111111111111",
      userMessageId: "message-scheduling",
      userMessage: "Write a polite note asking whether Thursday morning works for a short planning call.",
      objective: "Ask about a short planning call.",
      body: "Hello, would Thursday morning work for a short planning call? If another time is easier, I can adjust. Thanks!",
    },
    {
      runId: "46222222-2222-4222-8222-222222222222",
      userMessageId: "message-appliance",
      userMessage: "Draft a brief inquiry asking a repair shop to inspect a dishwasher that has started making a rattling sound.",
      objective: "Ask a repair shop to inspect the dishwasher.",
      body: "Hello, my dishwasher has started making a rattling sound. Could you let me know when you might be able to inspect it? Thank you.",
    },
    {
      runId: "46333333-3333-4333-8333-333333333333",
      userMessageId: "message-technical-handoff",
      userMessage: "Prepare a concise note asking a teammate to review the handoff steps before tomorrow's maintenance window.",
      objective: "Ask a teammate to review the handoff steps.",
      body: "Could you review the handoff steps before tomorrow's maintenance window and flag anything that needs clarification? Thanks.",
    },
  ];

  for (const item of cases) {
    const resource = await userOnlyDraft(item);
    assert.equal(resource.body, item.body);
    assert.deepEqual(resource.basis, []);
    assert.deepEqual(resource.preservedUncertainties, []);
    assert.deepEqual(resource.draftAuthority, {
      origin: "SOLANDRA",
      factualAuthority: false,
      userAuthored: false,
    });
    assert.equal(resource.editable, true);
    assert.equal(resource.executionAuthorized, false);
    assert.notEqual(resource.body, item.userMessage, "the USER need not pre-write the final wording");
  }
});

function finding(claimId: string, text: string) {
  return {
    claimId,
    text,
    status: "SUPPORTED" as const,
    confidence: "HIGH" as const,
    evidenceIds: [`evidence-${claimId}`],
    contradictoryEvidenceIds: [],
    temporalQualifiers: { effectiveAt: null, period: null },
  };
}

test("post-freeze: prepared-message presentation separates generated wording, exact selected support, sibling Knowledge, and uncertainty", () => {
  const objective = "Ask the building manager about an intermittent hallway light.";
  const knowledge: KnowledgeOutcome = {
    kind: "KNOWLEDGE",
    objective,
    acceptedUnderstanding: objective,
    findings: [
      finding("claim-selected", "The maintenance log records three hallway-light outages this month."),
      finding("claim-sibling", "The elevator inspection is scheduled for next quarter."),
    ],
    uncertainties: [],
    provenance: [],
    truthAssessmentIds: ["truth-selected", "truth-sibling"],
  };
  const outcome: RunOutcome = {
    kind: "ACTION_PREPARATION",
    knowledge,
    resource: {
      kind: "PREPARED_MESSAGE",
      title: "Prepared message",
      body: "The hallway light is guaranteed to fail again tonight, so please inspect it soon.",
      draftAuthority: { origin: "SOLANDRA", factualAuthority: false, userAuthored: false },
      basis: [{ knowledgeId: "knowledge-building", claimIds: ["claim-selected"] }],
      preservedUncertainties: ["The maintenance log does not establish when another outage will occur."],
      editable: true,
      executionAuthorized: false,
    },
  };
  const run = {
    id: "46444444-4444-4444-8444-444444444444",
    conversationId: "conversation-building",
    status: "COMPLETED",
    version: 7,
    request: {
      kind: "consultation",
      objective,
      context: [],
      decisionNeed: "NONE",
      resourceNeed: "PREPARED_MESSAGE",
      sourceMessageId: "message-building",
      sourceMessageDigest: "b".repeat(64),
      intentVersion: 1,
      intentScopeId: "scope-building",
      intentVersionId: "intent-building",
    },
    decision: null,
    explanation: null,
    truthAssessmentIds: ["truth-selected", "truth-sibling"],
    events: [],
  } as unknown as LatticeRun;

  const snapshot = composeSolandraPresentation({
    conversationId: run.conversationId,
    run,
    outcome,
  });
  assert.equal(snapshot.supportingKnowledge.length, 1);
  assert.equal(snapshot.supportingKnowledge[0]?.id, "knowledge:claim-selected");
  assert.equal(JSON.stringify(snapshot.supportingKnowledge).includes("claim-sibling"), false);
  assert.equal(JSON.stringify(snapshot.supportingKnowledge).includes("elevator"), false);
  assert.deepEqual(snapshot.materialUncertainty.map((item) => item.description), [
    "The maintenance log does not establish when another outage will occur.",
  ]);

  const descriptor = snapshot.resources[0];
  assert.ok(descriptor);
  assert.deepEqual(descriptor.draftAuthority, {
    origin: "SOLANDRA",
    factualAuthority: false,
    userAuthored: false,
  });
  assert.deepEqual(descriptor.governedBasis, [{
    knowledgeId: "knowledge-building",
    claimIds: ["claim-selected"],
  }]);
  assert.deepEqual(descriptor.preservedUncertainties, [
    "The maintenance log does not establish when another outage will occur.",
  ]);
  assert.deepEqual(descriptor.provenance, [{ authority: "execution_runtime", ref: `${run.id}@7` }]);
  assert.equal(JSON.stringify(descriptor).includes("evidence-claim-selected"), false);
  assert.equal(JSON.stringify(descriptor).includes("truth-selected"), false);

  const hydrated = hydrateSolandraResource({ snapshot, resourceId: descriptor.id, run, outcome });
  assert.ok(hydrated && hydrated.payload.kind === "generated_artifact");
  if (!hydrated || hydrated.payload.kind !== "generated_artifact") return;
  assert.match(hydrated.payload.text, /guaranteed to fail again tonight/u);
  assert.deepEqual(hydrated.payload.draftAuthority, descriptor.draftAuthority);
  assert.deepEqual(hydrated.payload.governedBasis, descriptor.governedBasis);
  assert.deepEqual(hydrated.payload.preservedUncertainties, descriptor.preservedUncertainties);
});

test("post-freeze: canonical browser template communicates status-preserving evidence treatment while preserving checklist treatment", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /Solandra draft/u);
  assert.match(html, /This wording is a draft, not established fact\./u);
  assert.match(html, /Established support/u);
  assert.match(html, /Evidence refutes/u);
  assert.match(html, /Evidence remains conflicted/u);
  assert.match(html, /Not established/u);
  assert.match(html, /No external evidence was used for this draft\./u);
  assert.match(html, /What remains uncertain/u);
  assert.match(html, /resource\.kind !== "PREPARED_MESSAGE"/u);
  assert.match(html, /Review and edit this before using it\./u);
  assert.match(html, /Nothing has been sent or executed\./u);
  assert.doesNotMatch(html, /guarantees a free 30-day extension/u);
});
