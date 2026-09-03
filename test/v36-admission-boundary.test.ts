import assert from "node:assert/strict";
import test from "node:test";
import type { RunRequest } from "../src/domain.js";
import { createDecisionFromAdmittedEvidence } from "../src/engine.js";
import { laptopFixture } from "./fixtures/legacy-laptop-fixture.js";
import type { AdmittedDecisionEvidence } from "../src/truth/admission.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { materializeFixtureDecisionEvidence } from "../src/truth/decision-evidence-provider.js";

const runId = "00000000-0000-4000-8000-000000000836";
const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

test("V36 materialization is the only valid decision-evidence boundary", () => {
  const truth = evaluateFixtureTruth(runId, laptopFixture);
  assert.equal("decisionEvidence" in truth, false);
  const decisionEvidence = materializeFixtureDecisionEvidence(laptopFixture, truth.bundle);
  assert.equal(decisionEvidence.length > 0, true);
  assert.equal(decisionEvidence.every((item) => item.admitted), true);

  const decision = createDecisionFromAdmittedEvidence(
    request,
    laptopFixture.candidates,
    decisionEvidence,
    truth.assessments.map((assessment) => assessment.id),
  );
  assert.equal(decision.winnerCandidateId, "nova-air");
});

test("raw admitted=true fixture evidence cannot bypass V36 admission", () => {
  assert.equal(laptopFixture.evidence.some((item) => item.admitted), true);
  const forged = laptopFixture.evidence as unknown as AdmittedDecisionEvidence[];

  assert.throws(
    () => createDecisionFromAdmittedEvidence(request, laptopFixture.candidates, forged, []),
    /did not originate from the V36 material-admission boundary/,
  );
});

test("generic serialization cannot preserve V36 decision authority", () => {
  const truth = evaluateFixtureTruth(runId, laptopFixture);
  const decisionEvidence = materializeFixtureDecisionEvidence(laptopFixture, truth.bundle);
  const serialized = JSON.parse(JSON.stringify(decisionEvidence)) as AdmittedDecisionEvidence[];

  assert.throws(
    () => createDecisionFromAdmittedEvidence(
      request,
      laptopFixture.candidates,
      serialized,
      truth.assessments.map((assessment) => assessment.id),
    ),
    /did not originate from the V36 material-admission boundary/,
  );
});
