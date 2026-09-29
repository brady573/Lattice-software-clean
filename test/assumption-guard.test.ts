/**
 * Assumption Guard regressions (DP-002/DP-004).
 *
 * Covers the binding contract: material vs non-material classification,
 * resolution paths (CLEAR / WEAKEN / WEAKEN_AND_ASK), invisibility (no new
 * user-visible strings except a resolution-demanded question/weakening, in
 * calibrated plain language), input validation, and the advisory hook.
 *
 * Held-out note (CA-04): the guard is a pure structural rule with no domain
 * logic, so generalization holds by construction. The inputs below vary
 * domain (backup ops, travel, hiring, home repair, investing, vendor choice),
 * phrasing, and conversational form, and none of them shaped the
 * implementation — the rule was fixed from the directive before these cases
 * were written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  guardAssumptions,
  isMaterialAssumption,
  REMAINING_UNCERTAINTY_HEADER,
} from "../src/assumption/guard.js";
import { guardAdvisoryConclusion } from "../src/assumption/hook.js";
import type {
  AssumptionCandidate,
  AssumptionGuardInput,
} from "../src/assumption/types.js";
import type { SolandraRecommendationResult } from "../src/solandra/advisory.js";

/** Internal vocabulary that must never reach the user. */
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

function assertUserVisibleClean(values: readonly (string | undefined)[]): void {
  for (const value of values) {
    if (value === undefined) continue;
    for (const word of INTERNAL_VOCABULARY) {
      assert.ok(
        !value.toLowerCase().includes(word),
        `user-visible text leaked internal vocabulary "${word}": ${value}`,
      );
    }
  }
}

function candidate(overrides: Partial<AssumptionCandidate> & { statement: string }): AssumptionCandidate {
  return {
    support: "UNKNOWN",
    confidenceIfTrue: 0.8,
    confidenceIfFalse: 0.8,
    bearsOnConfidence: false,
    affectsConclusion: false,
    affectsAction: false,
    ...overrides,
  };
}

function guardInput(overrides: Partial<AssumptionGuardInput> = {}): AssumptionGuardInput {
  return {
    conclusion: "Adopt the nightly incremental backup plan.",
    expressedConfidence: 0.8,
    candidates: [],
    ...overrides,
  };
}

// --- Materiality classification ---

test("supported dependencies never block, even with large impact flags", () => {
  const supported = candidate({
    statement: "We run nightly batch jobs.",
    support: "SUPPORTED",
    confidenceIfTrue: 0.9,
    confidenceIfFalse: 0.2,
    affectsConclusion: true,
    affectsAction: true,
  });
  assert.equal(isMaterialAssumption(supported), false);
  const output = guardAssumptions(guardInput({ candidates: [supported] }));
  assert.equal(output.cleared, true);
  assert.equal(output.resolution, "CLEAR");
});

test("unsupported dependency with a confidence swing is material", () => {
  const uncovered = candidate({
    statement: "The travel policy covers winter sports injuries.",
    support: "UNSUPPORTED",
    confidenceIfTrue: 0.85,
    confidenceIfFalse: 0.4,
  });
  assert.equal(isMaterialAssumption(uncovered), true);
});

test("unknown dependency affecting only the next action is material", () => {
  const actionShaping = candidate({
    statement: "The candidate can start before the hiring freeze lifts.",
    support: "UNKNOWN",
    affectsAction: true,
  });
  assert.equal(isMaterialAssumption(actionShaping), true);
});

test("unknown dependency with no impact on conclusion, confidence, or action is non-material", () => {
  const incidental = candidate({
    statement: "The paint brand offers a loyalty discount.",
    support: "UNKNOWN",
  });
  assert.equal(isMaterialAssumption(incidental), false);
  const output = guardAssumptions(guardInput({
    conclusion: "Repaint the hallway in eggshell white.",
    candidates: [incidental],
  }));
  assert.equal(output.cleared, true);
  assert.deepEqual(output.surfacedUncertainties, []);
});

test("unsupported dependency flagged as bearing on confidence is material without flags", () => {
  const flagged = candidate({
    statement: "The fund's past returns predict next-year performance.",
    support: "UNSUPPORTED",
    bearsOnConfidence: true,
  });
  assert.equal(isMaterialAssumption(flagged), true);
});

