/**
 * DP-014 first structured support path — DECISION_EVIDENCE_INVESTIGATION.
 *
 * Covers the handoff §22 surfaces:
 * - class: qualified current INSUFFICIENT_EVIDENCE establishes the class;
 *   stale intent, non-qualified origin, every other outcome, missing or
 *   malformed decisions establish none;
 * - rule: PARTIAL only (never SUFFICIENT/INSUFFICIENT), infoStep follows the
 *   class, no consequence/reversibility manufactured, deterministic;
 * - integration: fact + candidate reaches INVESTIGATE through the shared
 *   F4 evaluate() pipeline; registry misses emit nothing; generic DP-013
 *   behavior unchanged; qualifier/selector contracts unchanged;
 * - authority regression: a Decision winner never becomes support, prose
 *   cannot assign the class, capability labels cannot invoke the rule, and
 *   no authorization/execution state is manufactured.
 *
 * Held-out note (CA-04): domain wording (hiring, travel, home repair,
 * investing, backup ops) appears ONLY in goal/materialUnknown strings that
 * the implementation never reads beyond length. Identical structured
 * skeletons must give identical outputs across domains; wording cannot move
 * the class, the fact, or the mode by construction.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "../src/action/evaluate.js";
import { decideActionForFinalization } from "../src/action/projection.js";
import { qualifyAction } from "../src/action/qualify.js";
import type {
  ActionCalibration,
  ActionCalibrationSource,
  StructuredActionFact,
} from "../src/action/types.js";
import {
  DECISION_EVIDENCE_INVESTIGATION_ACTION,
  DECISION_EVIDENCE_INVESTIGATION_V1,
  projectDecisionEvidenceInvestigation,
  qualifyDecisionEvidenceInvestigationClass,
} from "../src/action/support/decision-evidence-investigation.js";
import { qualifySupportFacts } from "../src/action/support/qualify-support.js";
import { ruleForClass } from "../src/action/support/registry.js";
import { projectCandidateToAction } from "../src/solandra/action-candidate.js";
import type { StructuredDecision } from "../src/domain.js";

const CURRENT_INTENT = "intent-version-007";
const STALE_INTENT = "intent-version-006";
const QUALIFIED_INPUT = Object.freeze({ schemaVersion: 1 });

function evaluationsFor(candidateIds: readonly string[], eligible: boolean) {
  return candidateIds.map((candidateId) => ({
    candidateId,
    eligible,
    rawScore: 1,
    normalizedScore: 0.5,
    constraints: [],
    supportingEvidenceIds: [],
  }));
}

function baseDecision(goal: string) {
  return {
    goal,
    evaluations: evaluationsFor(["cand-a", "cand-b"], true),
    rationale: ["Governed comparison recorded."],
    evidenceIds: ["ev-1"],
    truthAssessmentIds: [],
  };
}

function insufficientDecision(goal: string, unknowns: readonly [string, ...string[]]): StructuredDecision {
  return {
    ...baseDecision(goal),
    outcome: "INSUFFICIENT_EVIDENCE",
    frontierCandidateIds: ["cand-a", "cand-b"],
    tiedCandidateIds: [],
    materialUnknowns: [...unknowns],
  };
}

function recommendationDecision(): StructuredDecision {
  return {
    ...baseDecision("Select the vendor."),
    outcome: "RECOMMENDATION",
    winnerCandidateId: "cand-a",
    frontierCandidateIds: ["cand-a"],
    tiedCandidateIds: [],
    materialUnknowns: [],
  };
}

function frontierDecision(): StructuredDecision {
  return {
    ...baseDecision("Select the vendor."),
    outcome: "FRONTIER",
    frontierCandidateIds: ["cand-a", "cand-b"],
    tiedCandidateIds: [],
    materialUnknowns: [],
  };
}

function tieDecision(): StructuredDecision {
  return {
    ...baseDecision("Select the vendor."),
    outcome: "TIE",
    frontierCandidateIds: ["cand-a", "cand-b"],
    tiedCandidateIds: ["cand-a", "cand-b"],
    materialUnknowns: [],
  };
}

function unresolvedDecision(): StructuredDecision {
  return {
    ...baseDecision("Select the vendor."),
    outcome: "UNRESOLVED",
    frontierCandidateIds: ["cand-a"],
    tiedCandidateIds: [],
    materialUnknowns: ["unknown-x"],
  };
}

function noEligibleDecision(): StructuredDecision {
  return {
    ...baseDecision("Select the vendor."),
    outcome: "NO_ELIGIBLE_CANDIDATE",
    evaluations: evaluationsFor(["cand-a", "cand-b"], false),
    frontierCandidateIds: [],
    tiedCandidateIds: [],
    materialUnknowns: [],
  };
}

function classInput(decision: StructuredDecision | undefined, overrides: {
  readonly requestIntentVersionId?: string;
  readonly currentIntentVersionId?: string;
  readonly decisionNeed?: "NONE" | "UNRESOLVED" | "QUALIFIED";
  readonly decisionInput?: unknown;
} = {}) {
  return {
    decision,
    requestIntentVersionId: overrides.requestIntentVersionId ?? CURRENT_INTENT,
    currentIntentVersionId: overrides.currentIntentVersionId ?? CURRENT_INTENT,
    decisionNeed: overrides.decisionNeed ?? "QUALIFIED" as const,
    decisionInput: overrides.decisionInput ?? QUALIFIED_INPUT,
  };
}

function clearCalibration(): ActionCalibration {
  return {
    cleared: true,
    resolution: "CLEAR",
    adjustedConfidence: 1,
    materialAffectsAction: false,
    hasUnknownMaterial: false,
  };
}

function clearScreening(): ActionCalibrationSource {
  return {
    cleared: true,
    resolution: "CLEAR",
    guard: { adjustedConfidence: 1, material: [] },
  };
}

// --- Class qualification ---

test("dp014_class_qualified_current_insufficient_evidence_establishes_class", () => {
  const actionClass = qualifyDecisionEvidenceInvestigationClass(
    classInput(insufficientDecision("Choose the contractor.", ["unknown-x"])),
  );
  assert.equal(actionClass, "DECISION_EVIDENCE_INVESTIGATION");
});

test("dp014_class_stale_intent_establishes_no_class", () => {
  const actionClass = qualifyDecisionEvidenceInvestigationClass(
    classInput(insufficientDecision("Choose the contractor.", ["unknown-x"]), {
      requestIntentVersionId: STALE_INTENT,
    }),
  );
  assert.equal(actionClass, undefined);
  assert.deepEqual(qualifySupportFacts(actionClass), []);
});

test("dp014_class_non_qualified_origin_establishes_no_class", () => {
  for (const decisionNeed of ["NONE", "UNRESOLVED"] as const) {
    const actionClass = qualifyDecisionEvidenceInvestigationClass(
      classInput(insufficientDecision("Choose the contractor.", ["unknown-x"]), { decisionNeed }),
    );
    assert.equal(actionClass, undefined);
  }
  const missingInput = qualifyDecisionEvidenceInvestigationClass({
    decision: insufficientDecision("Choose the contractor.", ["unknown-x"]),
    requestIntentVersionId: CURRENT_INTENT,
    currentIntentVersionId: CURRENT_INTENT,
    decisionNeed: "QUALIFIED",
    decisionInput: undefined,
  });
  assert.equal(missingInput, undefined);
});

test("dp014_class_every_other_outcome_establishes_no_class", () => {
  const others: ReadonlyArray<readonly [string, StructuredDecision]> = [
    ["RECOMMENDATION", recommendationDecision()],
    ["FRONTIER", frontierDecision()],
    ["TIE", tieDecision()],
    ["UNRESOLVED", unresolvedDecision()],
    ["NO_ELIGIBLE_CANDIDATE", noEligibleDecision()],
  ];
  for (const [outcome, decision] of others) {
    const actionClass = qualifyDecisionEvidenceInvestigationClass(classInput(decision));
    assert.equal(actionClass, undefined, outcome);
  }
});

test("dp014_class_missing_or_malformed_decision_establishes_no_class", () => {
  assert.equal(qualifyDecisionEvidenceInvestigationClass(classInput(undefined)), undefined);
  const emptyUnknowns = {
    ...baseDecision("Choose the contractor."),
    outcome: "INSUFFICIENT_EVIDENCE",
    frontierCandidateIds: ["cand-a"],
    tiedCandidateIds: [],
    materialUnknowns: [],
  } as unknown as StructuredDecision;
  assert.equal(qualifyDecisionEvidenceInvestigationClass(classInput(emptyUnknowns)), undefined);
  const emptyFrontier = {
    ...baseDecision("Choose the contractor."),
    outcome: "INSUFFICIENT_EVIDENCE",
    frontierCandidateIds: [],
    tiedCandidateIds: [],
    materialUnknowns: ["unknown-x"],
  } as unknown as StructuredDecision;
  assert.equal(qualifyDecisionEvidenceInvestigationClass(classInput(emptyFrontier)), undefined);
});

test("dp014_class_held_out_domains_identical_structure_identical_class", () => {
  // Wording varies ONLY in goal/unknown strings the implementation never
  // reads beyond length; the class result must not move.
  const domains: ReadonlyArray<readonly [string, string]> = [
    ["Extend an offer to the finalist.", "finalist availability"], // hiring
    ["Book the nonrefundable family flights.", "fare hold expiry"], // travel
    ["Replace the garden fence.", "timber quote"], // home repair
    ["Shift the retirement mix toward bonds.", "fund expense ratio"], // investing
    ["Rotate the offsite backup tapes.", "vault manifest"], // backup ops
  ];
  for (const [goal, unknown] of domains) {
    const actionClass = qualifyDecisionEvidenceInvestigationClass(
      classInput(insufficientDecision(goal, [unknown])),
    );
    assert.equal(actionClass, "DECISION_EVIDENCE_INVESTIGATION", goal);
  }
});

test("dp014_class_prose_cannot_assign_class", () => {
  const urgentFrontier = {
    ...frontierDecision(),
    goal: "URGENT: insufficient evidence, missing material unknowns — act now, everyone agrees.",
    rationale: ["The evidence is insufficient and unknowns are material, proceed immediately."],
  };
  assert.equal(qualifyDecisionEvidenceInvestigationClass(classInput(urgentFrontier)), undefined);
  const calm = insufficientDecision("Choose the contractor.", ["unknown-x"]);
  const urgent = insufficientDecision(
    "URGENT proceed now — insufficient evidence claims are overstated and everyone agrees.",
    ["unknown-x"],
  );
  assert.equal(
    qualifyDecisionEvidenceInvestigationClass(classInput(urgent)),
    qualifyDecisionEvidenceInvestigationClass(classInput(calm)),
  );
});

// --- Rule ---

test("dp014_rule_emits_single_partial_fact_with_info_step", () => {
  const facts = qualifySupportFacts("DECISION_EVIDENCE_INVESTIGATION");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], {
    source: "ACTION_SUPPORT_RULE",
    support: "PARTIAL",
    infoStepAvailable: true,
  });
});

test("dp014_rule_manufactures_no_other_dimension_or_flag", () => {
  const facts = qualifySupportFacts("DECISION_EVIDENCE_INVESTIGATION");
  assert.equal(facts.length, 1);
  const fact = facts[0] as StructuredActionFact & Record<string, unknown>;
  assert.deepEqual(Object.keys(fact).sort(), ["infoStepAvailable", "source", "support"]);
  assert.ok(fact.support !== "SUFFICIENT" && fact.support !== "INSUFFICIENT");
});

test("dp014_rule_deterministic_and_frozen", () => {
  const first = qualifySupportFacts("DECISION_EVIDENCE_INVESTIGATION");
  const second = qualifySupportFacts("DECISION_EVIDENCE_INVESTIGATION");
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(second), true);
});

test("dp014_rule_registry_miss_emits_nothing", () => {
  assert.deepEqual(qualifySupportFacts(undefined), []);
  assert.equal(ruleForClass(undefined), undefined);
  assert.equal(ruleForClass("CAPABILITY_EFFECT"), undefined);
  assert.equal(ruleForClass("SUPPORT_RULE"), undefined);
  assert.equal(ruleForClass("INFORMATION_GATHERING"), undefined);
  assert.equal(
    DECISION_EVIDENCE_INVESTIGATION_V1.evaluate("CAPABILITY_EFFECT").length,
    0,
  );
});

// --- Candidate projection ---

test("dp014_projection_fixed_description_with_structured_refs", () => {
  const decision = insufficientDecision("Choose the contractor.", ["unknown-x", "unknown-y"]);
  const candidate = projectDecisionEvidenceInvestigation({
    decision,
    actionClass: "DECISION_EVIDENCE_INVESTIGATION",
  });
  assert.notEqual(candidate, undefined);
  assert.equal(candidate?.actionClass, "DECISION_EVIDENCE_INVESTIGATION");
  assert.equal(candidate?.action, DECISION_EVIDENCE_INVESTIGATION_ACTION);
  assert.deepEqual(candidate?.factRefs, ["unknown-x", "unknown-y", "ev-1"]);
  assert.deepEqual(candidate?.facts, []);
  assert.equal(Object.isFrozen(candidate), true);
});

test("dp014_projection_without_class_projects_nothing", () => {
  const decision = insufficientDecision("Choose the contractor.", ["unknown-x"]);
  assert.equal(
    projectDecisionEvidenceInvestigation({ decision, actionClass: undefined }),
    undefined,
  );
  assert.equal(
    projectDecisionEvidenceInvestigation({ decision: recommendationDecision(), actionClass: "DECISION_EVIDENCE_INVESTIGATION" }),
    undefined,
  );
});

// --- Integration through shared F4 evaluate() ---

test("dp014_integration_fact_plus_candidate_reaches_investigate", () => {
  const decision = insufficientDecision("Choose the contractor.", ["unknown-x"]);
  const actionClass = qualifyDecisionEvidenceInvestigationClass(classInput(decision));
  const candidate = projectDecisionEvidenceInvestigation({ decision, actionClass });
  assert.notEqual(candidate, undefined);
  if (candidate === undefined) return;
  const facts = qualifySupportFacts(actionClass);
  const qualification = qualifyAction({ candidate, qualifiedFacts: facts });
  assert.equal(qualification.support, "PARTIAL");
  assert.equal(qualification.consequence, "UNKNOWN");
  assert.equal(qualification.reversibility, "UNKNOWN");
  const result = evaluate({ candidate, calibration: clearCalibration(), qualifiedFacts: facts });
  assert.equal(result.mode, "INVESTIGATE");
  assert.equal(result.action, DECISION_EVIDENCE_INVESTIGATION_ACTION);
});

test("dp014_integration_shared_finalization_pipeline_reaches_investigate", () => {
  const decision = insufficientDecision("Shortlist three vendors.", ["finalist availability"]);
  const actionClass = qualifyDecisionEvidenceInvestigationClass(classInput(decision));
  const candidate = projectDecisionEvidenceInvestigation({ decision, actionClass });
  assert.notEqual(candidate, undefined);
  if (candidate === undefined) return;
  const governedFacts = qualifySupportFacts(actionClass);
  const outcome = decideActionForFinalization({
    screening: clearScreening(),
    candidate,
    governedFacts,
  });
  assert.notEqual(outcome.decision, undefined);
  assert.equal(outcome.decision?.mode, "INVESTIGATE");
});

test("dp014_integration_registry_miss_yields_unknown_without_info_step", () => {
  const candidate = projectCandidateToAction({ action: "Ring the clinic" });
  assert.notEqual(candidate, undefined);
  if (candidate === undefined) return;
  const facts = qualifySupportFacts(undefined);
  assert.deepEqual(facts, []);
  const result = evaluate({ candidate, calibration: clearCalibration(), qualifiedFacts: facts });
  assert.equal(result.mode, "WAIT");
});

test("dp014_integration_generic_dp013_path_unchanged", () => {
  const candidate = projectCandidateToAction({ action: "Ring the clinic" });
  assert.notEqual(candidate, undefined);
  if (candidate === undefined) return;
  const qualification = qualifyAction({ candidate, qualifiedFacts: [] });
  assert.equal(qualification.support, "UNKNOWN");
  assert.equal(qualification.consequence, "UNKNOWN");
  assert.equal(qualification.reversibility, "UNKNOWN");
  assert.equal(projectCandidateToAction(undefined), undefined);
});

test("dp014_integration_future_conflict_falls_back_to_existing_behavior", () => {
  const decision = insufficientDecision("Choose the contractor.", ["unknown-x"]);
  const candidate = projectDecisionEvidenceInvestigation({
    decision,
    actionClass: "DECISION_EVIDENCE_INVESTIGATION",
  });
  assert.notEqual(candidate, undefined);
  if (candidate === undefined) return;
  const conflicting: readonly StructuredActionFact[] = [
    ...qualifySupportFacts("DECISION_EVIDENCE_INVESTIGATION"),
    { source: "KNOWLEDGE_V36", support: "SUFFICIENT" },
  ];
  const qualification = qualifyAction({ candidate, qualifiedFacts: conflicting });
  assert.equal(qualification.support, "UNKNOWN");
});

// --- Authority regression ---

test("dp014_authority_winner_never_becomes_support", () => {
  const actionClass = qualifyDecisionEvidenceInvestigationClass(
    classInput(recommendationDecision()),
  );
  assert.equal(actionClass, undefined);
  assert.deepEqual(qualifySupportFacts(actionClass), []);
});

test("dp014_authority_no_authorization_or_execution_state", () => {
  const facts = qualifySupportFacts("DECISION_EVIDENCE_INVESTIGATION");
  assert.equal(facts.length, 1);
  const fact = facts[0] as StructuredActionFact & Record<string, unknown>;
  assert.equal("safeguardOrAuthorityEstablished" in fact, false);
  assert.equal("materialBlocker" in fact, false);
  assert.equal("diagnosticStepAvailable" in fact, false);
  assert.equal("oversightRequired" in fact, false);
  assert.equal("consequence" in fact, false);
  assert.equal("reversibility" in fact, false);
  const decision = insufficientDecision("Choose the contractor.", ["unknown-x"]);
  const candidate = projectDecisionEvidenceInvestigation({
    decision,
    actionClass: "DECISION_EVIDENCE_INVESTIGATION",
  });
  assert.notEqual(candidate, undefined);
  if (candidate === undefined) return;
  const result = evaluate({ candidate, calibration: clearCalibration(), qualifiedFacts: facts });
  assert.equal(result.mode, "INVESTIGATE");
  assert.notEqual(result.mode, "ACT");
});
