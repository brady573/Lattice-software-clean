import assert from "node:assert/strict";
import test from "node:test";
import {
  constructMaterialDominanceFrontier,
  type MaterialDominanceInput,
} from "../src/decision/material-dominance-frontier.js";

function build(overrides: Partial<MaterialDominanceInput> = {}) {
  return constructMaterialDominanceFrontier({
    alternatives: [
      { alternativeId: "alpha", eligibility: "ELIGIBLE" },
      { alternativeId: "beta", eligibility: "ELIGIBLE" },
    ],
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [{
        criterionId: "quality",
        criterionVersion: 1,
        tier: "MATTERS_MOST",
        state: "MEANINGFUL",
        preferredSide: "LEFT",
      }],
    }],
    ...overrides,
  });
}

test("highest materially different tier dominates lower-tier advantages", () => {
  const result = build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [
        {
          criterionId: "quality",
          criterionVersion: 1,
          tier: "MATTERS_MOST",
          state: "MEANINGFUL",
          preferredSide: "LEFT",
        },
        {
          criterionId: "convenience",
          criterionVersion: 1,
          tier: "NICE_TO_HAVE",
          state: "MEANINGFUL",
          preferredSide: "RIGHT",
        },
      ],
    }],
  });

  assert.deepEqual(result.frontierAlternativeIds, ["alpha"]);
  assert.equal(result.outcome, "RECOMMENDATION");
  assert.equal(result.pairwiseDecisions[0]?.decisiveTier, "MATTERS_MOST");
  assert.equal(result.pairwiseDecisions[0]?.reason, "LEFT_DOMINATES");
  assert.deepEqual(result.pairwiseDecisions[0]?.materialAdvantages, ["quality@1"]);
  assert.equal(result.forcedWinnerAlternativeId, null);
});

test("within-tolerance higher tiers allow a lower material tier to decide", () => {
  const result = build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [
        {
          criterionId: "quality",
          criterionVersion: 1,
          tier: "MATTERS_MOST",
          state: "WITHIN_TOLERANCE",
          preferredSide: "NEITHER",
        },
        {
          criterionId: "cost",
          criterionVersion: 2,
          tier: "IMPORTANT",
          state: "MEANINGFUL",
          preferredSide: "RIGHT",
        },
      ],
    }],
  });

  assert.deepEqual(result.frontierAlternativeIds, ["beta"]);
  assert.equal(result.pairwiseDecisions[0]?.decisiveTier, "IMPORTANT");
  assert.equal(result.pairwiseDecisions[0]?.reason, "RIGHT_DOMINATES");
});

test("same-tier material trade-offs preserve both alternatives", () => {
  const result = build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [
        {
          criterionId: "quality",
          criterionVersion: 1,
          tier: "MATTERS_MOST",
          state: "MEANINGFUL",
          preferredSide: "LEFT",
        },
        {
          criterionId: "durability",
          criterionVersion: 1,
          tier: "MATTERS_MOST",
          state: "MEANINGFUL",
          preferredSide: "RIGHT",
        },
      ],
    }],
  });

  assert.deepEqual(result.frontierAlternativeIds, ["alpha", "beta"]);
  assert.equal(result.pairwiseDecisions[0]?.reason, "SAME_TIER_TRADE_OFF");
  assert.deepEqual(
    result.pairwiseDecisions[0]?.materialTradeOffs,
    ["quality@1", "durability@1"],
  );
});

test("unknown higher-tier comparison blocks lower-tier dominance", () => {
  const result = build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [
        {
          criterionId: "quality",
          criterionVersion: 1,
          tier: "MATTERS_MOST",
          state: "UNKNOWN",
          preferredSide: "UNKNOWN",
        },
        {
          criterionId: "cost",
          criterionVersion: 1,
          tier: "IMPORTANT",
          state: "MEANINGFUL",
          preferredSide: "LEFT",
        },
      ],
    }],
  });

  assert.deepEqual(result.frontierAlternativeIds, ["alpha", "beta"]);
  assert.equal(result.pairwiseDecisions[0]?.reason, "UNRESOLVED_HIGHER_TIER");
  assert.deepEqual(result.pairwiseDecisions[0]?.unresolvedCriteria, ["quality@1"]);
});

