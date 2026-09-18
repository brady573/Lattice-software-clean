import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type { IntentUserMessage } from "../src/intent/source-message-store.js";
import type { IntentVersion } from "../src/intent/types.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import {
  establishConversationalRecommendation,
} from "../src/recommendation/recommendation-continuity.js";
import { MemoryRecommendationStore } from "../src/recommendation/recommendation-store.js";
import type {
  SolandraAdvisoryInput,
  SolandraAdvisoryRuntime,
  SolandraAdvisoryRuntimeResult,
  SolandraRecommendationResult,
} from "../src/solandra/advisory.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue91-context-fixture",
  requestedModel: "issue91-context-fixture",
  actualProvider: "issue91-context-fixture",
  actualModel: "issue91-context-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue91-context-fixture",
  routeProvenance: "COMPLETE",
});

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-context-user",
} as NodeJS.ProcessEnv);

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "DECISION",
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
    ...overrides,
  };
}

type CognitionStep =
  | "CONVERSATION"
  | Readonly<{ objectiveRelation: "NEW_OBJECTIVE" | "CONTINUE"; requestedHelp?: "DECISION" }>;

class SequencedCognition implements SolandraCognitiveRuntime {
  private index = 0;

  constructor(private readonly steps: readonly CognitionStep[]) {}

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const step = this.steps[this.index++];
    assert.ok(step, "unexpected cognition call");
    if (step === "CONVERSATION") {
      return {
        mode: "CONVERSATION",
        response: "I understand that context.",
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: step.objectiveRelation,
        proposedObjective: step.objectiveRelation === "NEW_OBJECTIVE" ? input.message : null,
        requestedHelp: step.requestedHelp ?? "DECISION",
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class ExactContextAdvisory implements SolandraAdvisoryRuntime {
  readonly calls: SolandraAdvisoryInput[] = [];

  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    this.calls.push(structuredClone(input));
    const premiseIds = input.userContextMessages?.map((message) => message.messageId) ?? [input.userMessageId];
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Choose the option that best matches the USER-stated priority.",
        basis: [],
        rationale: ["This is advisory judgment over exact USER-authored context."],
        tradeoffs: [],
        assumptions: [],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Keep both options open until the USER wants to choose."],
        userPremiseMessageIds: premiseIds,
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

async function createConversation(app: Awaited<ReturnType<typeof createRuntimeApp>>): Promise<string> {
  const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(created.statusCode, 201, created.body);
  return created.json().conversation.id as string;
}

async function postTurn(
  app: Awaited<ReturnType<typeof createRuntimeApp>>,
  conversationId: string,
  turnId: string,
  message: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId, message },
  });
}

test("Issue #91: ordinary pronoun/coreference reaches advisory with exact prior USER source lineage", async () => {
  const advisory = new ExactContextAdvisory();
  const cognition = new SequencedCognition(["CONVERSATION", "CONVERSATION", { objectiveRelation: "NEW_OBJECTIVE" }]);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, solandraCognition: cognition, solandraAdvisory: advisory });
  try {
    const conversationId = await createConversation(app);
    const optionMessage = "For the balcony, I am choosing between the cedar bench and the folding stool.";
    const priorityMessage = "I care more about easy storage than appearance.";
    const followupMessage = "Which one fits that better?";

    assert.equal((await postTurn(app, conversationId, "coref-1", optionMessage)).statusCode, 200);
    assert.equal((await postTurn(app, conversationId, "coref-2", priorityMessage)).statusCode, 200);
    const decision = await postTurn(app, conversationId, "coref-3", followupMessage);
    assert.equal(decision.statusCode, 200, decision.body);
    assert.equal(decision.json().status, "RECOMMENDATION_ESTABLISHED");

    const advisoryInput = advisory.calls[0];
    assert.ok(advisoryInput);
    assert.deepEqual(advisoryInput.userContextMessages?.map((message) => message.content), [
      optionMessage,
      priorityMessage,
      followupMessage,
    ]);

    const recommendationId = decision.json().recommendationReference.recommendationId as string;
    const loaded = await app.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(loaded.statusCode, 200, loaded.body);
    const expectedIds = new Set(advisoryInput.userContextMessages?.map((message) => message.messageId));
    const premiseIds = loaded.json().premiseAuthority.user.map((item: { sourceMessageId: string }) => item.sourceMessageId);
    assert.deepEqual(new Set(premiseIds), expectedIds);
    assert.equal(loaded.json().sourceMessageId, advisoryInput.userMessageId);
  } finally {
    await app.close();
  }
});

