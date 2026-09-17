import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { ModelProviderError } from "../src/model/errors.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelInvocationProvenance,
  ModelProviderResult,
} from "../src/model/types.js";
import {
  ModelSolandraCognitiveRuntime,
  type SolandraCognitionInput,
  type SolandraCognitionResult,
  type SolandraCognitiveRuntime,
  type SolandraSemanticProposal,
} from "../src/solandra/cognition.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-91-natural-confirmation-fixture",
  requestedModel: "issue-91-natural-confirmation-fixture",
  actualProvider: "issue-91-natural-confirmation-fixture",
  actualModel: "issue-91-natural-confirmation-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-91-natural-confirmation-fixture-request",
  routeProvenance: "COMPLETE",
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
    referencedOptionId: null,
    referencedIntentProposalId: null,
    ...overrides,
  };
}

class NaturalConfirmationCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];
  readonly correctedObjective: string;

  constructor(correctedObjective: string) {
    this.correctedObjective = correctedObjective;
  }

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    if (input.pendingIntentProposal) {
      return {
        mode: "GOVERNED",
        proposal: proposal({
          objectiveRelation: "CONTINUE",
          requestedHelp: "CONFIRM_INTENT",
          referencedIntentProposalId: input.pendingIntentProposal.proposalId,
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (!input.currentObjective) {
      return {
        mode: "GOVERNED",
        proposal: proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: input.message }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      mode: "GOVERNED",
      proposal: proposal({ objectiveRelation: "CORRECTION", proposedObjective: this.correctedObjective }),
      invocationProvenance: PROVENANCE,
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

async function establishPendingCorrection(
  app: FastifyInstance,
  conversationId: string,
): Promise<{ proposalId: string; originalIntentVersionId: string }> {
  const first = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: {
      turnId: "initial-objective",
      message: "Help me plan a quiet reading corner for my apartment.",
    },
  });
  assert.equal(first.statusCode, 202, first.body);
  const originalIntentVersionId = first.json<{ intentVersionId: string }>().intentVersionId;

  const correction = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: {
      turnId: "material-correction",
      message: "Actually, make it work in the shared living room without taking over the whole space.",
    },
  });
  assert.equal(correction.statusCode, 202, correction.body);
  const body = correction.json<{
    status: string;
    proposalId: string;
    intentVersionId: string;
    acceptedUnderstanding: string;
  }>();
  assert.equal(body.status, "NEEDS_CLARIFICATION");
  assert.ok(body.proposalId);
  assert.equal(body.intentVersionId, originalIntentVersionId);
  assert.equal(body.acceptedUnderstanding, "Help me plan a quiet reading corner for my apartment.");
  return { proposalId: body.proposalId, originalIntentVersionId };
}

test("natural USER confirmation lets Solandra select the exact pending Intent proposal while Lattice commits it", async () => {
  const correctedObjective = "Plan a quiet reading corner that works in a shared living room without taking over the whole space.";
  const cognition = new NaturalConfirmationCognition(correctedObjective);
  const app = await createRuntimeApp(config, { solandraCognition: cognition, memoryDispatchDelayMs: 1_000 });
  try {
    const conversationId = await createConversation(app);
    const pending = await establishPendingCorrection(app, conversationId);
    assert.equal(cognition.inputs.length, 2);

    const naturalConfirmation = "Exactly — that captures the change I was trying to make.";
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "natural-confirmation",
        message: naturalConfirmation,
        clarificationProposalId: pending.proposalId,
      },
    });
    assert.equal(confirmed.statusCode, 202, confirmed.body);
    const body = confirmed.json<{
      status: string;
      proposalId: string;
      acceptedUnderstanding: string;
      intentVersionId: string;
      runId: string;
    }>();
    assert.equal(body.status, "RUN_ACCEPTED");
    assert.equal(body.proposalId, pending.proposalId);
    assert.equal(body.acceptedUnderstanding, correctedObjective);
    assert.notEqual(body.intentVersionId, pending.originalIntentVersionId);
    assert.ok(body.runId);

    const confirmationInput = cognition.inputs.at(-1);
    assert.ok(confirmationInput?.pendingIntentProposal);
    assert.equal(confirmationInput.pendingIntentProposal.proposalId, pending.proposalId);
    assert.match(confirmationInput.pendingIntentProposal.proposalDigest, /^[a-f0-9]{64}$/u);
    assert.equal(confirmationInput.pendingIntentProposal.operations.length, 1);
    assert.match(confirmationInput.pendingIntentProposal.operations[0] ?? "", /Plan a quiet reading corner that works in a shared living room/u);

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.ok(continuity.json().messages.some((message: { content: string }) => message.content === naturalConfirmation));

    const cognitionCallsBeforeReplay = cognition.inputs.length;
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "natural-confirmation",
        message: naturalConfirmation,
        clarificationProposalId: pending.proposalId,
      },
    });
    assert.equal(replay.statusCode, 202, replay.body);
    assert.equal(replay.json().runId, body.runId);
    assert.equal(replay.json().intentVersionId, body.intentVersionId);
    assert.equal(cognition.inputs.length, cognitionCallsBeforeReplay, "Exact replay must not invoke stochastic cognition again.");
  } finally {
    await app.close();
  }
});

