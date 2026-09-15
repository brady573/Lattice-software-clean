import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const productDir = resolve(process.env.PRODUCT_DIR ?? "product");
const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "artifacts/pr106-real-model");
const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");

const git = (...args) => execFileSync("git", ["-C", productDir, ...args], { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);

const importProduct = async (relativePath) => import(pathToFileURL(resolve(productDir, relativePath)).href);
const [
  { createRuntimeApp },
  { resolveRuntimeConfig },
  { createConfiguredSolandraCognition },
] = await Promise.all([
  importProduct("dist/src/runtime-app.js"),
  importProduct("dist/src/runtime-config.js"),
  importProduct("dist/src/solandra/cognition-composition.js"),
]);

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "pr106-real-model-discriminator",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
assert.equal(config.truthMode, "v36-offline");
assert.equal(config.solandraCognitionRoute, "groq-gpt-oss-120b");

const configured = createConfiguredSolandraCognition(config);
assert.ok(configured, "Configured Solandra composition is required.");
assert.ok(configured.model.trim(), "Configured Solandra model identity is required.");

const FIXTURE_PROVENANCE = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "pr106-validation-fixture",
  requestedModel: "pr106-validation-fixture",
  actualProvider: "pr106-validation-fixture",
  actualModel: "pr106-validation-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "pr106-validation-fixture",
  routeProvenance: "COMPLETE",
});

function proposal(overrides = {}) {
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

function sanitizedProvenance(value) {
  return {
    executionClass: value?.executionClass ?? null,
    routeMode: value?.routeMode ?? null,
    requestedProvider: value?.requestedProvider ?? null,
    requestedModel: value?.requestedModel ?? null,
    actualProvider: value?.actualProvider ?? null,
    actualModel: value?.actualModel ?? null,
    upstreamRequestId: value?.upstreamRequestId ?? null,
    routeProvenance: value?.routeProvenance ?? null,
  };
}

function sanitizedCognition(result) {
  if (result.mode === "CONVERSATION") {
    return {
      mode: "CONVERSATION",
      response: result.response,
      invocationProvenance: sanitizedProvenance(result.invocationProvenance),
    };
  }
  return {
    mode: "GOVERNED",
    proposal: {
      objectiveRelation: result.proposal.objectiveRelation,
      proposedObjective: result.proposal.proposedObjective,
      requestedHelp: result.proposal.requestedHelp,
      relevantContext: result.proposal.relevantContext,
      entities: result.proposal.entities,
      referents: result.proposal.referents,
      constraints: result.proposal.constraints,
      preferences: result.proposal.preferences,
      knowledgeNeeds: result.proposal.knowledgeNeeds,
      materialAmbiguity: result.proposal.materialAmbiguity,
      referencedKnowledgeId: result.proposal.referencedKnowledgeId,
      referencedRecommendationId: result.proposal.referencedRecommendationId ?? null,
      referencedOptionId: result.proposal.referencedOptionId ?? null,
    },
    invocationProvenance: sanitizedProvenance(result.invocationProvenance),
  };
}

class SeedThenRealCognition {
  constructor(realCognition) {
    this.realCognition = realCognition;
    this.observations = [];
  }

  async interpret(input) {
    const recommendation = input.governedRecommendations?.at(-1);
    if (!recommendation) {
      return {
        mode: "GOVERNED",
        proposal: proposal({
          objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
          proposedObjective: input.currentObjective ? null : input.message,
          requestedHelp: "DECISION",
          preferences: ["finish the quicker small chore first"],
        }),
        invocationProvenance: FIXTURE_PROVENANCE,
      };
    }

    const observation = {
      messageId: input.messageId,
      userMessage: input.message,
      suppliedRecommendation: {
        recommendationId: recommendation.recommendationId,
        selectionAuthorized: recommendation.selectionAuthorized,
        options: recommendation.options.map((option) => ({
          optionId: option.optionId,
          position: option.position,
          text: option.text,
          recommended: option.recommended,
        })),
      },
      result: null,
      providerError: null,
    };
    this.observations.push(observation);

    try {
      const result = await this.realCognition.interpret(input);
      observation.result = sanitizedCognition(result);
      writeEvidence();
      return result;
    } catch (error) {
      observation.providerError = {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      };
      writeEvidence();
      throw error;
    }
  }
}

class SeedAdvisory {
  async advise() {
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Refill the bird feeder first.",
        basis: [],
        rationale: ["This best matches the preference to finish the quicker small chore first."],
        tradeoffs: [],
        assumptions: [],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Label the storage box first."],
      },
      invocationProvenance: FIXTURE_PROVENANCE,
    };
  }
}

