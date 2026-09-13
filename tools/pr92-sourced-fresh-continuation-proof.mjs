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
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "pr92-sourced-fresh-validator",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra);

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/pr92-sourced-fresh");
mkdirSync(artifactDir, { recursive: true });
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  reusedSparseHistorical: {
    workflowRunId: 34773618183,
    repeated: false,
    result: "PASS before validation-helper sourced regression failure",
  },
  sourcedRegression: null,
  freshKnowledge: null,
  realModelObservations: [],
  status: "RUNNING",
};
const persist = () => writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
persist();

const FIXTURE_PROVENANCE = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "validation-fixture",
  requestedModel: "validation-fixture",
  actualProvider: "validation-fixture",
  actualModel: "validation-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "validation-fixture",
  routeProvenance: "COMPLETE",
});

function proposal(overrides = {}) {
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
    invocationProvenance: FIXTURE_PROVENANCE,
  };
}

function cognitionController() {
  let fresh = false;
  return {
    setFresh() { fresh = true; },
    runtime: {
      async interpret(input) {
        if (input.currentObjective === undefined && input.governedKnowledge.length === 0) {
          return proposal({
            objectiveRelation: "NEW_OBJECTIVE",
            proposedObjective: input.message,
            requestedHelp: "KNOWLEDGE",
            knowledgeNeeds: ["establish the requested historical Knowledge state"],
          });
        }
        if (!fresh) {
          return proposal({
            requestedHelp: "EXPLAIN_REFERENCE",
            referencedKnowledgeId: input.governedKnowledge[0]?.knowledgeId ?? null,
          });
        }
        const result = await solandra.cognition.interpret(input);
        const mode = result.mode === "CONVERSATION" ? "CONVERSATION" : "GOVERNED";
        const observation = {
          mode,
          actualProvider: result.invocationProvenance.actualProvider ?? null,
          actualModel: result.invocationProvenance.actualModel ?? null,
          routeProvenance: result.invocationProvenance.routeProvenance ?? null,
          projection: mode === "GOVERNED" ? {
            objectiveRelation: result.proposal.objectiveRelation,
            requestedHelp: result.proposal.requestedHelp,
            referencedKnowledgeId: result.proposal.referencedKnowledgeId,
            knowledgeNeeds: result.proposal.knowledgeNeeds,
            materialAmbiguity: result.proposal.materialAmbiguity,
          } : null,
        };
        evidence.realModelObservations.push(observation);
        persist();
        console.log(`PR92_FRESH_COGNITION=${JSON.stringify(observation)}`);
        return result;
      },
    },
  };
}

