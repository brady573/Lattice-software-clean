import assert from "node:assert/strict";
import test from "node:test";
import { QualifiedCriterionCatalog } from "../src/decision/criterion-catalog.js";
import {
  evaluateHardRequirement,
  hardRequirementsPermitEligibility,
} from "../src/decision/priority-and-requirements.js";
import { evaluateMeaningfulDifference } from "../src/decision/meaningful-difference.js";
import { evaluatePreferenceCoverage } from "../src/decision/preference-coverage.js";
import { constructMaterialDominanceFrontier } from "../src/decision/material-dominance-frontier.js";
import { authorizeDelegatedSelection } from "../src/decision/delegated-selection.js";

test("M6 acceptance: generalized authoritative decision trace preserves every authority boundary", () => {
  const catalog = new QualifiedCriterionCatalog(1, [
    {
      criterionId: "quality",
      version: 1,
      valueType: "NUMBER",
      preferenceDirection: "HIGHER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 5 },
    },
    {
      criterionId: "cost",
      version: 1,
      valueType: "NUMBER",
      preferenceDirection: "LOWER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 10 },
    },
  ]);

  const quality = catalog.requireExact("quality", 1);
  const cost = catalog.requireExact("cost", 1);

  const alphaRequirement = evaluateHardRequirement({
    criterionId: "quality",
    criterionVersion: 1,
    operator: "GTE",
    expected: 70,
  }, 90);
  const betaRequirement = evaluateHardRequirement({
    criterionId: "quality",
    criterionVersion: 1,
    operator: "GTE",
    expected: 70,
  }, 80);
  const gammaRequirement = evaluateHardRequirement({
    criterionId: "quality",
    criterionVersion: 1,
    operator: "GTE",
    expected: 70,
  }, 60);

  assert.equal(alphaRequirement, "SATISFIED");
  assert.equal(betaRequirement, "SATISFIED");
  assert.equal(gammaRequirement, "FAILED");
  assert.equal(hardRequirementsPermitEligibility([alphaRequirement]), true);
  assert.equal(hardRequirementsPermitEligibility([betaRequirement]), true);
  assert.equal(hardRequirementsPermitEligibility([gammaRequirement]), false);
  assert.equal(hardRequirementsPermitEligibility(["UNKNOWN"]), false);

  const qualityDifference = evaluateMeaningfulDifference(
    quality,
    90,
    80,
    {
      intentScopeId: "scope-acceptance",
      intentVersionId: "intent-v3",
      criterionId: "quality",
      criterionVersion: 1,
      kind: "ABSOLUTE",
      maximumDifference: 5,
    },
  );
  const costDifference = evaluateMeaningfulDifference(
    cost,
    100,
    80,
    {
      intentScopeId: "scope-acceptance",
      intentVersionId: "intent-v3",
      criterionId: "cost",
      criterionVersion: 1,
      kind: "ABSOLUTE",
      maximumDifference: 5,
    },
  );

  assert.equal(qualityDifference.state, "MEANINGFUL");
  assert.equal(qualityDifference.preferredSide, "LEFT");
  assert.equal(qualityDifference.intentVersionId, "intent-v3");
  assert.equal(costDifference.state, "MEANINGFUL");
  assert.equal(costDifference.preferredSide, "RIGHT");

  const alphaCoverage = evaluatePreferenceCoverage({
    criterionId: "quality",
    criterionVersion: 1,
    utility: 0.9,
    coverage: "COMPLETE",
    unresolvedGap: "NONE",
  });
  const gammaCoverage = evaluatePreferenceCoverage({
    criterionId: "quality",
    criterionVersion: 1,
    utility: null,
    coverage: "PARTIAL",
    unresolvedGap: "EVIDENCE",
  });

  assert.equal(alphaCoverage.rankingStable, true);
  assert.equal(gammaCoverage.utility, null);
  assert.equal(gammaCoverage.resolutionOwner, "V36");

  const frontier = constructMaterialDominanceFrontier({
    alternatives: [
      { alternativeId: "alpha", eligibility: "ELIGIBLE" },
      { alternativeId: "beta", eligibility: "ELIGIBLE" },
      { alternativeId: "gamma", eligibility: "INELIGIBLE" },
    ],
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [
        {
          criterionId: qualityDifference.criterionId,
          criterionVersion: qualityDifference.criterionVersion,
          tier: "MATTERS_MOST",
          state: qualityDifference.state,
          preferredSide: qualityDifference.preferredSide,
        },
        {
          criterionId: costDifference.criterionId,
          criterionVersion: costDifference.criterionVersion,
          tier: "MATTERS_MOST",
          state: costDifference.state,
          preferredSide: costDifference.preferredSide,
        },
      ],
    }],
  });

  assert.deepEqual(frontier.frontierAlternativeIds, ["alpha", "beta"]);
  assert.deepEqual(frontier.excludedAlternatives, [
    { alternativeId: "gamma", reason: "INELIGIBLE" },
  ]);
  assert.equal(frontier.pairwiseDecisions[0]?.reason, "SAME_TIER_TRADE_OFF");
  assert.equal(frontier.forcedWinnerAlternativeId, null);

  const selection = authorizeDelegatedSelection(
    frontier,
    {
      delegationId: "delegation-acceptance",
      intentScopeId: "scope-acceptance",
      intentVersionId: "intent-v3",
      decisionStateId: "decision-state-3",
      frontierFingerprint: "sha256:m6-acceptance-frontier",
      provenance: "USER_CONFIRMED",
      status: "ACTIVE",
      authority: "FINAL_CHOICE",
    },
    {
      intentScopeId: "scope-acceptance",
      intentVersionId: "intent-v3",
      decisionStateId: "decision-state-3",
      frontierFingerprint: "sha256:m6-acceptance-frontier",
      selectedAlternativeId: "alpha",
      reasonCriterionIds: ["quality@1"],
      acknowledgedTradeOffCriterionIds: ["cost@1"],
      issuedBy: "LATTICE_DECISION_ENGINE",
    },
  );

  assert.equal(selection.selectedAlternativeId, "alpha");
  assert.deepEqual(selection.intactFrontierAlternativeIds, ["alpha", "beta"]);
  assert.equal(selection.judgmentAuthority, "LATTICE_DECISION_ENGINE");
  assert.equal(selection.externalActionAuthorized, false);
});
