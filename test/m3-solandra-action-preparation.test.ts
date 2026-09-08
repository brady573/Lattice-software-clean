import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ModelRuntime } from "../src/model/runtime.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  ModelSolandraActionPreparer,
  type SolandraActionPreparationInput,
  type SolandraActionPreparationRuntimeResult,
  type SolandraActionPreparer,
} from "../src/solandra/action-preparer.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const FINDING = "The admitted inspection record reports visible water staining on the ceiling near the damaged area.";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "m3-deterministic",
  requestedModel: "m3-deterministic-model",
  actualProvider: "m3-deterministic",
  actualModel: "m3-deterministic-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "m3-deterministic-request",
  routeProvenance: "COMPLETE",
});

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "m3-evidence",
    value: FINDING,
    sourceId: "m3-source",
    sourceLabel: "M3 governed inspection record",
    admitted: true,
  }],
  truthClaims: [{
    id: "m3-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["m3-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "m3-evidence",
    claimId: "m3-claim",
    provenanceComponentKey: "m3-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: [],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    ...overrides,
  };
}

class M3Cognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const lower = input.message.toLocaleLowerCase("en-US");
    if (/draft|prepare|write|compose/iu.test(lower)) {
      return {
        proposal: proposal({
          objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
          proposedObjective: input.currentObjective ? null : "Model proposal must remain non-authoritative.",
          requestedHelp: "RESOURCE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : "Model proposal must remain non-authoritative.",
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: ["governed inspection evidence relevant to the USER's objective"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class M3Preparer implements SolandraActionPreparer {
  readonly inputs: SolandraActionPreparationInput[] = [];

  async prepare(input: SolandraActionPreparationInput): Promise<SolandraActionPreparationRuntimeResult> {
    this.inputs.push(structuredClone(input));
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const claim = knowledge.findings[0];
    assert.ok(claim);
    const contractor = /contractor/iu.test(input.userMessage);
    return {
      result: {
        status: "PREPARED",
        body: contractor
          ? "Hello, could you please provide a written estimate for the repair work we discussed? Thank you."
          : "Hello, could you please inspect the water-damaged area and let me know what you find? Thank you.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [claim.claimId] }],
        preservedUncertainties: [...knowledge.uncertainties],
      },
      generationProvenance: PROVENANCE,
      groundingProvenance: PROVENANCE,
    };
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForCompletion(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("M3 test Run did not complete.");
}

async function establishKnowledge(app: FastifyInstance, conversationId: string): Promise<{ knowledgeId: string; intentVersionId: string }> {
  const message = "Help me establish what the inspection record says about the damaged area.";
  const turn = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(turn.statusCode, 202, turn.body);
  const accepted = turn.json<{ runId: string; intentVersionId: string; interpretation: { requestedHelp: string } }>();
  assert.equal(accepted.interpretation.requestedHelp, "KNOWLEDGE");
  await waitForCompletion(app, accepted.runId);
  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  const established = outcome.json<{ outcome: { kind: string }; knowledgeReference: { knowledgeId: string } }>();
  assert.equal(established.outcome.kind, "KNOWLEDGE");
  return { knowledgeId: established.knowledgeReference.knowledgeId, intentVersionId: accepted.intentVersionId };
}

async function prepareMessage(
  app: FastifyInstance,
  conversationId: string,
  message: string,
): Promise<{ runId: string; body: string; resourceId: string; intentVersionId: string; knowledgeIds: string[] }> {
  const turn = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(turn.statusCode, 202, turn.body);
  const accepted = turn.json<{ runId: string; intentVersionId: string; interpretation: { requestedHelp: string } }>();
  assert.equal(accepted.interpretation.requestedHelp, "RESOURCE");
  await waitForCompletion(app, accepted.runId);
  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  const body = outcome.json<{
    outcome: {
      kind: string;
      resource: {
        kind: string;
        body: string;
        editable: boolean;
        executionAuthorized: boolean;
        basis: Array<{ knowledgeId: string; claimIds: string[] }>;
      };
    };
    preparationReference: {
      resourceId: string;
      intentVersionId: string;
      knowledgeIds: string[];
      claimIds: string[];
      editable: boolean;
      executionAuthorized: boolean;
    };
  }>();
  assert.equal(body.outcome.kind, "ACTION_PREPARATION");
  assert.equal(body.outcome.resource.kind, "PREPARED_MESSAGE");
  assert.equal(body.outcome.resource.editable, true);
  assert.equal(body.outcome.resource.executionAuthorized, false);
  assert.equal(body.preparationReference.executionAuthorized, false);
  assert.equal(body.preparationReference.editable, true);
  assert.equal(body.preparationReference.intentVersionId, accepted.intentVersionId);
  assert.ok(body.outcome.resource.basis.length > 0);
  assert.ok(body.preparationReference.claimIds.length > 0);
  return {
    runId: accepted.runId,
    body: body.outcome.resource.body,
    resourceId: body.preparationReference.resourceId,
    intentVersionId: accepted.intentVersionId,
    knowledgeIds: body.preparationReference.knowledgeIds,
  };
}

test("ordinary Solandra RESOURCE conversation produces a task-specific governed editable message without a prepare API field", async () => {
  const cognition = new M3Cognition();
  const preparer = new M3Preparer();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraActionPreparer: preparer,
  });
  try {
    const conversationId = await createConversation(app);
    const established = await establishKnowledge(app, conversationId);
    const request = "Draft a short message to my landlord asking them to inspect the water damage, using what we established.";
    const prepared = await prepareMessage(app, conversationId, request);
    assert.match(prepared.body, /inspect the water-damaged area/iu);
    assert.doesNotMatch(prepared.body, /^Objective:/u);
    assert.ok(prepared.knowledgeIds.includes(established.knowledgeId));
    assert.equal(preparer.inputs.length, 1);
    assert.equal(preparer.inputs[0]?.userMessage, request);
    assert.equal(preparer.inputs[0]?.intentVersionId, prepared.intentVersionId);
    assert.ok(preparer.inputs[0]?.knowledge.some((item) => item.knowledgeId === established.knowledgeId));

    const replay = await app.inject({ method: "GET", url: `/api/v1/runs/${prepared.runId}/outcome` });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json<{ outcome: { resource: { body: string } } }>().outcome.resource.body, prepared.body);
    assert.equal(preparer.inputs.length, 1, "historical preparation replay must reuse the durable PreparedResource");

    const presentation = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation`,
    });
    assert.equal(presentation.statusCode, 200, presentation.body);
    const snapshot = presentation.json<{
      presentation: {
        presentationRevision: string;
        resources: Array<{ id: string; editable?: boolean; executionAuthorized?: boolean }>;
      };
    }>().presentation;
    assert.equal(snapshot.resources.length, 1);
    assert.equal(snapshot.resources[0]?.editable, true);
    assert.equal(snapshot.resources[0]?.executionAuthorized, false);
    const resourceId = snapshot.resources[0]?.id;
    assert.ok(resourceId);
    const hydrated = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation/resources/${encodeURIComponent(resourceId)}?presentationRevision=${encodeURIComponent(snapshot.presentationRevision)}`,
    });
    assert.equal(hydrated.statusCode, 200, hydrated.body);
    const resource = hydrated.json<{
      resource: { descriptor: { editable?: boolean; executionAuthorized?: boolean }; payload: { text: string } };
    }>().resource;
    assert.equal(resource.descriptor.editable, true);
    assert.equal(resource.descriptor.executionAuthorized, false);
    assert.equal(resource.payload.text, prepared.body);
  } finally {
    await app.close();
  }
});

test("materially different ordinary message requests reach preparation with different task purposes", async () => {
  const cognition = new M3Cognition();
  const preparer = new M3Preparer();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraActionPreparer: preparer,
  });
  try {
    const leftConversation = await createConversation(app);
    await establishKnowledge(app, leftConversation);
    const left = await prepareMessage(
      app,
      leftConversation,
      "Draft a short message to my landlord asking them to inspect the water damage.",
    );

    const rightConversation = await createConversation(app);
    await establishKnowledge(app, rightConversation);
    const right = await prepareMessage(
      app,
      rightConversation,
      "Write a brief message to my contractor asking for a written repair estimate.",
    );

    assert.notEqual(left.body, right.body);
    assert.match(left.body, /inspect/iu);
    assert.match(right.body, /written estimate/iu);
    assert.equal(preparer.inputs.length, 2);
    assert.notEqual(preparer.inputs[0]?.userMessage, preparer.inputs[1]?.userMessage);
  } finally {
    await app.close();
  }
});

