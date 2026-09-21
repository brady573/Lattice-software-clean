import assert from "node:assert/strict";
import test from "node:test";
import type { RunRequest, StructuredDecision } from "../src/domain.js";
import { createDecision } from "../src/engine.js";
import { laptopFixture } from "./fixtures/legacy-laptop-fixture.js";
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
    "Solandra recommends Nova Air. The admitted evidence supports that recommendation under the requirements and priorities you confirmed. Atlas Pro, Forge 15 were excluded because admitted evidence did not satisfy every confirmed hard requirement.",
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
  if (decision.outcome !== "RECOMMENDATION") throw new Error("Fixture must produce a recommendation.");
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

test("Solandra explanation plan preserves non-winner authoritative decision outcomes", () => {
  const { truth } = authoritativeState();
  const common = {
    goal: request.goal,
    evaluations: laptopFixture.candidates.map((candidate) => ({
      candidateId: candidate.id,
      eligible: false,
      rawScore: 0,
      normalizedScore: 0,
      constraints: [],
      supportingEvidenceIds: [],
    })),
    rationale: ["Synthetic non-winner outcome preserved without a winner."],
    evidenceIds: [],
    truthAssessmentIds: [],
  };
  const scenarios: Array<{ decision: StructuredDecision; expected: RegExp }> = [
    {
      decision: { ...common, outcome: "FRONTIER", frontierCandidateIds: ["nova-air", "atlas-pro"], tiedCandidateIds: [], materialUnknowns: [] },
      expected: /^I can't justify a unique recommendation from the confirmed priorities\./,
    },
    {
      decision: { ...common, outcome: "TIE", frontierCandidateIds: ["nova-air", "forge-15"], tiedCandidateIds: ["nova-air", "forge-15"], materialUnknowns: [] },
      expected: /^I can't justify a unique recommendation because the qualified comparison found no meaningful difference\./,
    },
    {
      decision: { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: ["nova-air"], tiedCandidateIds: [], materialUnknowns: ["forge-15:batteryHours"] },
      expected: /^I can't justify a unique recommendation yet because required admitted evidence is missing\./,
    },
    {
      decision: { ...common, outcome: "UNRESOLVED", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: ["nova-air:batteryHours"] },
      expected: /^I can't justify a unique recommendation because a material qualified comparison remains unresolved\./,
    },
    {
      decision: { ...common, outcome: "NO_ELIGIBLE_CANDIDATE", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: [] },
      expected: /^I can't recommend an alternative because none is known to satisfy all confirmed hard requirements\./,
    },
  ];

  for (const scenario of scenarios) {
    const plan = createSolandraExplanationPlan(scenario.decision, laptopFixture.candidates, truth);
    assert.equal(plan.winnerCandidateId, undefined);
    assert.equal(plan.winnerLabel, undefined);
    assert.equal(plan.outcome, scenario.decision.outcome);
    assert.deepEqual(plan.frontierCandidateIds, scenario.decision.frontierCandidateIds);
    assert.deepEqual(plan.tiedCandidateIds, scenario.decision.tiedCandidateIds);
    assert.deepEqual(plan.materialUnknowns, scenario.decision.materialUnknowns);

    const explanation = renderCanonicalExplanation(plan);
    assert.match(explanation, scenario.expected);
    if (scenario.decision.frontierCandidateIds.length > 0) {
      const labels = scenario.decision.frontierCandidateIds.map((id) =>
        laptopFixture.candidates.find((candidate) => candidate.id === id)?.label);
      assert.match(explanation, new RegExp(`Alternatives still under consideration: ${labels.join(", ")}\\.`));
    }
    assert.doesNotMatch(explanation, /Authoritative frontier|Unresolved:|material dominance/iu);
    assert.doesNotThrow(() =>
      assertSolandraExplanationFidelity(explanation, plan, scenario.decision, laptopFixture.candidates, truth));
  }
});
