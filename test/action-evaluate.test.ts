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
  return [
    fact({ source: "KNOWLEDGE_V36", consequence: "LOW", reversibility: "REVERSIBLE", support: "SUFFICIENT" }),
  ];
}

function highFacts(): readonly StructuredActionFact[] {
  return [
    fact({ source: "KNOWLEDGE_V36", consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "SUFFICIENT" }),
    fact({ source: "INTENT_AUTHORITY", safeguardOrAuthorityEstablished: true }),
  ];
}

function base(): ActionEngineInput {
  return { candidate: cand("Approve the refund."), calibration: clearCal(), qualifiedFacts: lowSufficientFacts() };
}

function actCase(): ActionEngineInput {
  return base();
}

function waitCase(): ActionEngineInput {
  return { candidate: cand("Book the community hall for Saturday."), calibration: clearCal(), qualifiedFacts: [] };
}

function escalateCase(): ActionEngineInput {
  return {
    candidate: cand("Rewire the venue lighting rig."),
    calibration: clearCal(),
    qualifiedFacts: [
      fact({ source: "INTENT_AUTHORITY", consequence: "LOW", reversibility: "REVERSIBLE", support: "SUFFICIENT", oversightRequired: true }),
    ],
  };
}

test("evaluate composes qualification to selection and echoes action plus reversibility", () => {
  const d = evaluate({ candidate: cand("Approve the refund."),
    calibration: clearCal(), qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", consequence: "LOW", reversibility: "REVERSIBLE", support: "SUFFICIENT" })] });
  assert.equal(d.mode, "ACT");
  assert.equal(d.action, "Approve the refund.");
  assert.equal(d.reversibility, "REVERSIBLE");
  assert.deepEqual(d.blockingUnknowns, []);
});

test("identical governed inputs give identical decisions; model labels change nothing", () => {
  const a = evaluate({ candidate: cand("Migrate the server.", "HIGH_RISK"), calibration: clearCal(), qualifiedFacts: highFacts() });
  const b = evaluate({ candidate: cand("Migrate the server.", "LOW_RISK"), calibration: clearCal(), qualifiedFacts: highFacts() });
  assert.deepEqual(a, b);
});

test("user-facing strings carry no internal vocabulary", () => {
  for (const d of [evaluate(actCase()), evaluate(waitCase()), evaluate(escalateCase())])
    assertUserVisibleClean([d.reason, d.expectedOutcome, d.risk, d.verification]);
});

test("confidence extremes do not move the mode (no numeric thresholds)", () => {
  assert.equal(evaluate({ ...base(), calibration: { ...clearCal(), adjustedConfidence: 0.01 } }).mode,
    evaluate({ ...base(), calibration: { ...clearCal(), adjustedConfidence: 0.99 } }).mode);
});

test("runtime-smuggled step flags cannot move the mode [RF-3 companion]", () => {
  const smuggledInfo = { source: "MODEL_RISK_LABEL", infoStepAvailable: true } as unknown as StructuredActionFact;
  const smuggledOversight = { source: "MODEL_RISK_LABEL", oversightRequired: true } as unknown as StructuredActionFact;
  assert.equal(evaluate({ ...waitCase(), qualifiedFacts: [smuggledInfo] }).mode, "WAIT");
  assert.notEqual(evaluate({ ...waitCase(), qualifiedFacts: [smuggledOversight] }).mode, "ESCALATE");
});

test("evaluate output is frozen", () => {
  const d = evaluate(actCase());
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(d.blockingUnknowns));
});