const heldOutContinuations = [
  "Sounds right. I'll take the option you recommended.",
  "Let's go with your first pick.",
  "That suggestion works for me — that's the one I want.",
  "Use the recommended one as the option I've chosen.",
];

const cognition = new SeedThenRealCognition(configured.cognition);
const evidence = {
  status: "RUNNING",
  product: { sha: expectedSha, tree: expectedTree },
  route: {
    configured: config.solandraCognitionRoute,
    composedModel: configured.model,
  },
  credential: { groqApiKeyPresent: true },
  cases: [],
  cognitionObservations: cognition.observations,
  environmentFailure: null,
};
mkdirSync(artifactDir, { recursive: true });
function writeEvidence() {
  writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
}
writeEvidence();

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  solandraCognition: cognition,
  solandraAdvisory: new SeedAdvisory(),
});

async function inject(options) {
  return app.inject(options);
}

async function createConversation() {
  const response = await inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().conversation.id;
}

async function submit(conversationId, message) {
  return inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
}

async function continuity(conversationId) {
  const response = await inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

function hasExecutionOverclaim(text) {
  return /\b(?:I'll|I will|I'm going to|I am going to|I went ahead|I've gone ahead|I've started|I started|I've performed|I performed|I've sent|I sent|I've executed|I executed|I've applied|I applied|I've completed|I completed|I've verified|I verified)\b/iu.test(text);
}

try {
  const seedMessage = "I'm choosing between refilling the bird feeder and labeling a storage box. I'd prefer to finish the quicker small chore first. Which would you pick?";

  for (let index = 0; index < heldOutContinuations.length; index += 1) {
    const userContinuation = heldOutContinuations[index];
    const conversationId = await createConversation();

    const seedResponse = await submit(conversationId, seedMessage);
    assert.equal(seedResponse.statusCode, 200, seedResponse.body);
    const seeded = seedResponse.json();
    assert.equal(seeded.status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(seeded.recommendationReference.selectionAuthorized, false);
    const suppliedRecommendationId = seeded.recommendationReference.recommendationId;
    const suppliedOption = seeded.recommendationReference.options.find((option) => option.recommended);
    assert.ok(suppliedOption, "Seed recommendation requires one recommended option.");

    const observationStart = cognition.observations.length;
    const choiceResponse = await submit(conversationId, userContinuation);
    const observations = cognition.observations.slice(observationStart);
    assert.equal(observations.length, 1, "Expected exactly one real cognition observation for held-out continuation.");
    const observation = observations[0];

    if (observation.providerError) {
      evidence.status = "VALIDATION_ENVIRONMENT_FAILURE";
      evidence.environmentFailure = {
        case: index + 1,
        userContinuation,
        providerError: observation.providerError,
      };
      writeEvidence();
      console.log(`PR106_VALIDATION_ENVIRONMENT_FAILURE=${JSON.stringify(evidence.environmentFailure)}`);
      process.exitCode = 2;
      break;
    }

    const choiceBody = (() => {
      try {
        return choiceResponse.json();
      } catch {
        return { rawBody: choiceResponse.body };
      }
    })();
    const after = await continuity(conversationId);
    const persistedChoice = after.acceptedChoices?.at(-1) ?? null;
    const cognitionResult = observation.result;
    const mode = cognitionResult?.mode ?? null;
    const requestedHelp = mode === "GOVERNED" ? cognitionResult.proposal.requestedHelp : null;
    const resolvedRecommendationId = mode === "GOVERNED"
      ? cognitionResult.proposal.referencedRecommendationId
      : null;
    const resolvedOptionId = mode === "GOVERNED"
      ? cognitionResult.proposal.referencedOptionId
      : null;
    const productResponse = choiceBody.presentation?.assistantMessage ?? choiceBody.rawBody ?? null;
    const actionProposalExists = choiceBody.actionProposal !== undefined;
    const authorizationExists = choiceBody.authorization !== undefined;
    const executionReceiptExists = choiceBody.executionReceipt !== undefined;
    const verificationExists = choiceBody.verification !== undefined;
    const acceptedChoiceEstablished = choiceBody.status === "ACCEPTED_CHOICE_ESTABLISHED"
      && persistedChoice !== null;
    const authorizationGranted = persistedChoice?.authorizationGranted ?? choiceBody.acceptedChoice?.authorizationGranted ?? null;
    const executionAuthorized = persistedChoice?.executionAuthorized ?? choiceBody.acceptedChoice?.executionAuthorized ?? null;
    const presentationOverclaim = typeof productResponse === "string" && hasExecutionOverclaim(productResponse);

    const pass = choiceResponse.statusCode === 200
      && mode === "GOVERNED"
      && requestedHelp === "ACCEPT_CHOICE"
      && resolvedRecommendationId === suppliedRecommendationId
      && resolvedOptionId === suppliedOption.optionId
      && acceptedChoiceEstablished
      && persistedChoice?.recommendationId === suppliedRecommendationId
      && persistedChoice?.optionId === suppliedOption.optionId
      && authorizationGranted === false
      && executionAuthorized === false
      && !actionProposalExists
      && !authorizationExists
      && !executionReceiptExists
      && !verificationExists
      && typeof productResponse === "string"
      && productResponse.trim().length > 0
      && !presentationOverclaim;

    const caseEvidence = {
      case: index + 1,
      userContinuation,
      suppliedRecommendationId,
      suppliedOptionId: suppliedOption.optionId,
      cognitionMode: mode,
      requestedHelp,
      resolvedRecommendationId,
      resolvedOptionId,
      invocationProvenance: cognitionResult?.invocationProvenance ?? null,
      acceptedChoiceEstablished,
      acceptedChoiceId: persistedChoice?.acceptedChoiceId ?? null,
      persistedRecommendationId: persistedChoice?.recommendationId ?? null,
      persistedOptionId: persistedChoice?.optionId ?? null,
      authorizationGranted,
      executionAuthorized,
      actionProposalExists,
      authorizationExists,
      executionReceiptExists,
      verificationExists,
      productStatusCode: choiceResponse.statusCode,
      productStatus: choiceBody.status ?? null,
      productResponse,
      presentationOverclaim,
      rawSanitizedCognitionResult: cognitionResult,
      pass,
    };
    evidence.cases.push(caseEvidence);
    writeEvidence();
    console.log(`PR106_HELD_OUT_CASE=${JSON.stringify(caseEvidence)}`);
  }

  if (evidence.status !== "VALIDATION_ENVIRONMENT_FAILURE") {
    const allPassed = evidence.cases.length === heldOutContinuations.length
      && evidence.cases.every((item) => item.pass === true);
    evidence.status = allPassed ? "PASS" : "FAIL";
    writeEvidence();
    console.log(`PR106_REAL_MODEL_DISCRIMINATOR=${evidence.status}`);
    if (!allPassed) process.exitCode = 1;
  }

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  const trackedDiff = git("status", "--porcelain", "--untracked-files=no");
  assert.equal(trackedDiff, "", `Frozen Product checkout acquired tracked changes: ${trackedDiff}`);
} finally {
  writeEvidence();
  await app.close();
}
