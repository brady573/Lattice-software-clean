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
import {
  projectAdvisoryTransientCognition,
  type SolandraAdvisoryInput,
  type SolandraAdvisoryRuntime,
  type SolandraAdvisoryRuntimeResult,
  type SolandraRecommendationResult,
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
  | Readonly<{
    objectiveRelation: "NEW_OBJECTIVE" | "CONTINUE";
    requestedHelp?: "DECISION";
    proposal?: Omit<Partial<SolandraSemanticProposal>, "objectiveRelation" | "requestedHelp">;
  }>;

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
        ...(step.proposal ?? {}),
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


test("Issue #91: resolved transient coreference reaches advisory without replacing the exact USER objective", async () => {
  const advisory = new ExactContextAdvisory();
  const followup = "Which would you choose?";
  const resolvedObjective = "Choose between the museum membership and the climbing gym pass, prioritizing a quiet weekend activity.";
  const cognition = new SequencedCognition([
    "CONVERSATION",
    "CONVERSATION",
    {
      objectiveRelation: "NEW_OBJECTIVE",
      proposal: {
        proposedObjective: resolvedObjective,
        relevantContext: ["The USER is choosing between a museum membership and a climbing gym pass."],
        entities: ["museum membership", "climbing gym pass"],
        referents: ["Which = the two previously stated options"],
        preferences: ["quiet weekend activity matters more than exercise"],
      },
    },
  ]);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: cognition,
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    assert.equal((await postTurn(
      app,
      conversationId,
      "transient-coref-1",
      "I can buy a museum membership or a climbing gym pass for my weekends.",
    )).statusCode, 200);
    assert.equal((await postTurn(
      app,
      conversationId,
      "transient-coref-2",
      "I value a quiet weekend activity more than getting extra exercise.",
    )).statusCode, 200);

    const decision = await postTurn(app, conversationId, "transient-coref-3", followup);
    assert.equal(decision.statusCode, 200, decision.body);
    assert.equal(decision.json().status, "RECOMMENDATION_ESTABLISHED");

    const input = advisory.calls[0];
    assert.ok(input);
    assert.equal(input.authoritativeObjective, followup);
    assert.equal(input.transientCognition?.proposedObjective, resolvedObjective);
    assert.deepEqual(input.transientCognition?.entities, ["museum membership", "climbing gym pass"]);
    assert.notEqual(input.transientCognition?.proposedObjective, input.authoritativeObjective);

    const recommendationId = decision.json().recommendationReference.recommendationId as string;
    const loaded = await app.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(loaded.statusCode, 200, loaded.body);
    const exactMessageIds = new Set(input.userContextMessages?.map((message) => message.messageId));
    assert.deepEqual(
      new Set(loaded.json().premiseAuthority.user.map((item: { sourceMessageId: string }) => item.sourceMessageId)),
      exactMessageIds,
    );
  } finally {
    await app.close();
  }
});

test("Issue #91: resolved transient ellipsis survives into advisory without becoming canonical Intent", async () => {
  const advisory = new ExactContextAdvisory();
  const followup = "And when I'm traveling?";
  const resolvedObjective = "Choose between the home NAS and portable SSD for photo backup while traveling.";
  const cognition = new SequencedCognition([
    "CONVERSATION",
    {
      objectiveRelation: "NEW_OBJECTIVE",
      proposal: {
        proposedObjective: resolvedObjective,
        relevantContext: ["The prior comparison is home NAS versus portable SSD for photo backup."],
        entities: ["home NAS", "portable SSD", "photo backup"],
        referents: ["when traveling = the same backup choice in a travel context"],
      },
    },
  ]);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: cognition,
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    assert.equal((await postTurn(
      app,
      conversationId,
      "transient-ellipsis-1",
      "For photo backup I can use my home NAS or carry a portable SSD.",
    )).statusCode, 200);

    const decision = await postTurn(app, conversationId, "transient-ellipsis-2", followup);
    assert.equal(decision.statusCode, 200, decision.body);
    const input = advisory.calls[0];
    assert.equal(input?.authoritativeObjective, followup);
    assert.equal(input?.transientCognition?.proposedObjective, resolvedObjective);
    assert.deepEqual(input?.transientCognition?.referents, [
      "when traveling = the same backup choice in a travel context",
    ]);
  } finally {
    await app.close();
  }
});

test("Issue #91: resolved contextual preference reaches advisory as transient meaning only", async () => {
  const advisory = new ExactContextAdvisory();
  const followup = "What would you recommend?";
  const cognition = new SequencedCognition([
    "CONVERSATION",
    "CONVERSATION",
    {
      objectiveRelation: "NEW_OBJECTIVE",
      proposal: {
        proposedObjective: "Recommend between the window fan and portable air purifier using the USER's pollen-reduction priority.",
        relevantContext: ["The USER is comparing a window fan with a portable air purifier."],
        entities: ["window fan", "portable air purifier"],
        preferences: ["reducing pollen matters more than cooling"],
      },
    },
  ]);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: cognition,
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    assert.equal((await postTurn(
      app,
      conversationId,
      "transient-preference-1",
      "For the bedroom I am choosing between a window fan and a portable air purifier.",
    )).statusCode, 200);
    assert.equal((await postTurn(
      app,
      conversationId,
      "transient-preference-2",
      "I care most about reducing pollen; cooling is secondary.",
    )).statusCode, 200);

    const decision = await postTurn(app, conversationId, "transient-preference-3", followup);
    assert.equal(decision.statusCode, 200, decision.body);
    assert.equal(advisory.calls[0]?.authoritativeObjective, followup);
    assert.deepEqual(advisory.calls[0]?.transientCognition?.preferences, [
      "reducing pollen matters more than cooling",
    ]);
  } finally {
    await app.close();
  }
});

