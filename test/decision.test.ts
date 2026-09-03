import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyTestApp as buildApp } from "../src/legacy/legacy-test-app.js";
import type { RunRequest } from "../src/domain.js";
import { createDecision, explainDecision } from "../src/engine.js";
import {
  createLegacyDecisionTruthComposition,
  laptopFixture,
} from "./fixtures/legacy-laptop-fixture.js";
import { MemoryRunStore } from "../src/run-store.js";
import { executePersistedRun } from "../src/run-execution.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

test("hard constraints override a higher normalized preference utility", () => {
  const decision = createDecision(request, laptopFixture);
  assert.equal(decision.winnerCandidateId, "nova-air");
  const atlas = decision.evaluations.find((item) => item.candidateId === "atlas-pro");
  const nova = decision.evaluations.find((item) => item.candidateId === "nova-air");
  assert.ok(atlas);
  assert.ok(nova);
  assert.equal(atlas.rawScore > nova.rawScore, true);
  assert.equal(atlas.eligible, false);
  assert.equal(nova.eligible, true);
});

test("priority weights and criterion scales are normalized before compatibility scoring", () => {
  const weightedRequest: RunRequest = {
    ...request,
    priorities: [
      { criterion: "performance", weight: 2 },
      { criterion: "batteryHours", weight: 1 },
    ],
  };
  const scaledRequest: RunRequest = {
    ...weightedRequest,
    priorities: weightedRequest.priorities.map((priority: { criterion: string; weight: number }) => ({
      ...priority,
      weight: priority.weight * 10,
    })),
  };
  const weightedDecision = createDecision(weightedRequest, laptopFixture);
  const scaledDecision = createDecision(scaledRequest, laptopFixture);
  const weightedNova = weightedDecision.evaluations.find((item) => item.candidateId === "nova-air");
  const scaledNova = scaledDecision.evaluations.find((item) => item.candidateId === "nova-air");
  assert.ok(weightedNova);
  assert.ok(scaledNova);
  assert.ok(weightedNova.rawScore >= 0 && weightedNova.rawScore <= 1);
  assert.equal(scaledNova.rawScore, weightedNova.rawScore);
  assert.equal(scaledDecision.winnerCandidateId, weightedDecision.winnerCandidateId);
});

test("unknown hard-constraint evidence cannot be treated as passing", () => {
  const dataset = {
    ...laptopFixture,
    truthEvidence: laptopFixture.truthEvidence.map((profile) =>
      profile.evidenceId === "e-nova-battery"
        ? { ...profile, verification: "UNVERIFIED" as const }
        : profile,
    ),
  };
  assert.equal(dataset.evidence.find((item) => item.id === "e-nova-battery")?.admitted, true);
  assert.equal(createDecision(request, dataset).outcome, "UNRESOLVED");
});

test("legacy admitted=true cannot override a failed V36 claim proof obligation", () => {
  const dataset = {
    ...laptopFixture,
    truthClaims: laptopFixture.truthClaims.map((profile) =>
      profile.id === "claim-nova-air-batteryHours"
        ? {
            ...profile,
            checks: { ...profile.checks, SOURCE_VALUE: "FAILED" as const },
          }
        : profile,
    ),
  };
  assert.equal(dataset.evidence.find((item) => item.id === "e-nova-battery")?.admitted, true);
  assert.equal(createDecision(request, dataset).outcome, "UNRESOLVED");
});

test("an eligible candidate does not force a winner while another candidate's eligibility is unresolved", () => {
  const dataset = {
    ...laptopFixture,
    truthEvidence: laptopFixture.truthEvidence.map((profile) =>
      profile.evidenceId === "e-forge-battery"
        ? { ...profile, verification: "UNVERIFIED" as const }
        : profile),
  };
  const decision = createDecision(request, dataset);
  assert.equal(decision.outcome, "UNRESOLVED");
  assert.equal(decision.winnerCandidateId, undefined);
  assert.deepEqual(decision.frontierCandidateIds, ["nova-air"]);
  assert.deepEqual(decision.materialUnknowns, ["forge-15:batteryHours"]);
});

test("Solandra explanation remains faithful to the structured decision", () => {
  const decision = createDecision(request, laptopFixture);
  const explanation = explainDecision(decision, laptopFixture);
  assert.match(explanation, /Nova Air/);
  assert.doesNotMatch(explanation, /recommends Atlas Pro/);
});

