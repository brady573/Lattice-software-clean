import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeDelegatedSelection,
  type DelegatedSelectionProposal,
  type FinalChoiceDelegationAuthorization,
} from "../src/decision/delegated-selection.js";
import { constructMaterialDominanceFrontier } from "../src/decision/material-dominance-frontier.js";

const frontier = constructMaterialDominanceFrontier({
  alternatives: [
    { alternativeId: "alpha", eligibility: "ELIGIBLE" },
    { alternativeId: "beta", eligibility: "ELIGIBLE" },
  ],
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

function authorization(
  overrides: Partial<FinalChoiceDelegationAuthorization> = {},
): FinalChoiceDelegationAuthorization {
  return {
    delegationId: "delegation-1",
    intentScopeId: "scope-1",
    intentVersionId: "intent-v7",
    decisionStateId: "decision-3",
    frontierFingerprint: "sha256:frontier-3",
    provenance: "EXPLICIT_USER",
    status: "ACTIVE",
    authority: "FINAL_CHOICE",
    ...overrides,
  };
}

function proposal(
  overrides: Partial<DelegatedSelectionProposal> = {},
): DelegatedSelectionProposal {
  return {
    intentScopeId: "scope-1",
    intentVersionId: "intent-v7",
    decisionStateId: "decision-3",
    frontierFingerprint: "sha256:frontier-3",
    selectedAlternativeId: "alpha",
    reasonCriterionIds: ["quality@1"],
    acknowledgedTradeOffCriterionIds: ["durability@1"],
    issuedBy: "LATTICE_DECISION_ENGINE",
    ...overrides,
  };
}

test("active exact final-choice delegation authorizes selection from the intact frontier", () => {
  const selection = authorizeDelegatedSelection(
    frontier,
    authorization(),
    proposal(),
  );

  assert.equal(selection.selectedAlternativeId, "alpha");
  assert.deepEqual(selection.intactFrontierAlternativeIds, ["alpha", "beta"]);
  assert.deepEqual(selection.reasonCriterionIds, ["quality@1"]);
  assert.deepEqual(selection.acknowledgedTradeOffCriterionIds, ["durability@1"]);
  assert.equal(selection.judgmentAuthority, "LATTICE_DECISION_ENGINE");
  assert.equal(selection.externalActionAuthorized, false);
});

test("revoked final-choice delegation fails closed", () => {
  assert.throws(
    () => authorizeDelegatedSelection(
      frontier,
      authorization({ status: "REVOKED" }),
      proposal(),
    ),
    /not active/,
  );
});

test("ordinary bounded preference delegation cannot substitute for final-choice authority", () => {
  assert.throws(
    () => authorizeDelegatedSelection(
      frontier,
      {
        ...authorization(),
        authority: "PREFERENCE",
      } as unknown as FinalChoiceDelegationAuthorization,
      proposal(),
    ),
  );
});

test("selection outside the valid frontier is rejected", () => {
  assert.throws(
    () => authorizeDelegatedSelection(
      frontier,
      authorization(),
      proposal({ selectedAlternativeId: "gamma" }),
    ),
    /valid frontier/,
  );
});

test("stale or cross-scope bindings are rejected independently", () => {
  for (const changed of [
    { intentScopeId: "scope-2" },
    { intentVersionId: "intent-v8" },
    { decisionStateId: "decision-4" },
    { frontierFingerprint: "sha256:frontier-4" },
  ] satisfies readonly Partial<DelegatedSelectionProposal>[]) {
    assert.throws(
      () => authorizeDelegatedSelection(
        frontier,
        authorization(),
        proposal(changed),
      ),
      /exact authorization binding/,
    );
  }
});

test("USER-confirmed provenance is accepted without becoming Decision Engine judgment", () => {
  const selection = authorizeDelegatedSelection(
    frontier,
    authorization({ provenance: "USER_CONFIRMED" }),
    proposal({ selectedAlternativeId: "beta" }),
  );

  assert.equal(selection.selectedAlternativeId, "beta");
  assert.equal(selection.judgmentAuthority, "LATTICE_DECISION_ENGINE");
});

test("empty frontier cannot produce delegated selection", () => {
  const emptyFrontier = constructMaterialDominanceFrontier({
    alternatives: [
      { alternativeId: "alpha", eligibility: "UNKNOWN" },
    ],
    comparisons: [],
  });

  assert.throws(
    () => authorizeDelegatedSelection(
      emptyFrontier,
      authorization(),
      proposal(),
    ),
    /non-empty valid frontier/,
  );
});