test("supported dependency with action impact stays non-material", () => {
  const supported = candidate({
    statement: "The user asked for the cheapest option.",
    support: "SUPPORTED",
    affectsAction: true,
    affectsConclusion: true,
  });
  assert.equal(isMaterialAssumption(supported), false);
});

// --- Resolution paths ---

test("cleared output preserves confidence and adds no strings", () => {
  const output = guardAssumptions(guardInput({
    candidates: [candidate({ statement: "The paint brand offers a loyalty discount.", support: "UNKNOWN" })],
  }));
  assert.equal(output.cleared, true);
  assert.equal(output.adjustedConfidence, 0.8);
  assert.equal(output.weakenedConclusion, undefined);
  assert.equal(output.question, undefined);
  assert.deepEqual(output.surfacedUncertainties, []);
  assertUserVisibleClean([output.weakenedConclusion, output.question]);
});

test("unknown top dependency weakens and asks one natural question", () => {
  const output = guardAssumptions(guardInput({
    candidates: [candidate({
      statement: "Vendor X covers weekend failures.",
      support: "UNKNOWN",
      confidenceIfTrue: 0.85,
      confidenceIfFalse: 0.45,
    })],
  }));
  assert.equal(output.cleared, false);
  assert.equal(output.resolution, "WEAKEN_AND_ASK");
  assert.equal(output.question, "Can you confirm that vendor X covers weekend failures?");
  assert.ok(output.weakenedConclusion?.includes(REMAINING_UNCERTAINTY_HEADER));
  assert.ok(output.weakenedConclusion?.includes("Adopt the nightly incremental backup plan."));
  assert.deepEqual(output.surfacedUncertainties, ["Vendor X covers weekend failures."]);
  assertUserVisibleClean([output.weakenedConclusion, output.question]);
});

test("unsupported dependency weakens without asking the user", () => {
  const output = guardAssumptions(guardInput({
    candidates: [candidate({
      statement: "The travel policy covers winter sports injuries.",
      support: "UNSUPPORTED",
      confidenceIfTrue: 0.85,
      confidenceIfFalse: 0.4,
    })],
  }));
  assert.equal(output.cleared, false);
  assert.equal(output.resolution, "WEAKEN");
  assert.equal(output.question, undefined);
  assert.ok(output.weakenedConclusion?.includes(REMAINING_UNCERTAINTY_HEADER));
  assertUserVisibleClean([output.weakenedConclusion, output.question]);
});

test("adjusted confidence is the worst material case", () => {
  const output = guardAssumptions(guardInput({
    expressedConfidence: 0.9,
    candidates: [
      candidate({
        statement: "Vendor X covers weekend failures.",
        support: "UNKNOWN",
        confidenceIfTrue: 0.9,
        confidenceIfFalse: 0.5,
      }),
      candidate({
        statement: "The hallway paint is in stock locally.",
        support: "UNSUPPORTED",
        confidenceIfTrue: 0.9,
        confidenceIfFalse: 0.3,
      }),
    ],
  }));
  assert.equal(output.adjustedConfidence, 0.3);
  assert.equal(output.material.length, 2);
});

test("a statement already phrased as a question is reused verbatim", () => {
  const output = guardAssumptions(guardInput({
    candidates: [candidate({
      statement: "Which vendor covers weekend failures?",
      support: "UNKNOWN",
      bearsOnConfidence: true,
    })],
  }));
  assert.equal(output.resolution, "WEAKEN_AND_ASK");
  assert.equal(output.question, "Which vendor covers weekend failures?");
  assertUserVisibleClean([output.question]);
});

test("the question targets the largest confidence swing", () => {
  const output = guardAssumptions(guardInput({
    candidates: [
      candidate({
        statement: "The hallway paint is in stock locally.",
        support: "UNKNOWN",
        confidenceIfTrue: 0.8,
        confidenceIfFalse: 0.7,
      }),
      candidate({
        statement: "Vendor X covers weekend failures.",
        support: "UNKNOWN",
        confidenceIfTrue: 0.8,
        confidenceIfFalse: 0.3,
      }),
    ],
  }));
  assert.equal(output.question, "Can you confirm that vendor X covers weekend failures?");
});

// --- Input validation ---