test("API creates a persisted-truth, persisted-decision V36 run", async () => {
  const app = buildApp(createLegacyDecisionTruthComposition());
  const create = await app.inject({ method: "POST", url: "/runs", payload: request });
  assert.equal(create.statusCode, 201);
  const run = create.json();
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.version, 8);
  assert.equal(run.decision.winnerCandidateId, "nova-air");
  assert.equal(run.decision.truthAssessmentIds.length, 9);
  assert.match(run.explanation, /Nova Air/);

  const retrieve = await app.inject({ method: "GET", url: `/runs/${run.id}` });
  assert.equal(retrieve.statusCode, 200);
  assert.deepEqual(retrieve.json(), run);
  await app.close();
});

test("API persists a non-winner UNRESOLVED decision as authoritative Run storage state", async () => {
  const dataset = {
    ...laptopFixture,
    truthEvidence: laptopFixture.truthEvidence.map((profile) =>
      profile.evidenceId === "e-nova-battery"
        ? { ...profile, verification: "UNVERIFIED" as const }
        : profile),
  };
  const app = buildApp(createLegacyDecisionTruthComposition(dataset));
  try {
    const create = await app.inject({ method: "POST", url: "/runs", payload: request });
    assert.equal(create.statusCode, 201, create.body);
    const run = create.json();
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.decision.outcome, "UNRESOLVED");
    assert.equal(run.decision.winnerCandidateId, undefined);
    assert.ok(run.decision.materialUnknowns.length > 0);
    assert.equal(run.explanation, "Solandra reports unresolved. Unresolved: nova-air:batteryHours.");

    const retrieve = await app.inject({ method: "GET", url: `/runs/${run.id}` });
    assert.equal(retrieve.statusCode, 200);
    assert.deepEqual(retrieve.json(), run);
  } finally {
    await app.close();
  }
});

test("versioned API accepts a durable Run before worker execution and exposes polling lifecycle", async () => {
  const store = new MemoryRunStore();
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const app = buildApp({
    runStore: store,
    truthPipeline: pipeline,
    decisionEvidenceProvider: createLegacyDecisionTruthComposition().decisionEvidenceProvider,
  });
  const submit = await app.inject({
    method: "POST",
    url: "/api/v1/conversations/demo/messages",
    payload: request,
  });
  assert.equal(submit.statusCode, 202);
  const accepted = submit.json();
  assert.equal(accepted.status, "CREATED");

  const initialRunResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}` });
  assert.equal(initialRunResponse.statusCode, 200);
  assert.equal(initialRunResponse.json().status, "CREATED");
  assert.equal(initialRunResponse.json().version, 1);

  const initialEvents = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/events` });
  assert.deepEqual(
    initialEvents.json().events.map((event: { sequence: number; type: string }) => [event.sequence, event.type]),
    [[1, "CREATED"]],
  );
  const pendingResult = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/result` });
  assert.equal(pendingResult.statusCode, 409);
  assert.equal(pendingResult.json().status, "CREATED");

  await executePersistedRun(
    store,
    pipeline,
    accepted.runId,
    undefined,
    undefined,
    createLegacyDecisionTruthComposition().decisionEvidenceProvider,
  );

  const runResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}` });
  assert.equal(runResponse.statusCode, 200);
  const run = runResponse.json();
  assert.equal(run.conversationId, "demo");
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.version, 8);

  const eventsResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/events` });
  assert.equal(eventsResponse.statusCode, 200);
  assert.deepEqual(
    eventsResponse.json().events.map((event: { sequence: number; type: string }) => [event.sequence, event.type]),
    [
      [1, "CREATED"],
      [2, "UNDERSTANDING"],
      [3, "PLANNING"],
      [4, "INVESTIGATING"],
      [5, "VALIDATING"],
      [6, "DECIDING"],
      [7, "EXPLAINING"],
      [8, "COMPLETED"],
    ],
  );

  const resultResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/result` });
  assert.equal(resultResponse.statusCode, 200);
  const result = resultResponse.json();
  assert.equal(result.decision.winnerCandidateId, "nova-air");
  assert.equal(result.decision.truthAssessmentIds.length, 9);
  assert.match(result.explanation, /Nova Air/);
  await app.close();
});
