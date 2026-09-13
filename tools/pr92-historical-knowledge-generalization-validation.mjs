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
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "pr92-historical-knowledge-validator",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
assert.equal(config.solandraCognitionRoute, "groq-gpt-oss-120b");
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra composition is required.");

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/pr92-historical-knowledge");
mkdirSync(artifactDir, { recursive: true });
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  reusedEvidence: {
    ordinaryRealModelWorkflowRunId: 34769624090,
    ordinaryCompletedTurns: 6,
    ordinaryRepeated: false,
    priorDeterministicCoreRepeated: false,
    postgresRepeated: false,
    browserRepeated: false,
  },
  route: {
    configured: config.solandraCognitionRoute,
    composedModel: solandra.model,
  },
  realModelObservations: [],
  sourcedHistory: null,
  sparseHistory: null,
  freshResearch: null,
  status: "RUNNING",
};
const persist = () => writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
persist();

const SETUP_PROVENANCE = Object.freeze({
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
      knowledgeNeeds: ["bounded validation evidence needed to establish the requested historical Knowledge state"],
      materialAmbiguity: null,
      referencedKnowledgeId: null,
      referencedRecommendationId: null,
      referencedOptionId: null,
    },
    invocationProvenance: SETUP_PROVENANCE,
  };
}

function projection(result) {
  if (result.mode === "CONVERSATION") return null;
  return {
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
  };
}

function createValidationCognition() {
  let activeProbe = null;
  return {
    setProbe(value) {
      activeProbe = value;
    },
    runtime: {
      async interpret(input) {
        if (input.currentObjective === undefined && input.governedKnowledge.length === 0) {
          return setupProjection(input);
        }
        const result = await solandra.cognition.interpret(input);
        const observation = {
          probe: activeProbe,
          mode: result.mode === "CONVERSATION" ? "CONVERSATION" : "GOVERNED",
          actualProvider: result.invocationProvenance.actualProvider ?? null,
          actualModel: result.invocationProvenance.actualModel ?? null,
          routeProvenance: result.invocationProvenance.routeProvenance ?? null,
          projection: projection(result),
        };
        evidence.realModelObservations.push(observation);
        persist();
        console.log(`PR92_HISTORICAL_COGNITION=${JSON.stringify(observation)}`);
        return result;
      },
    },
  };
}

