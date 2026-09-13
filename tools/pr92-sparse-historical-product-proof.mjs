import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { ModelRuntime } from "../dist/src/model/runtime.js";
import { ModelSolandraKnowledgePresenter } from "../dist/src/solandra/knowledge-presenter.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";

const expectedSha = "179f83497f0fb8b2d91d93076d024c185729e0b9";
const expectedTree = "bdc10be9f8a8cabd892c3d825b2aa5ec5d19ff8b";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "pr92-sparse-presentation-validator",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
assert.equal(config.solandraCognitionRoute, "groq-gpt-oss-120b");
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra composition is required.");

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/pr92-sparse-presentation");
mkdirSync(artifactDir, { recursive: true });
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  reusedEvidence: {
    ordinaryConversationRepeated: false,
    priorCognitionGeneralizationRepeated: false,
    coreRepeated: false,
    postgresRepeated: false,
    browserRepeated: false,
    priorSourcedRealModelRepeated: false,
  },
  route: {
    configured: config.solandraCognitionRoute,
    composedModel: solandra.model,
  },
  sparseHistorical: null,
  sourcedRegression: null,
  freshKnowledge: null,
  realModelObservations: [],
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

function governedProposal(overrides = {}) {
  return {
    mode: "GOVERNED",
    proposal: {
      objectiveRelation: "CONTINUE",
      proposedObjective: null,
      requestedHelp: "EXPLAIN_REFERENCE",
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
    },
    invocationProvenance: SETUP_PROVENANCE,
  };
}

function setupProjection(input) {
  return governedProposal({
    objectiveRelation: "NEW_OBJECTIVE",
    proposedObjective: input.message,
    requestedHelp: "KNOWLEDGE",
    knowledgeNeeds: ["bounded validation evidence needed to establish the requested historical Knowledge state"],
  });
}

function summarizeCognition(label, result) {
  const mode = result.mode === "CONVERSATION" ? "CONVERSATION" : "GOVERNED";
  const observation = {
    probe: label,
    mode,
    actualProvider: result.invocationProvenance.actualProvider ?? null,
    actualModel: result.invocationProvenance.actualModel ?? null,
    routeProvenance: result.invocationProvenance.routeProvenance ?? null,
    projection: mode === "GOVERNED" ? {
      objectiveRelation: result.proposal.objectiveRelation,
      requestedHelp: result.proposal.requestedHelp,
      knowledgeNeeds: result.proposal.knowledgeNeeds,
      materialAmbiguity: result.proposal.materialAmbiguity,
      referencedKnowledgeId: result.proposal.referencedKnowledgeId,
    } : null,
  };
  evidence.realModelObservations.push(observation);
  persist();
  console.log(`PR92_SPARSE_PRESENTATION_COGNITION=${JSON.stringify(observation)}`);
  return observation;
}

function realAfterSetupCognition() {
  let probe = null;
  return {
    setProbe(value) { probe = value; },
    runtime: {
      async interpret(input) {
        if (input.currentObjective === undefined && input.governedKnowledge.length === 0) {
          return setupProjection(input);
        }
        const result = await solandra.cognition.interpret(input);
        summarizeCognition(probe, result);
        return result;
      },
    },
  };
}

function sourcedCognition() {
  let mode = "reference";
  return {
    setFresh() { mode = "fresh"; },
    runtime: {
      async interpret(input) {
        if (input.currentObjective === undefined && input.governedKnowledge.length === 0) {
          return setupProjection(input);
        }
        if (mode === "reference") {
          const knowledgeId = input.governedKnowledge[0]?.knowledgeId ?? null;
          return governedProposal({
            requestedHelp: "EXPLAIN_REFERENCE",
            referencedKnowledgeId: knowledgeId,
          });
        }
        const result = await solandra.cognition.interpret(input);
        summarizeCognition("fresh-knowledge", result);
        return result;
      },
    },
  };
}

