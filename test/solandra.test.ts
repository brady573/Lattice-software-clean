import assert from "node:assert/strict";
import test from "node:test";
import type { RunRequest } from "../src/domain.js";
import { createDecision } from "../src/engine.js";
import { laptopFixture } from "../src/fixtures.js";
import {
  assertSolandraExplanationFidelity,
  assertSolandraPlanFidelity,
  createSolandraExplanationPlan,
  renderCanonicalExplanation,
} from "../src/presentation/solandra/index.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";

const deterministicRunId = "00000000-0000-4000-8000-000000000036";
const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

function authoritativeState() {
  const decision = createDecision(request, laptopFixture);
  const truth = evaluateFixtureTruth(deterministicRunId, laptopFixture).bundle;
  const plan = createSolandraExplanationPlan(decision, laptopFixture.candidates, truth);
  return { decision, truth, plan };
}

test("Solandra plan is derived from persisted decision and licensed truth state", () => {
  const { decision, plan } = authoritativeState();
  assert.equal(plan.winnerCandidateId, decision.winnerCandidateId);
  assert.deepEqual(plan.evidenceIds, decision.evidenceIds);
  assert.deepEqual(plan.truthAssessmentIds, decision.truthAssessmentIds);
  assert.equal(plan.truthReferences.length, decision.truthAssessmentIds.length);
  assert.equal(plan.candidates.find((candidate) => candidate.candidateId === "atlas-pro")?.eligible, false);
  assert.equal(plan.candidates.find((candidate) => candidate.candidateId === "forge-15")?.eligible, false);
});

test("Solandra preserves the current deterministic canonical explanation", () => {
  const { plan } = authoritativeState();
  assert.equal(
    renderCanonicalExplanation(plan),
    "Solandra recommends Nova Air. It satisfies every hard constraint and has the strongest weighted preference score among the remaining eligible candidates. 2 candidate(s) were excluded because admitted evidence did not satisfy every hard constraint.",
  );
});

test("Solandra plan and rendering replay deterministically", () => {
  const first = authoritativeState();
  const second = authoritativeState();
  assert.deepEqual(first.plan, second.plan);
  assert.equal(renderCanonicalExplanation(first.plan), renderCanonicalExplanation(second.plan));
});

test("Solandra rejects a presentation plan that names a different winner", () => {
  const { decision, truth, plan } = authoritativeState();
  const altered = { ...plan, winnerCandidateId: "atlas-pro", winnerLabel: "Atlas Pro" };
  assert.throws(
    () => assertSolandraPlanFidelity(altered, decision, laptopFixture.candidates, truth),
    /plan diverges from persisted structured authority/,
  );
});

test("Solandra rejects a presentation plan that changes eligibility", () => {
  const { decision, truth, plan } = authoritativeState();
  const altered = {
    ...plan,
    candidates: plan.candidates.map((candidate) =>
      candidate.candidateId === "atlas-pro" ? { ...candidate, eligible: true } : candidate,
    ),
  };
  assert.throws(
    () => assertSolandraPlanFidelity(altered, decision, laptopFixture.candidates, truth),
    /plan diverges from persisted structured authority/,
  );
});

test("Solandra cannot license invented evidence through presentation", () => {
  const { decision, truth } = authoritativeState();
  const alteredDecision = { ...decision, evidenceIds: [...decision.evidenceIds, "invented-evidence"] };
  assert.throws(
    () => createSolandraExplanationPlan(alteredDecision, laptopFixture.candidates, truth),
    /V36 did not admit as material TRUE/,
  );
});

test("Solandra cannot license an invented truth assessment through presentation", () => {
  const { decision, truth } = authoritativeState();
  const alteredDecision = {
    ...decision,
    truthAssessmentIds: [...decision.truthAssessmentIds, "invented-assessment"],
  };
  assert.throws(
    () => createSolandraExplanationPlan(alteredDecision, laptopFixture.candidates, truth),
    /truth assessment outside the persisted bundle/,
  );
});

test("Solandra cannot explain an ineligible candidate as the authoritative winner", () => {
  const { decision, truth } = authoritativeState();
  const alteredDecision = { ...decision, winnerCandidateId: "atlas-pro" };
  assert.throws(
    () => createSolandraExplanationPlan(alteredDecision, laptopFixture.candidates, truth),
    /winner that is not eligible/,
  );
});

test("unsupported material prose fails explanation fidelity", () => {
  const { decision, truth, plan } = authoritativeState();
  const explanation = `${renderCanonicalExplanation(plan)} Atlas Pro is independently certified as the fastest laptop.`;
  assert.throws(
    () => assertSolandraExplanationFidelity(
      explanation,
      plan,
      decision,
      laptopFixture.candidates,
      truth,
    ),
    /introduces unsupported material content/,
  );
});