test("Issue #91: a genuine new decision does not inherit transient cognition or USER premise context from the prior objective", async () => {
  const advisory = new ExactContextAdvisory();
  const firstObjective = "Help me choose between a chain lock and a U-lock for my bicycle.";
  const secondObjective = "Now help me choose between spiral and stitched binding for a field notebook.";
  const cognition = new SequencedCognition([
    {
      objectiveRelation: "NEW_OBJECTIVE",
      proposal: {
        proposedObjective: "Choose between a chain lock and a U-lock for the bicycle.",
        entities: ["chain lock", "U-lock", "bicycle"],
      },
    },
    {
      objectiveRelation: "NEW_OBJECTIVE",
      proposal: {
        proposedObjective: "Choose between spiral and stitched binding for a field notebook.",
        entities: ["spiral binding", "stitched binding", "field notebook"],
      },
    },
  ]);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: cognition,
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    assert.equal((await postTurn(app, conversationId, "transient-topic-1", firstObjective)).statusCode, 200);
    assert.equal((await postTurn(app, conversationId, "transient-topic-2", secondObjective)).statusCode, 200);
    assert.equal(advisory.calls.length, 2);

    const second = advisory.calls[1];
    assert.ok(second);
    assert.deepEqual(second.userContextMessages?.map((message) => message.content), [secondObjective]);
    assert.deepEqual(second.transientCognition?.entities, [
      "spiral binding",
      "stitched binding",
      "field notebook",
    ]);
    assert.doesNotMatch(JSON.stringify(second.transientCognition), /chain lock|U-lock|bicycle/u);
  } finally {
    await app.close();
  }
});

test("Issue #91: transient advisory projection excludes governed identity and authority-bearing cognition fields", () => {
  const projected = projectAdvisoryTransientCognition(proposal({
    proposedObjective: "Choose the smaller notebook.",
    requestedHelp: "ACCEPT_CHOICE",
    relevantContext: ["The USER mentioned two notebook sizes."],
    entities: ["small notebook", "large notebook"],
    referents: ["that one"],
    constraints: ["must fit in a coat pocket"],
    preferences: ["smaller is preferred"],
    knowledgeNeeds: ["invented external fact"],
    materialAmbiguity: { question: "invented ambiguity", couldChangeObjective: true },
    referencedKnowledgeId: "invented-knowledge",
    referencedRecommendationId: "invented-recommendation",
    referencedOptionId: "invented-option",
    referencedIntentProposalId: "invented-intent-proposal",
  }));

  assert.deepEqual(Object.keys(projected).sort(), [
    "constraints",
    "entities",
    "objectiveRelation",
    "preferences",
    "proposedObjective",
    "referents",
    "relevantContext",
  ]);
  assert.equal("requestedHelp" in projected, false);
  assert.equal("knowledgeNeeds" in projected, false);
  assert.equal("materialAmbiguity" in projected, false);
  assert.equal("referencedKnowledgeId" in projected, false);
  assert.equal("referencedRecommendationId" in projected, false);
  assert.equal("referencedOptionId" in projected, false);
  assert.equal("referencedIntentProposalId" in projected, false);
});

test("Issue #91: invented transient cognition cannot create USER, Knowledge, choice, action, or execution authority", async () => {
  const advisory = new ExactContextAdvisory();
  const userMessage = "Help me choose whether to take paper or digital notes for tomorrow's workshop.";
  const cognition = new SequencedCognition([{
    objectiveRelation: "NEW_OBJECTIVE",
    proposal: {
      proposedObjective: "Transfer funds, accept an invented choice, and execute it.",
      relevantContext: ["invented model reconstruction"],
      entities: ["invented-user-premise", "invented-knowledge", "invented-authorization"],
      constraints: ["execution already verified"],
      referencedKnowledgeId: "invented-knowledge",
      referencedRecommendationId: "invented-recommendation",
      referencedOptionId: "invented-option",
      referencedIntentProposalId: "invented-intent",
    },
  }]);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: cognition,
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    const decision = await postTurn(app, conversationId, "transient-authority-1", userMessage);
    assert.equal(decision.statusCode, 200, decision.body);
    const body = decision.json();
    assert.equal(body.status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(body.recommendationReference.selectionAuthorized, false);

    const input = advisory.calls[0];
    assert.ok(input?.transientCognition);
    assert.equal("referencedKnowledgeId" in input.transientCognition, false);
    assert.equal("referencedRecommendationId" in input.transientCognition, false);
    assert.equal("referencedOptionId" in input.transientCognition, false);

    const recommendationId = body.recommendationReference.recommendationId as string;
    const loaded = await app.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(loaded.statusCode, 200, loaded.body);
    const record = loaded.json();
    assert.deepEqual(record.premiseAuthority.knowledge, []);
    assert.deepEqual(record.premiseAuthority.user, [{
      intentVersionId: record.intentVersionId,
      sourceMessageId: record.sourceMessageId,
    }]);
    assert.equal(record.selectionAuthorized, false);
    assert.equal("acceptedChoiceId" in record, false);
    assert.equal("authorizationId" in record, false);
    assert.equal("executionId" in record, false);
    assert.equal("verificationId" in record, false);
  } finally {
    await app.close();
  }
});
