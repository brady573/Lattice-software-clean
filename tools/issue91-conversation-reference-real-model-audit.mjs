import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";

const setupMessage = "Help me choose between a lightweight routine and a more structured weekly routine.";
const referenceMessages = [
  "Can you walk me through the reasoning behind your earlier recommendation?",
  "And could you unpack the alternative in position two?",
  "Make the alternative we were just discussing my choice.",
];

const fixtureProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "conversation-reference-audit-fixture",
  requestedModel: "conversation-reference-audit-fixture",
  actualProvider: "conversation-reference-audit-fixture",
  actualModel: "conversation-reference-audit-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "conversation-reference-audit-fixture",
  routeProvenance: "COMPLETE",
});

function setupProjection() {
  return {
    objectiveRelation: "NEW_OBJECTIVE",
    proposedObjective: setupMessage,
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
  };
}

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-conversation-reference-audit",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const configured = createConfiguredSolandraCognition(config);
assert.ok(configured, "Configured Solandra cognition route is unavailable.");

const modelObservations = [];
const hybridCognition = {
  async interpret(input) {
    if (input.message === setupMessage) {
      return {
        mode: "GOVERNED",
        proposal: setupProjection(),
        invocationProvenance: fixtureProvenance,
      };
    }
    const result = await configured.cognition.interpret(input);
    modelObservations.push({
      message: input.message,
      suppliedKnowledgeIds: input.governedKnowledge.map((item) => item.knowledgeId),
      suppliedRecommendations: (input.governedRecommendations ?? []).map((item) => ({
        recommendationId: item.recommendationId,
        optionIds: item.options.map((option) => option.optionId),
      })),
      result,
    });
    return result;
  },
};

const advisory = {
  async advise() {
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Use the lightweight routine.",
        basis: [],
        rationale: ["The user asked to choose between the two routines."],
        tradeoffs: [],
        assumptions: [],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Use the structured weekly routine."],
      },
      invocationProvenance: fixtureProvenance,
    };
  },
};

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  solandraCognition: hybridCognition,
  solandraAdvisory: advisory,
  solandraKnowledgePresenter: configured.knowledgePresenter,
});

const artifact = {
  product: {
    sha: process.env.EXPECTED_PRODUCT_SHA ?? null,
    tree: process.env.EXPECTED_PRODUCT_TREE ?? null,
  },
  setup: {},
  references: [],
  continuity: null,
  classification: {},
};

try {
  const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(created.statusCode, 201, created.body);
  const conversationId = created.json().conversation.id;

  const setup = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: "reference-audit-setup", message: setupMessage },
  });
  assert.equal(setup.statusCode, 200, setup.body);
  const setupBody = setup.json();
  assert.equal(setupBody.status, "RECOMMENDATION_ESTABLISHED", setup.body);
  const recommendationId = setupBody.recommendationReference.recommendationId;
  const options = setupBody.recommendationReference.options;
  assert.equal(options.length, 2, setup.body);
  const secondOptionId = options[1].optionId;
  artifact.setup = {
    conversationId,
    recommendationId,
    optionIds: options.map((item) => item.optionId),
    status: setupBody.status,
    selectionAuthorized: setupBody.recommendationReference.selectionAuthorized,
  };

  const runsBefore = (await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` })).json().runs.length;

  for (const [index, message] of referenceMessages.entries()) {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: `reference-audit-${index + 1}`, message },
    });
    const body = response.json();
    artifact.references.push({
      message,
      httpStatus: response.statusCode,
      status: body.status ?? null,
      error: body.error ?? null,
      interpretation: body.interpretation ?? null,
      recommendationReference: body.recommendationReference ?? null,
      optionReference: body.optionReference ?? null,
      acceptedChoice: body.acceptedChoice ?? null,
      assistantMessage: body.presentation?.assistantMessage ?? null,
    });
  }

  const continuityResponse = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
  assert.equal(continuityResponse.statusCode, 200, continuityResponse.body);
  const continuity = continuityResponse.json();
  artifact.continuity = {
    runCountBeforeReferences: runsBefore,
    runCountAfterReferences: continuity.runs.length,
    knowledgeReferenceCount: continuity.references.length,
    recommendationCount: continuity.recommendations.length,
    acceptedChoices: continuity.acceptedChoices,
    messages: continuity.messages,
  };

  const explain = artifact.references[0];
  const option = artifact.references[1];
  const choice = artifact.references[2];
  artifact.classification = {
    recommendationExactReference: explain?.status === "RECOMMENDATION_REFERENCE_RESOLVED"
      && explain?.recommendationReference?.recommendationId === recommendationId,
    optionExactReference: option?.status === "OPTION_REFERENCE_RESOLVED"
      && option?.recommendationReference?.recommendationId === recommendationId
      && option?.optionReference?.optionId === secondOptionId,
    choiceExactReference: choice?.status === "ACCEPTED_CHOICE_ESTABLISHED"
      && choice?.recommendationReference?.recommendationId === recommendationId
      && choice?.optionReference?.optionId === secondOptionId
      && choice?.acceptedChoice?.recommendationId === recommendationId
      && choice?.acceptedChoice?.optionId === secondOptionId,
    choiceNotAuthorization: choice?.acceptedChoice?.authorizationGranted === false
      && choice?.acceptedChoice?.executionAuthorized === false,
    noFreshRunForReferenceTurns: continuity.runs.length === runsBefore,
    generalReferenceRowsPresent: continuity.references.some((reference) =>
      Object.hasOwn(reference, "recommendationId")
      || Object.hasOwn(reference, "optionId")
      || Object.hasOwn(reference, "acceptedChoiceId")),
    governedReferenceResponsesInConversationHistory: continuity.messages.some((message) =>
      message.role === "SOLANDRA" && referenceMessages.some((referenceMessage) => message.content?.includes(referenceMessage))),
  };
  artifact.modelObservations = modelObservations;

  console.log(`ISSUE91_CONVERSATION_REFERENCE_AUDIT=${JSON.stringify(artifact)}`);
} finally {
  await app.close();
  const outputDirectory = resolve(process.env.DIAGNOSTIC_ARTIFACT_DIR ?? "artifacts/issue91-conversation-reference-audit");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "evidence.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}