test("explicit clarification confirmation endpoint treats endpoint selection as the confirmation act, not a phrase match", async () => {
  const correctedObjective = "Plan a quiet reading corner that works in a shared living room without taking over the whole space.";
  const cognition = new NaturalConfirmationCognition(correctedObjective);
  const app = await createRuntimeApp(config, { solandraCognition: cognition, memoryDispatchDelayMs: 1_000 });
  try {
    const conversationId = await createConversation(app);
    const pending = await establishPendingCorrection(app, conversationId);
    const explicit = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/clarifications/${pending.proposalId}/confirm`,
      payload: {
        turnId: "explicit-confirmation",
        message: "That is precisely the interpretation I want Lattice to use going forward.",
      },
    });
    assert.equal(explicit.statusCode, 202, explicit.body);
    assert.equal(explicit.json().proposalId, pending.proposalId);
    assert.equal(explicit.json().acceptedUnderstanding, correctedObjective);
    assert.notEqual(explicit.json().intentVersionId, pending.originalIntentVersionId);
    assert.equal(cognition.inputs.length, 2, "Explicit confirmation must not need a second semantic classifier.");
  } finally {
    await app.close();
  }
});

class WrongIntentReferenceProvider implements ModelProvider {
  readonly kind = "issue-91-wrong-intent-reference";

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "issue-91-wrong-intent-reference-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            mode: "GOVERNED",
            projection: proposal({
              requestedHelp: "CONFIRM_INTENT",
              referencedIntentProposalId: "invented-proposal-id",
            }),
          }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "issue-91-wrong-intent-reference-request",
      },
    };
  }
}

test("canonical Solandra cognition rejects confirmation of any Intent proposal identity Lattice did not supply", async () => {
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new WrongIntentReferenceProvider()),
    "issue-91-natural-confirmation-model",
  );
  await assert.rejects(
    cognition.interpret({
      conversationId: "issue-91-wrong-intent-reference",
      messageId: "issue-91-wrong-intent-reference-message",
      message: "Yes, that captures it.",
      currentObjective: "Plan a reading corner.",
      recentUserMessages: ["Plan a reading corner.", "Actually, make it work in our shared room."],
      governedKnowledge: [],
      pendingIntentProposal: {
        proposalId: "exact-pending-proposal",
        proposalDigest: "a".repeat(64),
        operations: [JSON.stringify({
          op: "SET",
          path: { kind: "OBJECTIVE" },
          value: { state: "VALUE", value: "Plan a reading corner that works in our shared room." },
        })],
      },
    }),
    (error: unknown) => error instanceof ModelProviderError
      && error.code === "invalid_output"
      && /Intent proposal that Lattice did not supply/u.test(error.message),
  );
});