const FIXED_TIME = "2026-09-13T18:00:00.000Z";
class EmptyAcquisition {
  kind = "pr92-validation-empty-history";
  calls = [];
  async acquire(input) {
    this.calls.push(structuredClone(input));
    return { sources: [], claims: [] };
  }
}

class SourcedAcquisition {
  kind = "pr92-validation-sourced-history";
  calls = [];
  async acquire(input) {
    this.calls.push(structuredClone(input));
    const second = this.calls.length > 1;
    const sourceId = second ? "meridian-handbook-update" : "meridian-handbook-notice";
    const content = second
      ? "A later Meridian Archive notice reports an updated handbook publication date of September 5, 2026."
      : "The Meridian Archive handbook notice reports a publication date of July 12, 2026.";
    return {
      sources: [{
        sourceId,
        canonicalUri: `https://validation.example/${sourceId}`,
        title: second ? "Meridian Archive handbook update" : "Meridian Archive handbook notice",
        publisher: "Validation Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: second ? "2026-09-05T00:00:00.000Z" : "2026-07-12T00:00:00.000Z",
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

class SelectFirstSourcedFindingProvider {
  kind = "pr92-validation-presenter-selection";
  async generate(request) {
    return {
      response: {
        id: "pr92-validation-presenter-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            needsNewKnowledge: false,
            segments: [{ claimId: "claim-meridian-handbook-notice" }],
          }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "pr92-validation-presenter-request",
      },
    };
  }
}

class NeverCalledSparsePresenterProvider {
  kind = "pr92-validation-sparse-presenter-must-not-run";
  calls = 0;
  async generate() {
    this.calls += 1;
    throw new Error("Sparse historical presentation unexpectedly invoked a model.");
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

let sparseApp;
let sourcedApp;
try {
  const sparseAcquisition = new EmptyAcquisition();
  const sparseCognition = realAfterSetupCognition();
  const sparsePresenterProvider = new NeverCalledSparsePresenterProvider();
  const sparsePresenter = new ModelSolandraKnowledgePresenter(
    new ModelRuntime(sparsePresenterProvider),
    "pr92-sparse-structural-presenter",
  );
  sparseApp = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(sparseAcquisition),
    solandraCognition: sparseCognition.runtime,
    solandraKnowledgePresenter: sparsePresenter,
  });

  const sparseConversation = await createConversation(sparseApp);
  const sparseSetup = await submit(
    sparseApp,
    sparseConversation,
    "Please establish whether the fictional Willow Ferry issued a public accessibility bulletin in 2026.",
  );
  assert.equal(sparseSetup.status, "RUN_ACCEPTED");
  const sparseOutcome = await completedOutcome(sparseApp, sparseSetup.runId);
  const sparseState = await continuity(sparseApp, sparseConversation);
  const sparseKnowledge = latestKnowledge(sparseState);
  assert.ok(sparseKnowledge?.knowledgeId);
  assert.equal(sparseOutcome.findings.length, 0);
  assert.deepEqual(sparseOutcome.provenance, []);
  assert.ok(sparseOutcome.uncertainties.length > 0);

  sparseCognition.setProbe("sparse-historical");
  const beforeSparse = await continuity(sparseApp, sparseConversation);
  const sparseFollow = await submit(
    sparseApp,
    sparseConversation,
    "Looking only at that earlier result, what did it actually establish, and what remained uncertain?",
  );
  const afterSparse = await continuity(sparseApp, sparseConversation);
  const sparseObservation = evidence.realModelObservations.find((item) => item.probe === "sparse-historical") ?? null;
  evidence.sparseHistorical = {
    cognition: sparseObservation,
    status: sparseFollow.status,
    establishedKnowledgeId: sparseKnowledge.knowledgeId,
    returnedKnowledgeId: sparseFollow.knowledgeReference?.knowledgeId ?? null,
    runDelta: delta(afterSparse, beforeSparse, "runs"),
    knowledgeDelta: delta(afterSparse, beforeSparse, "knowledge"),
    assistantMessage: sparseFollow.presentation?.assistantMessage ?? null,
    priorUncertainties: sparseOutcome.uncertainties,
    returnedUncertainties: sparseFollow.knowledge?.uncertainties ?? null,
    priorProvenance: sparseOutcome.provenance,
    returnedProvenance: sparseFollow.knowledge?.provenance ?? null,
    presenterModelCalls: sparsePresenterProvider.calls,
  };
  persist();
  assert.equal(sparseObservation?.mode, "GOVERNED");
  assert.ok(["EXPLAIN_REFERENCE", "SIMPLIFY_REFERENCE"].includes(sparseObservation?.projection?.requestedHelp));
  assert.equal(sparseObservation?.projection?.referencedKnowledgeId, sparseKnowledge.knowledgeId);
  assert.equal(sparseFollow.status, "REFERENCE_RESOLVED");
  assert.equal(evidence.sparseHistorical.runDelta, 0);
  assert.equal(evidence.sparseHistorical.knowledgeDelta, 0);
  assert.equal(sparseFollow.knowledgeReference?.knowledgeId, sparseKnowledge.knowledgeId);
  assert.deepEqual(sparseFollow.knowledge?.uncertainties, sparseOutcome.uncertainties);
  assert.deepEqual(sparseFollow.knowledge?.provenance, sparseOutcome.provenance);
  for (const uncertainty of sparseOutcome.uncertainties) {
    assert.ok(sparseFollow.presentation?.assistantMessage?.includes(uncertainty));
  }
  assert.ok(sparseFollow.presentation?.assistantMessage?.includes("contains no governed findings"));
  assert.ok(sparseFollow.presentation?.assistantMessage?.includes("No admitted source is linked to this established Knowledge"));
  assert.equal(sparsePresenterProvider.calls, 0);

  const sourcedAcquisition = new SourcedAcquisition();
  const sourcedReferenceCognition = sourcedCognition();
  const sourcedPresenter = new ModelSolandraKnowledgePresenter(
    new ModelRuntime(new SelectFirstSourcedFindingProvider()),
    "pr92-sourced-regression-presenter",
  );
  sourcedApp = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(sourcedAcquisition),
    solandraCognition: sourcedReferenceCognition.runtime,
    solandraKnowledgePresenter: sourcedPresenter,
  });

  const sourcedConversation = await createConversation(sourcedApp);
  const sourcedSetup = await submit(
    sourcedApp,
    sourcedConversation,
    "Please establish the publication date reported for the fictional Meridian Archive handbook.",
  );
  assert.equal(sourcedSetup.status, "RUN_ACCEPTED");
  const sourcedOutcome = await completedOutcome(sourcedApp, sourcedSetup.runId);
  const sourcedState = await continuity(sourcedApp, sourcedConversation);
  const sourcedKnowledge = latestKnowledge(sourcedState);
  assert.ok(sourcedKnowledge?.knowledgeId);
  assert.ok(sourcedOutcome.findings.length > 0);
  assert.ok(sourcedOutcome.provenance.length > 0);

  const beforeSourced = await continuity(sourcedApp, sourcedConversation);
  const sourcedFollow = await submit(
    sourcedApp,
    sourcedConversation,
    "Summarize the established result and its support without doing another search.",
  );
  const afterSourced = await continuity(sourcedApp, sourcedConversation);
  evidence.sourcedRegression = {
    cognition: {
      mode: "GOVERNED",
      requestedHelp: sourcedFollow.interpretation?.requestedHelp ?? null,
      referencedKnowledgeId: sourcedFollow.interpretation?.referencedKnowledgeId ?? null,
      provenance: "deterministic unchanged reference semantics",
    },
    status: sourcedFollow.status,
    establishedKnowledgeId: sourcedKnowledge.knowledgeId,
    returnedKnowledgeId: sourcedFollow.knowledgeReference?.knowledgeId ?? null,
    runDelta: delta(afterSourced, beforeSourced, "runs"),
    knowledgeDelta: delta(afterSourced, beforeSourced, "knowledge"),
    assistantMessage: sourcedFollow.presentation?.assistantMessage ?? null,
    priorUncertainties: sourcedOutcome.uncertainties,
    returnedUncertainties: sourcedFollow.knowledge?.uncertainties ?? null,
    priorProvenance: sourcedOutcome.provenance,
    returnedProvenance: sourcedFollow.knowledge?.provenance ?? null,
  };
  persist();
  assert.equal(sourcedFollow.status, "REFERENCE_RESOLVED");
  assert.equal(sourcedFollow.interpretation?.requestedHelp, "EXPLAIN_REFERENCE");
  assert.equal(sourcedFollow.interpretation?.referencedKnowledgeId, sourcedKnowledge.knowledgeId);
  assert.equal(evidence.sourcedRegression.runDelta, 0);
  assert.equal(evidence.sourcedRegression.knowledgeDelta, 0);
  assert.equal(sourcedFollow.knowledgeReference?.knowledgeId, sourcedKnowledge.knowledgeId);
  assert.deepEqual(sourcedFollow.knowledge?.provenance, sourcedOutcome.provenance);
  assert.deepEqual(sourcedFollow.knowledge?.uncertainties, sourcedOutcome.uncertainties);
  assert.ok(sourcedFollow.presentation?.assistantMessage?.includes("Meridian Archive handbook notice"));
  assert.ok(sourcedFollow.presentation?.assistantMessage?.includes("https://validation.example/meridian-handbook-notice"));

  sourcedReferenceCognition.setFresh();
  const beforeFresh = await continuity(sourcedApp, sourcedConversation);
  const originalKnowledge = beforeFresh.knowledge.find((item) => item.knowledgeId === sourcedKnowledge.knowledgeId);
  assert.ok(originalKnowledge);
  const freshFollow = await submit(
    sourcedApp,
    sourcedConversation,
    "Please do a fresh external check for any newer Meridian Archive notice that changes the earlier publication-date result.",
  );
  assert.equal(freshFollow.status, "RUN_ACCEPTED");
  assert.ok(freshFollow.runId);
  const freshOutcome = await completedOutcome(sourcedApp, freshFollow.runId);
  const afterFresh = await continuity(sourcedApp, sourcedConversation);
  const freshObservation = evidence.realModelObservations.find((item) => item.probe === "fresh-knowledge") ?? null;
  evidence.freshKnowledge = {
    cognition: freshObservation,
    status: freshFollow.status,
    referencedKnowledgeId: freshObservation?.projection?.referencedKnowledgeId ?? null,
    runDelta: delta(afterFresh, beforeFresh, "runs"),
    knowledgeDelta: delta(afterFresh, beforeFresh, "knowledge"),
    originalKnowledgeStillPresent: afterFresh.knowledge.some((item) => item.knowledgeId === sourcedKnowledge.knowledgeId),
    acquisitionCalls: sourcedAcquisition.calls.length,
    newOutcomeFindings: freshOutcome.findings,
    newOutcomeProvenance: freshOutcome.provenance,
    newOutcomeUncertainties: freshOutcome.uncertainties,
  };
  persist();
  assert.equal(freshObservation?.mode, "GOVERNED");
  assert.ok(["FRESH_RESEARCH", "KNOWLEDGE"].includes(freshObservation?.projection?.requestedHelp));
  assert.equal(evidence.freshKnowledge.runDelta, 1);
  assert.equal(evidence.freshKnowledge.knowledgeDelta, 1);
  assert.equal(evidence.freshKnowledge.originalKnowledgeStillPresent, true);
  assert.equal(sourcedAcquisition.calls.length, 2);

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  evidence.status = "PASS";
  persist();
  console.log("PR92_SPARSE_HISTORICAL_PRODUCT_PROOF=PASS");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await sparseApp?.close();
  await sourcedApp?.close();
}
