import assert from "node:assert/strict";
import test from "node:test";
import type { FixtureDataset } from "../src/truth/fixture-dataset.js";
import { laptopFixture } from "./fixtures/legacy-laptop-fixture.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { evaluatePositiveBurden } from "../src/truth/positive-burden.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import type { ClaimEvidence, CompiledClaim, ProofCheckStatus } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000436";

function factualClaim(evidenceRisk: "ORDINARY" | "HIGH"): CompiledClaim {
  return {
    id: "claim-high-risk",
    runId,
    text: "material factual claim",
    claimType: "FACTUAL",
    scope: "prototype",
    effectiveAt: null,
    jurisdiction: null,
    unit: null,
    denominator: null,
    baseline: null,
    period: null,
    causalRelation: null,
    authenticityTarget: null,
    comparisonClass: null,
    quotedContext: null,
    qualifiers: [],
    evidenceRisk,
  };
}

function support(id: string, component: string, primary = false): ClaimEvidence {
  return {
    id: `ce-${id}`,
    runId,
    claimId: "claim-high-risk",
    artifactId: `artifact-${id}`,
    externalEvidenceId: id,
    relation: "SUPPORTS",
    specificEvidence: id,
    provenanceComponentKey: component,
    provenanceConfidence: "HIGH",
    authoritativePrimary: primary,
    researchQuestionId: null,
    verification: "VERIFIED",
    admitted: true,
    rejectionReason: null,
  };
}

function passedChecks(): Record<string, ProofCheckStatus> {
  return Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"]));
}

test("V36 deterministic replay is exact for identical Run and fixture state", () => {
  const first = evaluateFixtureTruth(runId, laptopFixture);
  const second = evaluateFixtureTruth(runId, laptopFixture);
  assert.deepEqual(second, first);
});

test("generic HIGH-risk positive claims require a materially independent second chain", () => {
  const subject = factualClaim("HIGH");
  const primaryOnly = evaluatePositiveBurden(subject, [support("primary", "origin-a", true)]);
  assert.equal(primaryOnly.satisfied, false);
  assert.equal(primaryOnly.requiredIndependentChains, 2);
  assert.equal(primaryOnly.independentChains, 1);

  const corroborated = evaluatePositiveBurden(subject, [
    support("primary", "origin-a", true),
    support("corroboration", "origin-b"),
  ]);
  assert.equal(corroborated.satisfied, true);
  assert.equal(corroborated.requiredIndependentChains, 2);
  assert.equal(corroborated.independentChains, 2);
});

test("collapsed low-confidence provenance cannot use the authoritative-primary shortcut", () => {
  const dataset: FixtureDataset = {
    evidence: [
      { id: "e-primary", value: true, sourceId: "original", sourceLabel: "Original", admitted: true },
      { id: "e-copy", value: true, sourceId: "copy", sourceLabel: "Copy", admitted: true },
    ],
    truthClaims: [{
      id: "claim",
      text: "material factual claim",
      claimType: "FACTUAL",
      candidateId: "candidate",
      criterion: "criterion",
      evidenceIds: ["e-primary", "e-copy"],
      evidenceRisk: "ORDINARY",
      checks: passedChecks(),
    }],
    truthEvidence: [
      { evidenceId: "e-primary", claimId: "claim", provenanceComponentKey: "raw-original", provenanceConfidence: "HIGH", relation: "SUPPORTS", sourceAccepted: true, authoritativePrimary: true, verification: "VERIFIED" },
      { evidenceId: "e-copy", claimId: "claim", provenanceComponentKey: "raw-copy", provenanceConfidence: "LOW", relation: "SUPPORTS", sourceAccepted: true, authoritativePrimary: false, verification: "VERIFIED" },
    ],
    truthSourceEdges: [{
      fromSourceId: "copy",
      toSourceId: "original",
      edgeType: "COPIES",
      confidence: 0.99,
      contentSimilarity: 0.99,
    }],
  };

  const result = evaluateFixtureTruth(runId, dataset);
  assert.equal(result.bundle.provenanceComponents.length, 1);
  assert.equal(result.bundle.provenanceComponents[0]?.confidence, "LOW");
  assert.equal(result.assessments[0]?.verdict, "UNVERIFIED");
});
