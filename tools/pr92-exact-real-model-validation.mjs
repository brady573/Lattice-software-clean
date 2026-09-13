import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";

const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "pr92-exact-real-model-validator",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
assert.equal(config.truthMode, "v36-live");
assert.equal(config.solandraCognitionRoute, "groq-gpt-oss-120b");

const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra composition is required for this validation.");

const acquisitions = [];
const cognitionObservations = [];
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  reusedOrdinaryEvidence: {
    workflowRunId: 34769624090,
    acceptedCompletedTurns: 6,
    repeated: false,
  },
  route: {
    configured: config.solandraCognitionRoute,
    truthMode: config.truthMode,
    composedModel: solandra.model,
  },
  cognition: cognitionObservations,
  knowledge: null,
  historicalFollowUp: null,
};
const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/pr92-real-model");
mkdirSync(artifactDir, { recursive: true });
function writeEvidence() {
  writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
}
function governedProjection(proposal) {
  return {
    objectiveRelation: proposal.objectiveRelation,
    proposedObjective: proposal.proposedObjective,
    requestedHelp: proposal.requestedHelp,
    relevantContext: proposal.relevantContext,
    entities: proposal.entities,
    referents: proposal.referents,
    constraints: proposal.constraints,
    preferences: proposal.preferences,
    knowledgeNeeds: proposal.knowledgeNeeds,
    materialAmbiguity: proposal.materialAmbiguity,
    referencedKnowledgeId: proposal.referencedKnowledgeId,
    referencedRecommendationId: proposal.referencedRecommendationId ?? null,
    referencedOptionId: proposal.referencedOptionId ?? null,
  };
}
const observedCognition = {
  async interpret(input) {
    const result = await solandra.cognition.interpret(input);
    const mode = result.mode === "CONVERSATION" ? "CONVERSATION" : "GOVERNED";
    const observation = {
      sequence: cognitionObservations.length + 1,
      messageId: input.messageId,
      mode,
      actualProvider: result.invocationProvenance.actualProvider ?? null,
      actualModel: result.invocationProvenance.actualModel ?? null,
      routeProvenance: result.invocationProvenance.routeProvenance ?? null,
      ...(mode === "GOVERNED" ? { projection: governedProjection(result.proposal) } : {}),
    };
    cognitionObservations.push(observation);
    writeEvidence();
    console.log(`PR92_COGNITION_OBSERVATION=${JSON.stringify(observation)}`);
    return result;
  },
};

const liveProvider = new WikimediaKnowledgeAcquisitionProvider();
const recordingProvider = {
  kind: `pr92-validation:${liveProvider.kind}`,
  async acquire(input) {
    const result = await liveProvider.acquire(input);
    acquisitions.push({
      objective: input.objective,
      queries: [...(input.investigationQueries ?? [])],
      sources: result.sources.map(({ sourceId, title, canonicalUri }) => ({ sourceId, title, canonicalUri })),
    });
    writeEvidence();
    return result;
  },
};

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  knowledgeAcquisitionProvider: recordingProvider,
  solandraCognition: observedCognition,
  solandraAdvisory: solandra.advisory,
  solandraActionPreparer: solandra.actionPreparer,
  solandraKnowledgePresenter: solandra.knowledgePresenter,
});