test("unsupported ordinary RESOURCE scope fails honestly instead of returning generic preparation", async () => {
  const cognition = new M3Cognition();
  const preparer = new M3Preparer();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraActionPreparer: preparer,
  });
  try {
    const conversationId = await createConversation(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Prepare a spreadsheet I can use to track repair costs." },
    });
    assert.equal(response.statusCode, 422, response.body);
    const body = response.json<{ error: string; message: string }>();
    assert.equal(body.error, "RESOURCE_SCOPE_UNSUPPORTED");
    assert.match(body.message, /editable message/iu);
    assert.equal(preparer.inputs.length, 0);

    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.equal(continuity.json<{ runs: unknown[] }>().runs.length, 0);
  } finally {
    await app.close();
  }
});

function runtimeResult(text: string): any {
  return {
    response: {
      id: randomUUID(),
      model: "m3-deterministic-model",
      output: [{ type: "text", text }],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "stop",
      providerMetadata: {},
    },
    audit: { invocationProvenance: PROVENANCE },
  };
}

class ScriptedRuntime {
  readonly calls: unknown[] = [];
  constructor(private readonly outputs: string[]) {}
  async call(request: unknown): Promise<any> {
    this.calls.push(structuredClone(request));
    const next = this.outputs.shift();
    assert.ok(next, "scripted runtime output exhausted");
    return runtimeResult(next);
  }
}

