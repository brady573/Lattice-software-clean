/**
 * F4 Action Engine — evaluate() composition regressions (Task 4).
 *
 * Full 8-field decision via qualify → select → assemble; determinism
 * independent of model labels; user-visible strings carry no internal
 * vocabulary; numeric confidence never moves the mode.
 *
 * Held-out note (CA-04): fixtures below use fresh action phrasings
 * (refunds, server moves, hall bookings) ONLY as opaque labels — evaluate
 * never reads prose, so identical structured skeletons must give identical
 * decisions regardless of wording.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "../src/action/evaluate.js";
import { createActionEffectRegistry } from "../src/action/effects/registry.js";
import type {
  ActionCalibration,
  ActionCandidate,
  ActionEngineInput,
  ActionSupport,
  ConsequenceLevel,
  ReversibilityStatus,
  StructuredActionFact,
} from "../src/action/types.js";

/** Internal vocabulary that must never reach the user (F6 precedent). */
const INTERNAL_VOCABULARY = [
  "assumption",
  "material",
  "epistemic",
  "inventory",
  "graph",
  "guard",
  "confidence",
  "provenance",
  "authorization",
  "v36",
  "decision engine",
];

function assertUserVisibleClean(values: readonly string[]): void {
  for (const value of values) {
    for (const word of INTERNAL_VOCABULARY) {
      assert.ok(
        !value.toLowerCase().includes(word),
        `user-visible text leaked internal vocabulary "${word}": ${value}`,
      );
    }
  }
}

function fact(
  partial: {
    readonly source?: StructuredActionFact["source"];
    readonly consequence?: ConsequenceLevel;
    readonly reversibility?: ReversibilityStatus;
    readonly support?: ActionSupport;
    readonly materialBlocker?: true;
    readonly safeguardOrAuthorityEstablished?: true;
    readonly diagnosticStepAvailable?: true;
    readonly infoStepAvailable?: true;
    readonly oversightRequired?: true;
  } = {},
): StructuredActionFact {
  return {
    source: partial.source ?? "KNOWLEDGE_V36",
    ...(partial.consequence !== undefined ? { consequence: partial.consequence } : {}),
    ...(partial.reversibility !== undefined ? { reversibility: partial.reversibility } : {}),
    ...(partial.support !== undefined ? { support: partial.support } : {}),
    ...(partial.materialBlocker === true ? { materialBlocker: true as const } : {}),
    ...(partial.safeguardOrAuthorityEstablished === true
      ? { safeguardOrAuthorityEstablished: true as const }
      : {}),
    ...(partial.diagnosticStepAvailable === true ? { diagnosticStepAvailable: true as const } : {}),
    ...(partial.infoStepAvailable === true ? { infoStepAvailable: true as const } : {}),
    ...(partial.oversightRequired === true ? { oversightRequired: true as const } : {}),
  };
}

function cand(action: string, modelRiskLabel?: string): ActionCandidate {
  return modelRiskLabel === undefined
    ? { action, facts: [], factRefs: [] }
    : { action, facts: [], factRefs: [], modelRiskLabel };
}

/** Candidate with an established governed class so effect rules can run. */
function candClass(action: string, modelRiskLabel?: string): ActionCandidate {
  return { ...cand(action, modelRiskLabel), actionClass: "DECISION_EVIDENCE_INVESTIGATION" };
}