const FIXED_TIME = "2026-09-13T17:30:00.000Z";
class SourcedFixtureAcquisition {
  kind = "pr92-validation-sourced-history";
  calls = [];
  async acquire(input) {
    this.calls.push(structuredClone(input));
    const call = this.calls.length;
    const sourceId = call === 1 ? "northstar-v3-release" : "northstar-later-release";
    const content = call === 1
      ? "The Northstar Protocol version 3 release note reports a publication date of August 1, 2026."
      : "A later Northstar Protocol release note reports that version 4 was published on September 1, 2026.";
    return {
      sources: [{
        sourceId,
        canonicalUri: `https://validation.example/${sourceId}`,
        title: call === 1 ? "Northstar Protocol v3 release note" : "Northstar Protocol later release note",
        publisher: "Validation Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: call === 1 ? "2026-08-01T00:00:00.000Z" : "2026-09-01T00:00:00.000Z",
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

class SparseFixtureAcquisition {
  kind = "pr92-validation-sparse-history";
  calls = [];
  async acquire(input) {
    this.calls.push(structuredClone(input));
    return { sources: [], claims: [] };
  }
}

async function request(app, options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}
async function createConversation(app) {
  return (await request(app, { method: "POST", url: "/api/v1/conversations" })).conversation.id;
}
async function continuity(app, conversationId) {
  return request(app, { method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
}
async function submit(app, conversationId, message) {
  return request(app, {
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
}
async function completedOutcome(app, runId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}`);
    if (run.status === "COMPLETED") {
      return (await request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` })).outcome;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Run ${runId} timed out`);
}
function delta(after, before, key) {
  return (after[key]?.length ?? 0) - (before[key]?.length ?? 0);
}
function latestKnowledge(state) {
  return state.knowledge?.at(-1) ?? null;
}
function latestRealObservation(probe) {
  return [...evidence.realModelObservations].reverse().find((item) => item.probe === probe) ?? null;
}

let sourcedApp;
let sparseApp;
try {
  const sourcedAcquisition = new SourcedFixtureAcquisition();
  const sourcedCognition = createValidationCognition();
  sourcedApp = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(sourcedAcquisition),
    solandraCognition: sourcedCognition.runtime,
    solandraAdvisory: solandra.advisory,
    solandraActionPreparer: solandra.actionPreparer,
    solandraKnowledgePresenter: solandra.knowledgePresenter,
  });

  const sourcedConversation = await createConversation(sourcedApp);
  const sourcedSetup = await submit(
    sourcedApp,
    sourcedConversation,
    "Please establish the publication date reported for the fictional Northstar Protocol version 3.",
  );
  assert.equal(sourcedSetup.status, "RUN_ACCEPTED");
  const sourcedOutcome = await completedOutcome(sourcedApp, sourcedSetup.runId);
  const sourcedState = await continuity(sourcedApp, sourcedConversation);
  const sourcedKnowledge = latestKnowledge(sourcedState);
  assert.ok(sourcedKnowledge?.knowledgeId);
  assert.ok(sourcedOutcome.provenance.length > 0, "Validation setup failed to establish sourced historical Knowledge.");
  assert.ok(sourcedOutcome.evidence?.some((item) => item.admitted), "Validation setup failed to establish admitted evidence.");

  sourcedCognition.setProbe("historical-sourced");
  const beforeSourcedReference = await continuity(sourcedApp, sourcedConversation);
  const sourcedReference = await submit(
    sourcedApp,
    sourcedConversation,
    "Where did the publication date in the established result come from?",
  );
  const afterSourcedReference = await continuity(sourcedApp, sourcedConversation);
  const sourcedObservation = latestRealObservation("historical-sourced");
  evidence.sourcedHistory = {
    cognition: sourcedObservation,
    status: sourcedReference.status,
    establishedKnowledgeId: sourcedKnowledge.knowledgeId,
    returnedKnowledgeId: sourcedReference.knowledgeReference?.knowledgeId ?? null,
    runDelta: delta(afterSourcedReference, beforeSourcedReference, "runs"),
    knowledgeDelta: delta(afterSourcedReference, beforeSourcedReference, "knowledge"),
    priorProvenance: sourcedOutcome.provenance,
    returnedProvenance: sourcedReference.knowledge?.provenance ?? null,
    priorUncertainties: sourcedOutcome.uncertainties,
    returnedUncertainties: sourcedReference.knowledge?.uncertainties ?? null,
    assistantMessage: sourcedReference.presentation?.assistantMessage ?? null,
  };
  persist();
  assert.equal(sourcedObservation?.mode, "GOVERNED");
  assert.equal(sourcedObservation?.projection?.requestedHelp, "SOURCES_REFERENCE");
  assert.equal(sourcedObservation?.projection?.referencedKnowledgeId, sourcedKnowledge.knowledgeId);
  assert.equal(sourcedReference.status, "REFERENCE_RESOLVED");
  assert.equal(evidence.sourcedHistory.runDelta, 0);
  assert.equal(evidence.sourcedHistory.knowledgeDelta, 0);
  assert.equal(sourcedReference.knowledgeReference?.knowledgeId, sourcedKnowledge.knowledgeId);
  assert.deepEqual(sourcedReference.knowledge?.provenance, sourcedOutcome.provenance);
  assert.deepEqual(sourcedReference.knowledge?.uncertainties, sourcedOutcome.uncertainties);
  assert.ok(sourcedReference.presentation?.assistantMessage?.includes("Northstar Protocol v3 release note"));

  const sparseAcquisition = new SparseFixtureAcquisition();
  const sparseCognition = createValidationCognition();
  sparseApp = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(sparseAcquisition),
    solandraCognition: sparseCognition.runtime,
    solandraAdvisory: solandra.advisory,
    solandraActionPreparer: solandra.actionPreparer,
    solandraKnowledgePresenter: solandra.knowledgePresenter,
  });

  const sparseConversation = await createConversation(sparseApp);
  const sparseSetup = await submit(
    sparseApp,
    sparseConversation,
    "Please establish whether the fictional Cedar Observatory issued a public opening report in 2026.",
  );
  assert.equal(sparseSetup.status, "RUN_ACCEPTED");
  const sparseOutcome = await completedOutcome(sparseApp, sparseSetup.runId);
  const sparseState = await continuity(sparseApp, sparseConversation);
  const sparseKnowledge = latestKnowledge(sparseState);
  assert.ok(sparseKnowledge?.knowledgeId);
  assert.deepEqual(sparseOutcome.provenance, []);
  assert.ok(sparseOutcome.uncertainties.length > 0);

  sparseCognition.setProbe("historical-sparse");
  const beforeSparseReference = await continuity(sparseApp, sparseConversation);
  const sparseReference = await submit(
    sparseApp,
    sparseConversation,
    "What evidence source, if any, backed the earlier result?",
  );
  const afterSparseReference = await continuity(sparseApp, sparseConversation);
  const sparseObservation = latestRealObservation("historical-sparse");
  evidence.sparseHistory = {
    cognition: sparseObservation,
    status: sparseReference.status,
    establishedKnowledgeId: sparseKnowledge.knowledgeId,
    returnedKnowledgeId: sparseReference.knowledgeReference?.knowledgeId ?? null,
    runDelta: delta(afterSparseReference, beforeSparseReference, "runs"),
    knowledgeDelta: delta(afterSparseReference, beforeSparseReference, "knowledge"),
    priorProvenance: sparseOutcome.provenance,
    returnedProvenance: sparseReference.knowledge?.provenance ?? null,
    priorUncertainties: sparseOutcome.uncertainties,
    returnedUncertainties: sparseReference.knowledge?.uncertainties ?? null,
    assistantMessage: sparseReference.presentation?.assistantMessage ?? null,
  };
  persist();
  assert.equal(sparseObservation?.mode, "GOVERNED");
  assert.equal(sparseObservation?.projection?.requestedHelp, "SOURCES_REFERENCE");
  assert.equal(sparseObservation?.projection?.referencedKnowledgeId, sparseKnowledge.knowledgeId);
  assert.equal(sparseReference.status, "REFERENCE_RESOLVED");
  assert.equal(evidence.sparseHistory.runDelta, 0);
  assert.equal(evidence.sparseHistory.knowledgeDelta, 0);
  assert.deepEqual(sparseReference.knowledge?.provenance, sparseOutcome.provenance);
  assert.deepEqual(sparseReference.knowledge?.uncertainties, sparseOutcome.uncertainties);
  assert.equal(
    sparseReference.presentation?.assistantMessage,
    "I don't have an admitted source linked to that established Knowledge.",
  );

  sourcedCognition.setProbe("fresh-after-history");
  const beforeFresh = await continuity(sourcedApp, sourcedConversation);
  const originalKnowledgeSnapshot = beforeFresh.knowledge.find((item) => item.knowledgeId === sourcedKnowledge.knowledgeId);
  assert.ok(originalKnowledgeSnapshot);
  const fresh = await submit(
    sourcedApp,
    sourcedConversation,
    "Now do a new external search for any later release note that changes that publication-date picture.",
  );
  const freshObservation = latestRealObservation("fresh-after-history");
  assert.equal(freshObservation?.mode, "GOVERNED");
  assert.equal(freshObservation?.projection?.requestedHelp, "FRESH_RESEARCH");
  assert.equal(fresh.status, "RUN_ACCEPTED");
  assert.ok(fresh.runId);
  const freshOutcome = await completedOutcome(sourcedApp, fresh.runId);
  const afterFresh = await continuity(sourcedApp, sourcedConversation);
  const originalKnowledgeAfter = afterFresh.knowledge.find((item) => item.knowledgeId === sourcedKnowledge.knowledgeId);
  evidence.freshResearch = {
    cognition: freshObservation,
    status: fresh.status,
    runId: fresh.runId,
    runDelta: delta(afterFresh, beforeFresh, "runs"),
    knowledgeDelta: delta(afterFresh, beforeFresh, "knowledge"),
    originalKnowledgeId: sourcedKnowledge.knowledgeId,
    originalKnowledgePreserved: JSON.stringify(originalKnowledgeAfter) === JSON.stringify(originalKnowledgeSnapshot),
    acquisitionCountDelta: sourcedAcquisition.calls.length - 1,
    newProvenance: freshOutcome.provenance,
    newUncertainties: freshOutcome.uncertainties,
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
  console.log("PR92_HISTORICAL_KNOWLEDGE_GENERALIZATION=PASS");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate limit/iu.test(message)) {
    evidence.status = "BLOCKED_PROVIDER_CAPACITY";
    persist();
    console.error("PR92_HISTORICAL_KNOWLEDGE_GENERALIZATION=BLOCKED_PROVIDER_CAPACITY");
    process.exitCode = 2;
  } else {
    evidence.status = "FAIL";
    persist();
    throw error;
  }
} finally {
  if (sparseApp) await sparseApp.close();
  if (sourcedApp) await sourcedApp.close();
}