test("missing pairwise evidence preserves alternatives without inventing a ranking", () => {
  const result = build({ comparisons: [] });
  assert.deepEqual(result.frontierAlternativeIds, ["alpha", "beta"]);
  assert.equal(result.outcome, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.pairwiseDecisions[0]?.reason, "COMPARISON_MISSING");
  assert.equal(result.forcedWinnerAlternativeId, null);
});

test("only explicitly eligible alternatives enter the valid frontier", () => {
  const result = build({
    alternatives: [
      { alternativeId: "alpha", eligibility: "ELIGIBLE" },
      { alternativeId: "beta", eligibility: "INELIGIBLE" },
      { alternativeId: "gamma", eligibility: "UNKNOWN" },
    ],
    comparisons: [],
  });

  assert.deepEqual(result.frontierAlternativeIds, ["alpha"]);
  assert.equal(result.outcome, "RECOMMENDATION");
  assert.deepEqual(result.excludedAlternatives, [
    { alternativeId: "beta", reason: "INELIGIBLE" },
    { alternativeId: "gamma", reason: "ELIGIBILITY_UNKNOWN" },
  ]);
  assert.equal(result.forcedWinnerAlternativeId, null);
});

test("frontier preserves tie, unresolved, and no-eligible outcomes", () => {
  assert.equal(build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [{
        criterionId: "quality",
        criterionVersion: 1,
        tier: "MATTERS_MOST",
        state: "WITHIN_TOLERANCE",
        preferredSide: "NEITHER",
      }],
    }],
  }).outcome, "TIE");

  assert.equal(build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [{
        criterionId: "quality",
        criterionVersion: 1,
        tier: "MATTERS_MOST",
        state: "UNKNOWN",
        preferredSide: "UNKNOWN",
      }],
    }],
  }).outcome, "UNRESOLVED");

  assert.equal(constructMaterialDominanceFrontier({
    alternatives: [{ alternativeId: "alpha", eligibility: "INELIGIBLE" }],
    comparisons: [],
  }).outcome, "NO_ELIGIBLE_CANDIDATE");
});

test("comparison orientation does not change the dominant alternative", () => {
  const result = build({
    comparisons: [{
      leftAlternativeId: "beta",
      rightAlternativeId: "alpha",
      criteria: [{
        criterionId: "quality",
        criterionVersion: 1,
        tier: "MATTERS_MOST",
        state: "MEANINGFUL",
        preferredSide: "RIGHT",
      }],
    }],
  });

  assert.deepEqual(result.frontierAlternativeIds, ["alpha"]);
  assert.equal(result.pairwiseDecisions[0]?.reason, "LEFT_DOMINATES");
});

test("invalid and ambiguous inputs fail closed", () => {
  assert.throws(() => build({
    alternatives: [
      { alternativeId: "alpha", eligibility: "ELIGIBLE" },
      { alternativeId: "alpha", eligibility: "ELIGIBLE" },
    ],
    comparisons: [],
  }), /Duplicate frontier alternative/);

  assert.throws(() => build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "missing",
      criteria: [{
        criterionId: "quality",
        criterionVersion: 1,
        tier: "MATTERS_MOST",
        state: "MEANINGFUL",
        preferredSide: "LEFT",
      }],
    }],
  }), /unknown alternative/);

  assert.throws(() => build({
    comparisons: [{
      leftAlternativeId: "alpha",
      rightAlternativeId: "beta",
      criteria: [{
        criterionId: "quality",
        criterionVersion: 1,
        tier: "MATTERS_MOST",
        state: "MEANINGFUL",
        preferredSide: "NEITHER",
      }],
    }],
  }), /meaningful comparison must prefer LEFT or RIGHT/);
});