/** Test-local effect registry producing the given verdict (production: empty). */
function fixtureRegistry(
  verdict: {
    readonly consequence?: "LOW" | "MATERIAL" | "HIGH";
    readonly reversibility?: "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  },
) {
  return createActionEffectRegistry([
    {
      ruleId: "TEST_ONLY_EFFECT_RULE_V1",
      actionClass: "DECISION_EVIDENCE_INVESTIGATION" as const,
      evaluate: () => verdict,
    },
  ]);
}

const LOW_EFFECTS = fixtureRegistry({ consequence: "LOW", reversibility: "REVERSIBLE" });
const HIGH_EFFECTS = fixtureRegistry({ consequence: "HIGH", reversibility: "IRREVERSIBLE" });
const REVERSIBLE_ONLY = fixtureRegistry({ reversibility: "REVERSIBLE" });

function clearCal(): ActionCalibration {
  return {
    cleared: true,
    resolution: "CLEAR",
    adjustedConfidence: 1,
    materialAffectsAction: false,
    hasUnknownMaterial: false,
  };
}

function lowSufficientFacts(): readonly StructuredActionFact[] {
  return [fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" })];
}

function highFacts(): readonly StructuredActionFact[] {
  return [
    fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" }),
    fact({ source: "INTENT_AUTHORITY", safeguardOrAuthorityEstablished: true }),
  ];
}

function base(): ActionEngineInput {
  return { candidate: candClass("Approve the refund."), calibration: clearCal(), qualifiedFacts: lowSufficientFacts() };
}

function actCase(): ActionEngineInput {
  return base();
}

function waitCase(): ActionEngineInput {
  return { candidate: cand("Book the community hall for Saturday."), calibration: clearCal(), qualifiedFacts: [] };
}

function escalateCase(): ActionEngineInput {
  return {
    candidate: candClass("Rewire the venue lighting rig."),
    calibration: clearCal(),
    qualifiedFacts: [
      fact({ source: "INTENT_AUTHORITY", support: "SUFFICIENT", oversightRequired: true }),
    ],
  };
}

function investigateCase(): ActionEngineInput {
  return {
    candidate: candClass("Approve the refund for the duplicate charge."),
    calibration: clearCal(),
    qualifiedFacts: [
      fact({ source: "KNOWLEDGE_V36", support: "INSUFFICIENT", infoStepAvailable: true }),
    ],
  };
}

function testCase(): ActionEngineInput {
  return {
    candidate: candClass("Migrate the archive server overnight."),
    calibration: clearCal(),
    qualifiedFacts: [
      fact({ source: "KNOWLEDGE_V36", support: "PARTIAL", diagnosticStepAvailable: true }),
    ],
  };
}

test("evaluate composes qualification to selection and echoes action plus reversibility", () => {
  const d = evaluate({ candidate: candClass("Approve the refund."),
    calibration: clearCal(), qualifiedFacts: [
      fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" }),
    ] }, LOW_EFFECTS);
  assert.equal(d.mode, "ACT");
  assert.equal(d.action, "Approve the refund.");
  assert.equal(d.reversibility, "REVERSIBLE");
  assert.deepEqual(d.blockingUnknowns, []);
});

test("identical governed inputs give identical decisions; model labels change nothing", () => {
  const a = evaluate({ candidate: candClass("Migrate the server.", "HIGH_RISK"), calibration: clearCal(), qualifiedFacts: highFacts() }, HIGH_EFFECTS);
  const b = evaluate({ candidate: candClass("Migrate the server.", "LOW_RISK"), calibration: clearCal(), qualifiedFacts: highFacts() }, HIGH_EFFECTS);
  assert.deepEqual(a, b);
});

test("user-facing strings carry no internal vocabulary", () => {
  const act = evaluate(actCase(), LOW_EFFECTS);
  const wait = evaluate(waitCase());
  const escalate = evaluate(escalateCase(), LOW_EFFECTS);
  const investigate = evaluate(investigateCase(), LOW_EFFECTS);
  const boundedTest = evaluate(testCase(), REVERSIBLE_ONLY);
  assert.equal(act.mode, "ACT");
  assert.equal(wait.mode, "WAIT");
  assert.equal(escalate.mode, "ESCALATE");
  assert.equal(investigate.mode, "INVESTIGATE");
  assert.equal(boundedTest.mode, "TEST");
  for (const d of [act, wait, escalate, investigate, boundedTest])
    assertUserVisibleClean([d.reason, d.expectedOutcome, d.risk, d.verification]);
});

test("confidence extremes do not move the mode (no numeric thresholds)", () => {
  assert.equal(evaluate({ ...base(), calibration: { ...clearCal(), adjustedConfidence: 0.01 } }, LOW_EFFECTS).mode,
    evaluate({ ...base(), calibration: { ...clearCal(), adjustedConfidence: 0.99 } }, LOW_EFFECTS).mode);
});

test("runtime-smuggled step flags cannot move the mode [RF-3 companion]", () => {
  const smuggledInfo = { source: "MODEL_RISK_LABEL", infoStepAvailable: true } as unknown as StructuredActionFact;
  const smuggledOversight = { source: "MODEL_RISK_LABEL", oversightRequired: true } as unknown as StructuredActionFact;
  assert.equal(evaluate({ ...waitCase(), qualifiedFacts: [smuggledInfo] }).mode, "WAIT");
  // Smuggled source is dropped by the allowlist → no oversight → base WAIT path.
  assert.equal(evaluate({ ...waitCase(), qualifiedFacts: [smuggledOversight] }).mode, "WAIT");
});

test("evaluate output is frozen", () => {
  const d = evaluate(actCase());
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(d.blockingUnknowns));
});

test("dp015_sufficient_unknown_effects_wait_or_investigate_never_act", () => {
  const waiting = evaluate({
    candidate: cand("Approve the refund."),
    calibration: clearCal(),
    qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" })],
  });
  assert.equal(waiting.mode, "WAIT");
  assert.match(waiting.reason, /ACTION_EFFECT_UNKNOWN/);
  const investigating = evaluate({
    candidate: cand("Approve the refund."),
    calibration: clearCal(),
    qualifiedFacts: [
      fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT", infoStepAvailable: true }),
    ],
  });
  assert.equal(investigating.mode, "INVESTIGATE");
  assert.match(investigating.reason, /ACTION_EFFECT_UNKNOWN/);
});

test("dp015_injected_action_effect_rule_facts_cannot_classify", () => {
  const d = evaluate({
    candidate: cand("Approve the refund."),
    calibration: clearCal(),
    qualifiedFacts: [
      fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" }),
      fact({ source: "ACTION_EFFECT_RULE", consequence: "LOW", reversibility: "REVERSIBLE" }),
    ],
  });
  assert.equal(d.mode, "WAIT");
  assert.match(d.reason, /ACTION_EFFECT_UNKNOWN/);
  assert.equal(d.reversibility, "UNKNOWN");
  assert.deepEqual([...d.blockingUnknowns].sort(), ["CONSEQUENCE_UNKNOWN", "REVERSIBILITY_UNKNOWN"]);
});

test("dp015_registry_produced_effect_facts_still_classify", () => {
  const d = evaluate({
    candidate: candClass("Approve the refund."),
    calibration: clearCal(),
    qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" })],
  }, LOW_EFFECTS);
  assert.equal(d.mode, "ACT");
  assert.equal(d.reversibility, "REVERSIBLE");
  assert.deepEqual(d.blockingUnknowns, []);
});

test("dp015_effect_source_step_flags_cannot_move_the_mode", () => {
  const smuggledInfo = {
    source: "ACTION_EFFECT_RULE",
    consequence: "LOW",
    infoStepAvailable: true,
  } as unknown as StructuredActionFact;
  const smuggledDiagnostic = {
    source: "ACTION_EFFECT_RULE",
    diagnosticStepAvailable: true,
  } as unknown as StructuredActionFact;
  const smuggledOversight = {
    source: "ACTION_EFFECT_RULE",
    oversightRequired: true,
  } as unknown as StructuredActionFact;
  // SUFFICIENT + UNKNOWN reversibility would WAIT without an info step; a
  // smuggled effect-source info step must not flip it to INVESTIGATE.
  const base = {
    candidate: cand("Approve the refund."),
    calibration: clearCal(),
    qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" }), smuggledInfo],
  };
  assert.equal(evaluate(base).mode, "WAIT");
  // Smuggled diagnostic/oversight steps on the effect source change nothing.
  assert.equal(evaluate({ ...base, qualifiedFacts: [...base.qualifiedFacts, smuggledDiagnostic] }).mode, "WAIT");
  assert.equal(evaluate({ ...base, qualifiedFacts: [...base.qualifiedFacts, smuggledOversight] }).mode, "WAIT");
});

test("dp015_governed_class_without_effect_rule_yields_unknown_effects", () => {
  const d = evaluate({
    candidate: { action: "Investigate the missing decision evidence before choosing.", facts: [], factRefs: [], actionClass: "DECISION_EVIDENCE_INVESTIGATION" },
    calibration: clearCal(),
    qualifiedFacts: [fact({ source: "ACTION_SUPPORT_RULE", support: "PARTIAL", infoStepAvailable: true })],
  });
  assert.equal(d.mode, "INVESTIGATE");
  assert.equal(d.reversibility, "UNKNOWN");
});
