import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";

const expectedSha = "3fd8b8cae97dc60bf02225aa730a175f9c6fd60e";
const expectedTree = "0dfea8a9b5a27e7d9fc4600d2ddffd76e39e6f9c";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "pr92-historical-continuation-validator",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra);

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/pr92-historical-continuation");
mkdirSync(artifactDir, { recursive: true });
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  reused: {
    ordinaryWorkflowRunId: 34769624090,
    sourcedHistoryWorkflowRunId: 34772676700,
    sourcedHistoryRepeated: false,
    focusedDeterministicRepeated: false,
  },
  route: { configured: config.solandraCognitionRoute, composedModel: solandra.model },
  observations: [],
  sparseHistory: null,
  freshResearch: null,
  status: "RUNNING",
};
const persist = () => writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
persist();

const setupProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "validation-history-setup",
  requestedModel: "validation-history-setup",
  actualProvider: "validation-history-setup",
  actualModel: "validation-history-setup",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "validation-history-setup",
  routeProvenance: "COMPLETE",
});

function setupProjection(input) {
  return {
    mode: "GOVERNED",
    proposal: {
      objectiveRelation: "NEW_OBJECTIVE",
      proposedObjective: input.message,
      requestedHelp: "KNOWLEDGE",
      relevantContext: [],
      entities: [],
      referents: [],
      constraints: [],
      preferences: [],
      knowledgeNeeds: ["bounded validation evidence for the historical Knowledge state"],
      materialAmbiguity: null,
      referencedKnowledgeId: null,
      referencedRecommendationId: null,
      referencedOptionId: null,
    },
    invocationProvenance: setupProvenance,
  };
}

function projection(result) {
  if (result.mode === "CONVERSATION") return null;
  return {
    objectiveRelation: result.proposal.objectiveRelation,
    requestedHelp: result.proposal.requestedHelp,
    knowledgeNeeds: result.proposal.knowledgeNeeds,
    materialAmbiguity: result.proposal.materialAmbiguity,
    referencedKnowledgeId: result.proposal.referencedKnowledgeId,
  };
}

function validationCognition() {
  let probe = null;
  return {
    setProbe(value) { probe = value; },
    runtime: {
      async interpret(input) {
        if (input.currentObjective === undefined && input.governedKnowledge.length === 0) return setupProjection(input);
        const result = await solandra.cognition.interpret(input);
        const observation = {
          probe,
          mode: result.mode === "CONVERSATION" ? "CONVERSATION" : "GOVERNED",
          actualProvider: result.invocationProvenance.actualProvider ?? null,
          actualModel: result.invocationProvenance.actualModel ?? null,
          routeProvenance: result.invocationProvenance.routeProvenance ?? null,
          projection: projection(result),
        };
        evidence.observations.push(observation);
        persist();
        console.log(`PR92_HISTORICAL_CONTINUATION=${JSON.stringify(observation)}`);
        return result;
      },
    },
  };
}

const fixedTime = "2026-09-13T17:30:00.000Z";
class SparseAcquisition {
  kind = "pr92-validation-sparse";
  calls = 0;
  async acquire() { this.calls += 1; return { sources: [], claims: [] }; }
}
class SourcedAcquisition {
  kind = "pr92-validation-fresh";
  calls = 0;
  async acquire() {
    this.calls += 1;
    const later = this.calls > 1;
    const sourceId = later ? "harbor-later-note" : "harbor-baseline-note";
    const content = later
      ? "A later Harbor Format release note reports a revision date of September 3, 2026."
      : "The Harbor Format baseline release note reports a revision date of July 12, 2026.";
    return {
      sources: [{
        sourceId,
        canonicalUri: `https://validation.example/${sourceId}`,
        title: later ? "Harbor Format later release note" : "Harbor Format baseline release note",
        publisher: "Validation Fixture",
        retrievedAt: fixedTime,
        publishedAt: later ? "2026-09-03T00:00:00.000Z" : "2026-07-12T00:00:00.000Z",
        contentType: "text/plain",
        content,
      }],
      claims: [{
        claimId: `claim-${sourceId}`,
        text: content,
        claimType: "INTERPRETIVE",
        qualifiers: [{ key: "source-report", value: sourceId }],
        evidence: [{ sourceId, relation: "SUPPORTS", excerpt: content }],
      }],
    };
  }
}