const FIXED_TIME = "2026-09-13T18:05:00.000Z";
class SourcedAcquisition {
  kind = "pr92-validation-sourced-continuation";
  calls = [];
  async acquire(input) {
    this.calls.push(structuredClone(input));
    const second = this.calls.length > 1;
    const sourceId = second ? "cedar-manual-update" : "cedar-manual-release";
    const content = second
      ? "A later Cedar Manual notice reports a revised publication date of September 8, 2026."
      : "The Cedar Manual release notice reports a publication date of June 18, 2026.";
    return {
      sources: [{
        sourceId,
        canonicalUri: `https://validation.example/${sourceId}`,
        title: second ? "Cedar Manual update notice" : "Cedar Manual release notice",
        publisher: "Validation Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: second ? "2026-09-08T00:00:00.000Z" : "2026-06-18T00:00:00.000Z",
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

class SelectActualGovernedFindingProvider {
  kind = "pr92-validation-select-governed-finding";
  async generate(request) {
    const prompt = request.messages.map((message) => message.content).join("\n");
    const claimId = /^\[([^\]]+)\] status=/mu.exec(prompt)?.[1];
    assert.ok(claimId, "Validation presenter could not locate a supplied governed finding ID.");
    return {
      response: {
        id: "pr92-validation-presentation-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify({
          needsNewKnowledge: false,
          segments: [{ claimId }],
        }) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "pr92-validation-presentation-request",
      },
    };
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
const delta = (after, before, key) => (after[key]?.length ?? 0) - (before[key]?.length ?? 0);
const latestKnowledge = (state) => state.knowledge?.at(-1) ?? null;

const acquisition = new SourcedAcquisition();
const cognition = cognitionController();
const presenter = new ModelSolandraKnowledgePresenter(
  new ModelRuntime(new SelectActualGovernedFindingProvider()),
  "pr92-sourced-regression-presenter",
);
const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
  solandraCognition: cognition.runtime,
  solandraKnowledgePresenter: presenter,
});

try {
  const conversationId = await createConversation(app);
  const setup = await submit(
    app,
    conversationId,
    "Please establish the publication date reported for the fictional Cedar Manual release.",
  );
  assert.equal(setup.status, "RUN_ACCEPTED");
  const initialOutcome = await completedOutcome(app, setup.runId);
  const establishedState = await continuity(app, conversationId);
  const establishedKnowledge = latestKnowledge(establishedState);
  assert.ok(establishedKnowledge?.knowledgeId);
  assert.ok(initialOutcome.findings.length > 0);
  assert.ok(initialOutcome.provenance.length > 0);

  const beforeReference = await continuity(app, conversationId);
  const reference = await submit(
    app,
    conversationId,
    "Explain the established result and its support without doing another search.",
  );
  const afterReference = await continuity(app, conversationId);
  evidence.sourcedRegression = {
    cognition: {
      mode: "GOVERNED",
      requestedHelp: reference.interpretation?.requestedHelp ?? null,
      referencedKnowledgeId: reference.interpretation?.referencedKnowledgeId ?? null,
      source: "deterministic unchanged reference semantics",
    },
    status: reference.status,
    establishedKnowledgeId: establishedKnowledge.knowledgeId,
    returnedKnowledgeId: reference.knowledgeReference?.knowledgeId ?? null,
    runDelta: delta(afterReference, beforeReference, "runs"),
    knowledgeDelta: delta(afterReference, beforeReference, "knowledge"),
    assistantMessage: reference.presentation?.assistantMessage ?? null,
    priorProvenance: initialOutcome.provenance,
    returnedProvenance: reference.knowledge?.provenance ?? null,
    priorUncertainties: initialOutcome.uncertainties,
    returnedUncertainties: reference.knowledge?.uncertainties ?? null,
  };
  persist();
  assert.equal(reference.status, "REFERENCE_RESOLVED");
  assert.equal(reference.interpretation?.requestedHelp, "EXPLAIN_REFERENCE");
  assert.equal(reference.interpretation?.referencedKnowledgeId, establishedKnowledge.knowledgeId);
  assert.equal(evidence.sourcedRegression.runDelta, 0);
  assert.equal(evidence.sourcedRegression.knowledgeDelta, 0);
  assert.equal(reference.knowledgeReference?.knowledgeId, establishedKnowledge.knowledgeId);
  assert.deepEqual(reference.knowledge?.provenance, initialOutcome.provenance);
  assert.deepEqual(reference.knowledge?.uncertainties, initialOutcome.uncertainties);
  assert.ok(reference.presentation?.assistantMessage?.includes("Cedar Manual release notice"));
  assert.ok(reference.presentation?.assistantMessage?.includes("https://validation.example/cedar-manual-release"));

  cognition.setFresh();
  const beforeFresh = await continuity(app, conversationId);
  const fresh = await submit(
    app,
    conversationId,
    "Please do a new external investigation for any later Cedar Manual notice that changes the earlier publication-date result.",
  );
  const freshObservation = evidence.realModelObservations.at(-1) ?? null;
  if (fresh.status === "RUN_ACCEPTED") {
    assert.ok(fresh.runId);
    await completedOutcome(app, fresh.runId);
  }
  const afterFresh = await continuity(app, conversationId);
  evidence.freshKnowledge = {
    cognition: freshObservation,
    status: fresh.status,
    referencedKnowledgeId: freshObservation?.projection?.referencedKnowledgeId ?? null,
    runDelta: delta(afterFresh, beforeFresh, "runs"),
    knowledgeDelta: delta(afterFresh, beforeFresh, "knowledge"),
    originalKnowledgeStillPresent: afterFresh.knowledge.some((item) => item.knowledgeId === establishedKnowledge.knowledgeId),
    acquisitionCalls: acquisition.calls.length,
  };
  persist();
  assert.equal(freshObservation?.mode, "GOVERNED");
  assert.ok(["FRESH_RESEARCH", "KNOWLEDGE"].includes(freshObservation?.projection?.requestedHelp));
  assert.equal(fresh.status, "RUN_ACCEPTED");
  assert.equal(evidence.freshKnowledge.runDelta, 1);
  assert.equal(evidence.freshKnowledge.knowledgeDelta, 1);
  assert.equal(evidence.freshKnowledge.originalKnowledgeStillPresent, true);
  assert.equal(acquisition.calls.length, 2);

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  evidence.status = "PASS";
  persist();
  console.log("PR92_SOURCED_FRESH_CONTINUATION_PROOF=PASS");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await app.close();
}
