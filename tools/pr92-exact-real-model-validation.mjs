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
assert.ok(solandra.model.trim().length > 0, "Configured Solandra model identity is required.");

const acquisitions = [];
const cognitionObservations = [];
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  route: {
    configured: config.solandraCognitionRoute,
    truthMode: config.truthMode,
    composedModel: solandra.model,
  },
  cognition: cognitionObservations,
  ordinary: [],
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
    body,
  };
}
async function submit(conversationId, message) {
  return await request({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
}
async function ordinaryTurn(conversationId, capability, message) {
  const before = await state(conversationId);
  const cognitionStart = cognitionObservations.length;
  const result = await submit(conversationId, message);
  const turnCognition = cognitionObservations.slice(cognitionStart);
  const after = await state(conversationId);
  const record = {
    capability,
    status: result.status,
    assistantMessage: result.presentation?.assistantMessage,
    publicCognitionMode: result.interpretation?.mode ?? null,
    publicCognition: result.interpretation ?? null,
    cognition: turnCognition,
    authority: result.interpretation?.authority,
    factualAuthority: result.interpretation?.factualAuthority,
    created: {
      runs: after.runs - before.runs,
      knowledge: after.knowledge - before.knowledge,
      recommendations: after.recommendations - before.recommendations,
      choices: after.choices - before.choices,
    },
  };
  evidence.ordinary.push(record);
  writeEvidence();
  if (turnCognition.some((observation) => observation.mode === "GOVERNED")) {
    throw new Error("PR92_ORDINARY_TURN_RETURNED_GOVERNED: preserve this real-model evidence for Steward review; no Product repair is authorized in this task.");
  }
  assert.equal(record.status, "CONVERSATION_COMPLETED");
  assert.equal(record.publicCognitionMode, "CONVERSATION");
  assert.equal(record.authority, "NON_AUTHORITATIVE_CONVERSATION");
  assert.equal(record.factualAuthority, false);
  assert.ok(typeof record.assistantMessage === "string" && record.assistantMessage.trim().length > 0);
  assert.deepEqual(record.created, { runs: 0, knowledge: 0, recommendations: 0, choices: 0 });
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
  const first = await createConversation();
  await ordinaryTurn(first, ["reference/coreference", "multiple requests"], "I'm inventing two airships: Juniper is quick and Copper Finch is roomy. Give each a one-line motto, then tell me which name feels warmer.");
  await ordinaryTurn(first, ["ellipsis", "response-style adaptation"], "For the second one too—shorter, like a label.");
  await ordinaryTurn(first, ["correction/revision", "negation"], "Actually, I mixed them up: Juniper is the roomy one. Don't rewrite both; just correct the affected comparison.");
  await ordinaryTurn(first, ["topic change"], "Quick detour: suggest a playful name for an imaginary moon café.");
  await ordinaryTurn(first, ["return to earlier topic", "coreference"], "Back to the airships: which one did I say was quick? Answer in five words or fewer.");

  const second = await createConversation();
  await ordinaryTurn(second, ["hypothetical reasoning", "negation", "multiple requests"], "Suppose a fictional library lends memories instead of books. Describe one benefit and one risk, but don't make either sound like an established fact.");
  await ordinaryTurn(second, ["ellipsis", "style adaptation"], "And a safeguard? One sentence, calm tone.");

  const knowledgeConversation = await createConversation();
  const beforeKnowledge = await state(knowledgeConversation);
  const knowledgeCognitionStart = cognitionObservations.length;
  const accepted = await submit(
    knowledgeConversation,
    "Please find trustworthy external sources explaining why the Eiffel Tower's measured height can vary with temperature, and summarize the supported explanation.",
  );
  const knowledgeCognition = cognitionObservations.slice(knowledgeCognitionStart);
  evidence.knowledge = {
    status: accepted.status,
    publicCognitionMode: accepted.interpretation?.mode ?? null,
    publicCognition: accepted.interpretation ?? null,
    cognition: knowledgeCognition,
  };
  writeEvidence();
  assert.equal(accepted.status, "RUN_ACCEPTED");
  assert.ok(accepted.runId);
  const completed = await waitForRun(accepted.runId);
  const afterKnowledge = await state(knowledgeConversation);
  assert.equal(afterKnowledge.runs - beforeKnowledge.runs, 1);
  assert.ok(afterKnowledge.knowledge - beforeKnowledge.knowledge > 0);
  assert.ok(acquisitions.length === 1);
  assert.ok(completed.outcome.provenance?.length > 0);
  Object.assign(evidence.knowledge, {
    runId: accepted.runId,
    runStatus: completed.run.status,
    findings: completed.outcome.findings,
    provenance: completed.outcome.provenance,
    acquisition: acquisitions[0],
    stateDelta: {
      runs: afterKnowledge.runs - beforeKnowledge.runs,
      knowledge: afterKnowledge.knowledge - beforeKnowledge.knowledge,
      recommendations: afterKnowledge.recommendations - beforeKnowledge.recommendations,
      choices: afterKnowledge.choices - beforeKnowledge.choices,
    },
  });
  writeEvidence();

  const beforeFollow = await state(knowledgeConversation);
  const followCognitionStart = cognitionObservations.length;
  const follow = await submit(knowledgeConversation, "Which source from that research most directly supports the temperature explanation? Keep the answer brief.");
  const followCognition = cognitionObservations.slice(followCognitionStart);
  const afterFollow = await state(knowledgeConversation);
  evidence.historicalFollowUp = {
    status: follow.status,
    assistantMessage: follow.presentation?.assistantMessage,
    publicCognitionMode: follow.interpretation?.mode ?? null,
    publicCognition: follow.interpretation ?? null,
    cognition: followCognition,
    authority: follow.interpretation?.authority,
    factualAuthority: follow.interpretation?.factualAuthority,
    stateDelta: {
      runs: afterFollow.runs - beforeFollow.runs,
      knowledge: afterFollow.knowledge - beforeFollow.knowledge,
      recommendations: afterFollow.recommendations - beforeFollow.recommendations,
      choices: afterFollow.choices - beforeFollow.choices,
    },
    priorKnowledgeCount: beforeFollow.knowledge,
    priorProvenance: completed.outcome.provenance,
  };
  writeEvidence();
  assert.equal(follow.status, "CONVERSATION_COMPLETED");
  assert.equal(follow.interpretation?.authority, "NON_AUTHORITATIVE_CONVERSATION");
  assert.equal(follow.interpretation?.factualAuthority, false);
  assert.equal(afterFollow.runs - beforeFollow.runs, 0);
  assert.equal(afterFollow.knowledge, beforeFollow.knowledge);
  assert.ok(typeof follow.presentation?.assistantMessage === "string" && follow.presentation.assistantMessage.trim());

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  writeEvidence();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  console.log("PR92_EXACT_REAL_MODEL_VALIDATION=PASS");
} catch (error) {
  writeEvidence();
  throw error;
} finally {
  await app.close();
}