test("Issue #91: elliptical advisory follow-up keeps bounded exact USER context without reconstructed Intent", async () => {
  const advisory = new ExactContextAdvisory();
  const cognition = new SequencedCognition(["CONVERSATION", "CONVERSATION", { objectiveRelation: "NEW_OBJECTIVE" }]);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, solandraCognition: cognition, solandraAdvisory: advisory });
  try {
    const conversationId = await createConversation(app);
    const first = "I can schedule the studio session before lunch or after dinner.";
    const second = "The quieter time matters more to me than finishing early.";
    const followup = "And if I need an hour to set up?";

    assert.equal((await postTurn(app, conversationId, "ellipsis-1", first)).statusCode, 200);
    assert.equal((await postTurn(app, conversationId, "ellipsis-2", second)).statusCode, 200);
    const decision = await postTurn(app, conversationId, "ellipsis-3", followup);
    assert.equal(decision.statusCode, 200, decision.body);
    assert.equal(decision.json().status, "RECOMMENDATION_ESTABLISHED");
    assert.deepEqual(advisory.calls[0]?.userContextMessages?.map((message) => message.content), [first, second, followup]);
    assert.equal(decision.json().interpretation.requestedHelp, "DECISION");
  } finally {
    await app.close();
  }
});

test("Issue #91: a governed NEW_OBJECTIVE does not carry prior-topic USER messages into a new Recommendation premise", async () => {
  const advisory = new ExactContextAdvisory();
  const cognition = new SequencedCognition([
    { objectiveRelation: "NEW_OBJECTIVE" },
    { objectiveRelation: "NEW_OBJECTIVE" },
  ]);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, solandraCognition: cognition, solandraAdvisory: advisory });
  try {
    const conversationId = await createConversation(app);
    const firstTopic = "Help me choose a weekly watering reminder for the herb shelf.";
    const newTopic = "Now help me choose a desk-lamp shape for the workshop.";

    const first = await postTurn(app, conversationId, "topic-1", firstTopic);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().status, "RECOMMENDATION_ESTABLISHED");

    const second = await postTurn(app, conversationId, "topic-2", newTopic);
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(advisory.calls.length, 2);
    assert.deepEqual(advisory.calls[1]?.userContextMessages?.map((message) => message.content), [newTopic]);

    const recommendationId = second.json().recommendationReference.recommendationId as string;
    const loaded = await app.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(loaded.statusCode, 200, loaded.body);
    assert.deepEqual(
      loaded.json().premiseAuthority.user.map((item: { sourceMessageId: string }) => item.sourceMessageId),
      [loaded.json().sourceMessageId],
    );
  } finally {
    await app.close();
  }
});

test("Issue #91: conversational Recommendation fails closed when advisory invents USER premise lineage", async () => {
  const store = new MemoryRecommendationStore();
  const intentVersionId = "issue91-lineage-intent-v1";
  const intentScopeId = "consultation:issue91-lineage";
  const prior: IntentUserMessage = {
    conversationId: "issue91-lineage",
    intentScopeId,
    logicalUserTurnId: "lineage-turn-1",
    messageId: "lineage-message-1",
    messageHorizon: 1,
    content: "I prefer the smaller tray.",
    origin: "USER",
    contentDigest: "a".repeat(64),
    createdAt: "2026-09-18T00:00:00.000Z",
  };
  const sourceMessage: IntentUserMessage = {
    conversationId: "issue91-lineage",
    intentScopeId,
    logicalUserTurnId: "lineage-turn-2",
    messageId: "lineage-message-2",
    messageHorizon: 2,
    content: "Which one should I use?",
    origin: "USER",
    contentDigest: "b".repeat(64),
    createdAt: "2026-09-18T00:01:00.000Z",
  };
  const intentVersion: IntentVersion = {
    intentScopeId,
    intentVersionId,
    version: 1,
    predecessorIntentVersionId: null,
    transitionId: "lineage-transition-1",
    lineageKind: "INITIAL",
    lineageTargetIntentVersionId: null,
    state: {
      objective: {
        value: { state: "VALUE", value: sourceMessage.content },
        provenance: {
          kind: "EXPLICIT_USER",
          logicalUserTurnId: sourceMessage.logicalUserTurnId,
          sourceMessageId: sourceMessage.messageId,
          sourceDigest: sourceMessage.contentDigest,
        },
      },
      requirements: {},
      preferences: {},
    },
    createdAt: sourceMessage.createdAt,
  };
  const advisory: SolandraRecommendationResult = {
    status: "RECOMMENDATION",
    recommendation: "Use the smaller tray.",
    basis: [],
    rationale: ["Advisory judgment over USER material."],
    tradeoffs: [],
    assumptions: [],
    uncertainties: [],
    preservedUncertainties: [],
    alternatives: ["Keep both available."],
    userPremiseMessageIds: [prior.messageId, "invented-message-id", sourceMessage.messageId],
  };

  try {
    await assert.rejects(
      establishConversationalRecommendation({
        store,
        conversationId: sourceMessage.conversationId,
        intentVersion,
        sourceMessage,
        userMessages: [prior, sourceMessage],
        knowledge: [],
        advisory,
      }),
      /USER premise lineage referenced material outside supplied exact USER source messages/u,
    );

    const { userPremiseMessageIds: _omitted, ...withoutPremiseLineage } = advisory;
    await assert.rejects(
      establishConversationalRecommendation({
        store,
        conversationId: sourceMessage.conversationId,
        intentVersion,
        sourceMessage,
        userMessages: [prior, sourceMessage],
        knowledge: [],
        advisory: withoutPremiseLineage,
      }),
      /multi-message USER context omitted exact USER premise lineage/u,
    );
  } finally {
    await store.close();
  }
});