test("invalid inputs fail explicitly", () => {
  assert.throws(() => guardAssumptions(guardInput({ conclusion: "   " })), /conclusion must be non-empty/);
  assert.throws(() => guardAssumptions(guardInput({ expressedConfidence: Number.NaN })), /expressedConfidence/);
  assert.throws(() => guardAssumptions(guardInput({ expressedConfidence: 1.2 })), /expressedConfidence/);
  assert.throws(
    () => guardAssumptions(guardInput({ candidates: [candidate({ statement: "  " })] })),
    /statement must be non-empty/,
  );
  assert.throws(
    () => guardAssumptions(guardInput({
      candidates: [candidate({
        statement: "Vendor X covers weekend failures.",
        confidenceIfTrue: 0.3,
        confidenceIfFalse: 0.6,
      })],
    })),
    /must not exceed/,
  );
  assert.throws(() => guardAssumptions(guardInput({ proposedAction: "  " })), /proposedAction/);
});

// --- Advisory hook ---

function buildRecommendation(overrides?: Partial<SolandraRecommendationResult>): SolandraRecommendationResult {
  return {
    status: "RECOMMENDATION",
    recommendation: "Adopt the nightly incremental backup plan.",
    basis: [{ knowledgeId: "knowledge-1", claimIds: ["claim-1"] }],
    rationale: ["It restores fastest in the tested scenario."],
    tradeoffs: ["It costs more disk space."],
    assumptions: ["We run nightly batch jobs."],
    uncertainties: [],
    preservedUncertainties: [],
    alternatives: ["Keep the weekly full backup."],
    ...overrides,
  };
}

test("hook clears invisibly when there is nothing novel", () => {
  const recommendation = buildRecommendation({
    uncertainties: ["Restores were timed on last quarter hardware."],
    preservedUncertainties: ["Restores were timed on last quarter hardware."],
  });
  const screening = guardAdvisoryConclusion({
    recommendation,
    governedUncertainties: ["Restores were timed on last quarter hardware."],
  });
  assert.equal(screening.cleared, true);
  assert.equal(screening.recommendation, recommendation);
  assert.equal(screening.question, undefined);
  assert.equal(screening.guard.resolution, "CLEAR");
});

test("hook clears on novel drafting prose without a user-directed question", () => {
  const recommendation = buildRecommendation({
    uncertainties: ["Disk growth may outpace the current quota next year."],
  });
  const screening = guardAdvisoryConclusion({
    recommendation,
    governedUncertainties: ["Restores were timed on last quarter hardware."],
  });
  assert.equal(screening.cleared, true);
  assert.equal(screening.recommendation, recommendation);
  assert.equal(screening.question, undefined);
});

test("hook escalates a novel user-directed question, nothing else", () => {
  const recommendation = buildRecommendation({
    uncertainties: [
      "Disk growth may outpace the current quota next year.",
      "Should I hold the weekend window before confirming the cutover?",
    ],
  });
  const screening = guardAdvisoryConclusion({
    recommendation,
    governedUncertainties: ["Restores were timed on last quarter hardware."],
  });
  assert.equal(screening.cleared, false);
  assert.equal(screening.question, "Should I hold the weekend window before confirming the cutover?");
  assert.equal(screening.recommendation, recommendation);
  assert.equal(screening.guard.resolution, "WEAKEN_AND_ASK");
  assertUserVisibleClean([screening.question, screening.guard.weakenedConclusion]);
});

test("hook does not escalate a governed question restated with variant punctuation", () => {
  const recommendation = buildRecommendation({
    uncertainties: ["Should we proceed before the audit window closes - Friday?"],
  });
  const screening = guardAdvisoryConclusion({
    recommendation,
    // Em-dash variant of the same governed uncertainty: covered by the
    // canonical comparison key, so this is tracked state, not a blocker.
    governedUncertainties: ["Should we proceed before the audit window closes \u2014 Friday?"],
  });
  assert.equal(screening.cleared, true);
  assert.equal(screening.question, undefined);
});

test("hook clears with empty uncertainties and empty governed context", () => {
  const recommendation = buildRecommendation();
  const screening = guardAdvisoryConclusion({ recommendation, governedUncertainties: [] });
  assert.equal(screening.cleared, true);
  assert.equal(screening.recommendation, recommendation);
});