const preparationInput: SolandraActionPreparationInput = {
  conversationId: "conversation-m3",
  runId: "11111111-1111-4111-8111-111111111111",
  intentVersionId: "intent-version-m3",
  userMessageId: "message-m3",
  userMessage: "Draft a message asking my landlord to inspect the water damage.",
  authoritativeObjective: "Address the documented water damage responsibly.",
  knowledge: [{
    knowledgeId: "knowledge-m3",
    objective: "Address the documented water damage responsibly.",
    findings: [{ claimId: "claim-m3", text: FINDING, status: "SUPPORTED" }],
    sourceCount: 1,
    uncertainties: ["The inspection record does not establish the cause of the water damage."],
  }],
};

test("model Action Preparation rejects invented governed claim references before grounding", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Hello, please inspect the water damage.",
      basis: [{ knowledgeId: "knowledge-m3", claimIds: ["invented-claim"] }],
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime as unknown as Pick<ModelRuntime, "call">, "m3-deterministic-model");
  const result = await preparer.prepare(preparationInput);
  assert.equal(result.result.status, "FIDELITY_REJECTED");
  assert.equal(runtime.calls.length, 1, "invalid provenance must fail before grounding");
});

test("model Action Preparation fails closed on unsupported factual generation", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Hello, you already agreed to pay for all repairs, so please inspect the water damage.",
      basis: [{ knowledgeId: "knowledge-m3", claimIds: ["claim-m3"] }],
    }),
    JSON.stringify({
      status: "UNSUPPORTED",
      unsupportedExternalPremises: ["The recipient agreed to pay for all repairs."],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime as unknown as Pick<ModelRuntime, "call">, "m3-deterministic-model");
  const result = await preparer.prepare(preparationInput);
  assert.equal(result.result.status, "FIDELITY_REJECTED");
  assert.equal(runtime.calls.length, 2);
});

test("model Action Preparation fails closed when material uncertainty would disappear", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Hello, the water damage was caused by the roof, so please inspect it.",
      basis: [{ knowledgeId: "knowledge-m3", claimIds: ["claim-m3"] }],
    }),
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      materialUncertaintyPreserved: false,
      authorityBoundaryPreserved: true,
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime as unknown as Pick<ModelRuntime, "call">, "m3-deterministic-model");
  const result = await preparer.prepare(preparationInput);
  assert.equal(result.result.status, "FIDELITY_REJECTED");
});
