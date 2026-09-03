import assert from "node:assert/strict";
import test from "node:test";
import { QualifiedCriterionCatalog } from "../src/decision/criterion-catalog.js";
import { buildDecisionInputSnapshot } from "../src/decision/decision-input-snapshot.js";
import { createGeneralizedDecisionFromAdmittedEvidence } from "../src/decision/generalized-engine.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { materializeFixtureDecisionEvidence } from "../src/truth/decision-evidence-provider.js";
import type { DecisionFixtureDataset } from "../src/truth/fixture-dataset.js";
import type { ProofCheckStatus, TruthClaimProfile } from "../src/truth/types.js";

const candidates = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
];

function passedChecks(claimType: TruthClaimProfile["claimType"]): Readonly<Record<string, ProofCheckStatus>> {
  return Object.fromEntries(requiredProofObligations(claimType).map((kind) => [kind, "PASSED"]));
}

function admitted(values: ReadonlyArray<readonly [string, string, string | number | boolean]>) {
  const dataset: DecisionFixtureDataset = {
    candidates,
    evidence: values.map(([candidateId, criterion, value]) => ({
      id: `e-${candidateId}-${criterion}`,
      candidateId,
      criterion,
      value,
      sourceId: "source-scale-fixture",
      sourceLabel: "Scale isolation fixture",
      admitted: true,
    })),
    truthClaims: values.map(([candidateId, criterion]) => ({
      id: `claim-${candidateId}-${criterion}`,
      text: `${candidateId}.${criterion} has the recorded fixture value`,
      claimType: typeof values.find((item) => item[0] === candidateId && item[1] === criterion)?.[2] === "number"
        ? "QUANTITATIVE" as const
        : "FACTUAL" as const,
      candidateId,
      criterion,
      evidenceIds: [`e-${candidateId}-${criterion}`],
      scope: candidateId,
      ...(typeof values.find((item) => item[0] === candidateId && item[1] === criterion)?.[2] === "number"
        ? {
            unit: criterion,
            denominator: "alternative",
            baseline: "fixture",
            period: "test-static",
            evidenceRisk: "ORDINARY" as const,
          }
        : {}),
      checks: passedChecks(
        typeof values.find((item) => item[0] === candidateId && item[1] === criterion)?.[2] === "number"
          ? "QUANTITATIVE"
          : "FACTUAL",
      ),
      materiallyMisleading: false,
    })),
    truthEvidence: values.map(([candidateId, criterion]) => ({
      evidenceId: `e-${candidateId}-${criterion}`,
      claimId: `claim-${candidateId}-${criterion}`,
      provenanceComponentKey: "source-scale-fixture",
      provenanceConfidence: "HIGH" as const,
      relation: "SUPPORTS" as const,
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED" as const,
    })),
  };
  const truth = evaluateFixtureTruth("00000000-0000-4000-8000-000000009901", dataset);
  return materializeFixtureDecisionEvidence(dataset, truth.bundle);
}

const catalog = new QualifiedCriterionCatalog(1, [
  {
    criterionId: "large-scale",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
  {
    criterionId: "small-scale",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
  {
    criterionId: "category",
    version: 1,
    valueType: "STRING",
    preferenceDirection: "MATCH_ONLY",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 0 },
  },
]);

function input(priorities: Array<{ criterionId: string; tier: "MATTERS_MOST" | "IMPORTANT" }> = [
  { criterionId: "large-scale", tier: "MATTERS_MOST" },
  { criterionId: "small-scale", tier: "MATTERS_MOST" },
]) {
  return buildDecisionInputSnapshot({
    intentScopeId: "scope-scale",
    intentVersionId: "intent-scale-v1",
    objective: "Compare the qualified alternatives.",
    hardRequirements: [],
    priorities,
    tolerances: [],
  }, catalog);
}

test("incompatible raw numeric scales cannot manufacture a winner", () => {
  const decision = createGeneralizedDecisionFromAdmittedEvidence(
    input(),
    catalog,
    candidates,
    admitted([
      ["alpha", "large-scale", 10_000],
      ["beta", "large-scale", 100],
      ["alpha", "small-scale", 1],
      ["beta", "small-scale", 10],
    ]),
    [],
  );
  assert.equal(decision.outcome, "FRONTIER");
  assert.equal(decision.winnerCandidateId, undefined);
  assert.deepEqual(decision.frontierCandidateIds, ["alpha", "beta"]);
  assert.equal(decision.evaluations.every((evaluation) => evaluation.rawScore === 0), true);
});

test("missing admitted comparison evidence remains INSUFFICIENT_EVIDENCE", () => {
  const decision = createGeneralizedDecisionFromAdmittedEvidence(
    input(),
    catalog,
    candidates,
    admitted([
      ["alpha", "large-scale", 10],
      ["beta", "large-scale", 9],
      ["alpha", "small-scale", 2],
    ]),
    [],
  );
  assert.equal(decision.outcome, "INSUFFICIENT_EVIDENCE");
  assert.equal(decision.winnerCandidateId, undefined);
});

test("no meaningful difference remains a TIE without a forced winner", () => {
  const decision = createGeneralizedDecisionFromAdmittedEvidence(
    input([{ criterionId: "small-scale", tier: "MATTERS_MOST" }]),
    catalog,
    candidates,
    admitted([
      ["alpha", "small-scale", 7],
      ["beta", "small-scale", 7],
    ]),
    [],
  );
  assert.equal(decision.outcome, "TIE");
  assert.deepEqual(decision.tiedCandidateIds, ["alpha", "beta"]);
  assert.equal(decision.winnerCandidateId, undefined);
});

test("unavailable qualified comparison semantics remain UNRESOLVED", () => {
  const decision = createGeneralizedDecisionFromAdmittedEvidence(
    input([{ criterionId: "category", tier: "MATTERS_MOST" }]),
    catalog,
    candidates,
    admitted([
      ["alpha", "category", "one"],
      ["beta", "category", "two"],
    ]),
    [],
  );
  assert.equal(decision.outcome, "UNRESOLVED");
  assert.equal(decision.winnerCandidateId, undefined);
});

test("requirement-only elimination is valid without inventing a preference", () => {
  const decisionInput = buildDecisionInputSnapshot({
    intentScopeId: "scope-requirement",
    intentVersionId: "intent-requirement-v1",
    objective: "Retain alternatives meeting the threshold.",
    hardRequirements: [{ criterionId: "small-scale", operator: "GTE", expected: 5 }],
    priorities: [],
    tolerances: [],
  }, catalog);
  const decision = createGeneralizedDecisionFromAdmittedEvidence(
    decisionInput,
    catalog,
    candidates,
    admitted([
      ["alpha", "small-scale", 3],
      ["beta", "small-scale", 8],
    ]),
    [],
  );
  assert.equal(decision.outcome, "RECOMMENDATION");
  assert.equal(decision.winnerCandidateId, "beta");
});