async function request(app, options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}
async function conversation(app) {
  return (await request(app, { method: "POST", url: "/api/v1/conversations" })).conversation.id;
}
async function submit(app, conversationId, message) {
  return request(app, { method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: randomUUID(), message } });
}
async function continuity(app, conversationId) {
  return request(app, { method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
}
async function outcome(app, runId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}`);
    if (run.status === "COMPLETED") return (await request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` })).outcome;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Run ${runId} timed out`);
}
const delta = (after, before, key) => (after[key]?.length ?? 0) - (before[key]?.length ?? 0);
const latestKnowledge = (state) => state.knowledge?.at(-1) ?? null;
const observation = (probe) => [...evidence.observations].reverse().find((item) => item.probe === probe) ?? null;
const isHistoricalReferenceMode = (help) => help === "SOURCES_REFERENCE" || help === "EXPLAIN_REFERENCE";

let sparseApp;
let freshApp;
try {
  const sparseAcquisition = new SparseAcquisition();
  const sparseCognition = validationCognition();
  sparseApp = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(sparseAcquisition),
    solandraCognition: sparseCognition.runtime,
    solandraAdvisory: solandra.advisory,
    solandraActionPreparer: solandra.actionPreparer,
    solandraKnowledgePresenter: solandra.knowledgePresenter,
  });
  const sparseConversation = await conversation(sparseApp);
  const sparseSetup = await submit(sparseApp, sparseConversation, "Please establish whether the fictional Juniper Archive published a public status bulletin in 2026.");
  assert.equal(sparseSetup.status, "RUN_ACCEPTED");
  const sparseOutcome = await outcome(sparseApp, sparseSetup.runId);
  const sparseEstablished = await continuity(sparseApp, sparseConversation);
  const sparseKnowledge = latestKnowledge(sparseEstablished);
  assert.ok(sparseKnowledge?.knowledgeId);
  assert.deepEqual(sparseOutcome.provenance, []);
  assert.ok(sparseOutcome.uncertainties.length > 0);

  sparseCognition.setProbe("sparse-history");
  const sparseBefore = await continuity(sparseApp, sparseConversation);
  const sparseFollow = await submit(sparseApp, sparseConversation, "Looking only at what we already established, what support was actually available for that result?");
  const sparseAfter = await continuity(sparseApp, sparseConversation);
  const sparseObserved = observation("sparse-history");
  evidence.sparseHistory = {
    cognition: sparseObserved,
    status: sparseFollow.status,
    establishedKnowledgeId: sparseKnowledge.knowledgeId,
    returnedKnowledgeId: sparseFollow.knowledgeReference?.knowledgeId ?? null,
    runDelta: delta(sparseAfter, sparseBefore, "runs"),
    knowledgeDelta: delta(sparseAfter, sparseBefore, "knowledge"),
    priorProvenance: sparseOutcome.provenance,
    returnedProvenance: sparseFollow.knowledge?.provenance ?? null,
    priorUncertainties: sparseOutcome.uncertainties,
    returnedUncertainties: sparseFollow.knowledge?.uncertainties ?? null,
    assistantMessage: sparseFollow.presentation?.assistantMessage ?? null,
  };
  persist();
  assert.equal(sparseObserved?.mode, "GOVERNED");
  assert.ok(isHistoricalReferenceMode(sparseObserved?.projection?.requestedHelp));
  assert.equal(sparseObserved?.projection?.referencedKnowledgeId, sparseKnowledge.knowledgeId);
  assert.equal(sparseFollow.status, "REFERENCE_RESOLVED");
  assert.equal(evidence.sparseHistory.runDelta, 0);
  assert.equal(evidence.sparseHistory.knowledgeDelta, 0);
  assert.equal(sparseFollow.knowledgeReference?.knowledgeId, sparseKnowledge.knowledgeId);
  assert.deepEqual(sparseFollow.knowledge?.provenance, sparseOutcome.provenance);
  assert.deepEqual(sparseFollow.knowledge?.uncertainties, sparseOutcome.uncertainties);
  assert.ok(sparseFollow.presentation?.assistantMessage?.trim());

  const sourcedAcquisition = new SourcedAcquisition();
  const freshCognition = validationCognition();
  freshApp = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(sourcedAcquisition),
    solandraCognition: freshCognition.runtime,
    solandraAdvisory: solandra.advisory,
    solandraActionPreparer: solandra.actionPreparer,
    solandraKnowledgePresenter: solandra.knowledgePresenter,
  });
  const freshConversation = await conversation(freshApp);
  const baseline = await submit(freshApp, freshConversation, "Please establish the revision date reported by the fictional Harbor Format baseline release note.");
  assert.equal(baseline.status, "RUN_ACCEPTED");
  await outcome(freshApp, baseline.runId);
  const beforeFresh = await continuity(freshApp, freshConversation);
  const originalKnowledge = latestKnowledge(beforeFresh);
  assert.ok(originalKnowledge?.knowledgeId);
  const originalSnapshot = beforeFresh.knowledge.find((item) => item.knowledgeId === originalKnowledge.knowledgeId);
  assert.ok(originalSnapshot);

  freshCognition.setProbe("fresh-after-history");
  const fresh = await submit(freshApp, freshConversation, "Please do a fresh external investigation for a later release note and tell me whether newer evidence changes the established picture.");
  const freshObserved = observation("fresh-after-history");
  assert.equal(freshObserved?.mode, "GOVERNED");
  assert.equal(freshObserved?.projection?.requestedHelp, "FRESH_RESEARCH");
  assert.equal(fresh.status, "RUN_ACCEPTED");
  const freshOutcome = await outcome(freshApp, fresh.runId);
  const afterFresh = await continuity(freshApp, freshConversation);
  const originalAfter = afterFresh.knowledge.find((item) => item.knowledgeId === originalKnowledge.knowledgeId);
  evidence.freshResearch = {
    cognition: freshObserved,
    status: fresh.status,
    referencedKnowledgeId: freshObserved?.projection?.referencedKnowledgeId ?? null,
    runDelta: delta(afterFresh, beforeFresh, "runs"),
    knowledgeDelta: delta(afterFresh, beforeFresh, "knowledge"),
    originalKnowledgeId: originalKnowledge.knowledgeId,
    originalKnowledgePreserved: JSON.stringify(originalAfter) === JSON.stringify(originalSnapshot),
    acquisitionCountDelta: sourcedAcquisition.calls - 1,
    newProvenance: freshOutcome.provenance,
    newUncertainties: freshOutcome.uncertainties,
    newFindings: freshOutcome.findings,
  };
  persist();
  assert.equal(evidence.freshResearch.runDelta, 1);
  assert.equal(evidence.freshResearch.knowledgeDelta, 1);
  assert.equal(evidence.freshResearch.originalKnowledgePreserved, true);
  assert.equal(evidence.freshResearch.acquisitionCountDelta, 1);

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  evidence.status = "PASS";
  persist();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  console.log("PR92_HISTORICAL_KNOWLEDGE_CONTINUATION=PASS");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate limit/iu.test(message)) {
    evidence.status = "BLOCKED_PROVIDER_CAPACITY";
    persist();
    console.error("PR92_HISTORICAL_KNOWLEDGE_CONTINUATION=BLOCKED_PROVIDER_CAPACITY");
    process.exitCode = 2;
  } else {
    evidence.status = "FAIL";
    persist();
    throw error;
  }
} finally {
  if (freshApp) await freshApp.close();
  if (sparseApp) await sparseApp.close();
}