async function request(options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}
async function createConversation() {
  return (await request({ method: "POST", url: "/api/v1/conversations" })).conversation.id;
}
async function state(conversationId) {
  const body = await request({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
  return {
    runs: body.runs?.length ?? 0,
    knowledge: body.knowledge?.length ?? 0,
    recommendations: body.recommendations?.length ?? 0,
    choices: body.acceptedChoices?.length ?? body.choices?.length ?? 0,
  };
}
async function submit(conversationId, message) {
  return await request({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
}
async function waitForRun(runId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await request({ method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}`);
    if (run.status === "COMPLETED") {
      return {
        run,
        outcome: (await request({ method: "GET", url: `/api/v1/runs/${runId}/outcome` })).outcome,
      };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out`);
}

try {
  writeEvidence();
  const conversationId = await createConversation();
  const knowledgeRequest = "I heard that Venus takes longer to rotate once than to orbit the Sun. Please verify that with trustworthy external sources and summarize what the evidence supports.";
  const beforeKnowledge = await state(conversationId);
  const accepted = await submit(conversationId, knowledgeRequest);
  const knowledgeCognition = cognitionObservations[0] ?? null;
  evidence.knowledge = {
    userRequest: knowledgeRequest,
    cognition: knowledgeCognition,
    publicCognition: accepted.interpretation ?? null,
    status: accepted.status,
    runId: accepted.runId ?? null,
    runStatus: null,
    findings: null,
    provenance: null,
    acquisition: null,
    stateDelta: null,
  };
  writeEvidence();
  assert.equal(knowledgeCognition?.mode, "GOVERNED", "Knowledge-required turn did not return GOVERNED cognition.");
  assert.equal(accepted.status, "RUN_ACCEPTED", "Knowledge-required turn did not create the governed Run.");
  assert.ok(accepted.runId, "Knowledge-required turn did not expose a Run ID.");

  const completed = await waitForRun(accepted.runId);
  const afterKnowledge = await state(conversationId);
  evidence.knowledge = {
    ...evidence.knowledge,
    runStatus: completed.run.status,
    findings: completed.outcome.findings,
    provenance: completed.outcome.provenance,
    acquisition: acquisitions[0] ?? null,
    stateDelta: {
      runs: afterKnowledge.runs - beforeKnowledge.runs,
      knowledge: afterKnowledge.knowledge - beforeKnowledge.knowledge,
      recommendations: afterKnowledge.recommendations - beforeKnowledge.recommendations,
      choices: afterKnowledge.choices - beforeKnowledge.choices,
    },
  };
  writeEvidence();
  assert.equal(afterKnowledge.runs - beforeKnowledge.runs, 1);
  assert.ok(afterKnowledge.knowledge - beforeKnowledge.knowledge > 0, "Governed Knowledge was not created.");
  assert.equal(acquisitions.length, 1, "v36-live acquisition was not invoked exactly once.");
  assert.ok(completed.outcome.provenance?.length > 0, "Governed Knowledge lacks provenance.");

  const followUp = "Which source from that check most directly supports the rotation-versus-orbit comparison? Keep the answer brief.";
  const beforeFollow = await state(conversationId);
  const follow = await submit(conversationId, followUp);
  const followCognition = cognitionObservations[1] ?? null;
  const afterFollow = await state(conversationId);
  evidence.historicalFollowUp = {
    userRequest: followUp,
    cognition: followCognition,
    publicCognition: follow.interpretation ?? null,
    status: follow.status,
    assistantMessage: follow.presentation?.assistantMessage ?? null,
    knowledgeReference: follow.knowledgeReference ?? null,
    knowledgeId: follow.knowledge?.knowledgeId ?? follow.knowledgeReference?.knowledgeId ?? null,
    priorProvenance: completed.outcome.provenance,
    stateDelta: {
      runs: afterFollow.runs - beforeFollow.runs,
      knowledge: afterFollow.knowledge - beforeFollow.knowledge,
      recommendations: afterFollow.recommendations - beforeFollow.recommendations,
      choices: afterFollow.choices - beforeFollow.choices,
    },
  };
  writeEvidence();
  assert.equal(followCognition?.mode, "GOVERNED", "Historical Knowledge/source follow-up did not return GOVERNED cognition.");
  assert.equal(follow.status, "REFERENCE_RESOLVED", "Historical Knowledge/source follow-up did not resolve existing Knowledge.");
  assert.equal(afterFollow.runs - beforeFollow.runs, 0, "Historical Knowledge/source follow-up created an unnecessary new Run.");
  assert.equal(afterFollow.knowledge, beforeFollow.knowledge, "Historical Knowledge/source follow-up changed Knowledge count.");
  assert.ok(follow.knowledgeReference?.knowledgeId, "Historical Knowledge/source follow-up did not reference existing Knowledge.");
  assert.ok(typeof follow.presentation?.assistantMessage === "string" && follow.presentation.assistantMessage.trim().length > 0);

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  writeEvidence();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  console.log("PR92_KNOWLEDGE_ONLY_REAL_MODEL_VALIDATION=PASS");
} finally {
  await app.close();
}
