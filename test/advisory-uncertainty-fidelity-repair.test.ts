import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalUncertaintyKey,
  canonicalUncertaintyArraysEqual,
  canonicalUncertaintySet,
  uncertaintiesEquivalent,
} from "../src/string/uncertainty-canonical.js";
import {
  validateAndProjectRecommendationBasis,
} from "../src/solandra/advisory.js";
import type { SolandraAdvisoryInput, SolandraRecommendationResult } from "../src/solandra/advisory.js";
import { assertPreservedGovernedUncertainty } from "../src/recommendation/recommendation-continuity.js";
import type { SolandraRecommendationResult as SolandraRecResult } from "../src/solandra/advisory.js";

/**
 * Issue #91 narrow advisory uncertainty-fidelity repair.
 *
 * Focused deterministic regressions for acceptance criteria A–J.
 */

// Common supplied governed uncertainties (the "truth")
const SUPPLIED = [
  "The comparison depends on maintenance cost figures that were not independently verified for the candidate approaches.",
  "Evidence about long-term reliability is limited to a single reporting period and may not generalise to other deployments.",
];

function buildAdvisoryInput(overrides: Partial<SolandraAdvisoryInput> = {}): SolandraAdvisoryInput {
  return {
    conversationId: "validator-fidelity-test",
    userMessageId: "validator-fidelity-message",
    authoritativeIntent: {
      intentScopeId: "consultation:validator-fidelity",
      intentVersionId: "intent-validator-fidelity-v1",
      version: 1,
      predecessorIntentVersionId: null,
      transitionId: "transition-validator-fidelity-v1",
      lineageKind: "INITIAL",
      lineageTargetIntentVersionId: null,
      state: {
        objective: {
          value: { state: "VALUE", value: "Compare two backup strategies." },
          provenance: {
            kind: "EXPLICIT_USER",
            logicalUserTurnId: "turn-validator-fidelity",
            sourceMessageId: "validator-fidelity-message",
            sourceDigest: "a".repeat(64),
          },
        },
        requirements: {},
        preferences: {},
      },
      createdAt: "2026-09-27T00:00:00.000Z",
    },
    authoritativeObjective: "Compare two backup strategies.",
    userContext: ["Compare two backup strategies."],
    knowledge: [{
      knowledgeId: "knowledge-validator-fidelity",
      objective: "Compare two backup strategies.",
      findings: [{
        claimId: "claim-validator-fidelity-1",
        text: "Recurring subscription cost continues for as long as the subscription remains active.",
        status: "SUPPORTED",
        confidence: "HIGH",
      }],
      uncertainties: SUPPLIED,
      asOf: "2026-09-27T00:00:00.000Z",
    }],
    ...overrides,
  };
}

function buildRecommendationResult(preservedUncertainties: string[]): SolandraRecommendationResult {
  return {
    status: "RECOMMENDATION",
    recommendation: "Choose the monthly subscription for predictable costs.",
    basis: [{ knowledgeId: "knowledge-validator-fidelity", claimIds: ["claim-validator-fidelity-1"] }],
    rationale: ["The subscription incurs recurring costs as long as it remains active."],
    tradeoffs: ["Subscription: higher total cost over long term; but spreads expense."],
    assumptions: [],
    uncertainties: SUPPLIED,
    preservedUncertainties,
    alternatives: ["Select the one-off purchase to avoid any recurring fees."],
  };
}

/* ------------------------------------------------------------------ *
 * A. Exact supplied uncertainty still passes unchanged.
 * ------------------------------------------------------------------ */
test("A. exact supplied uncertainty passes unchanged through advisory validation", () => {
  const result = buildRecommendationResult(SUPPLIED);
  const input = buildAdvisoryInput();
  // Should not throw
  validateAndProjectRecommendationBasis(input, result);
});

test("A. exact supplied uncertainty passes unchanged through recommendation establishment", () => {
  const advisory = buildRecommendationResult(SUPPLIED);
  const governed = SUPPLIED;
  assertPreservedGovernedUncertainty(advisory, governed);
});

/* ------------------------------------------------------------------ *
 * B. U+002D supplied versus U+2011 returned passes.
 * ------------------------------------------------------------------ */
test("B. advisory validation: U+002D supplied vs U+2011 returned passes", () => {
  const withNonBreakingHyphen: string[] = SUPPLIED.map((s) => s.replace(/-/g, "\u2011"));
  const result = buildRecommendationResult(withNonBreakingHyphen);
  const input = buildAdvisoryInput();
  validateAndProjectRecommendationBasis(input, result);
});

test("B. recommendation establishment: U+002D supplied vs U+2011 returned passes", () => {
  const withNonBreakingHyphen: string[] = SUPPLIED.map((s) => s.replace(/-/g, "\u2011"));
  const advisory = buildRecommendationResult(withNonBreakingHyphen);
  const governed = SUPPLIED;
  assertPreservedGovernedUncertainty(advisory, governed);
});

/* ------------------------------------------------------------------ *
 * C. Every authorized dash-family fold passes.
 * ------------------------------------------------------------------ */
const DASH_VARIANTS = [
  { name: "U+2010 HYPHEN", char: "\u2010" },
  { name: "U+2011 NON-BREAKING HYPHEN", char: "\u2011" },
  { name: "U+2012 FIGURE DASH", char: "\u2012" },
  { name: "U+2013 EN DASH", char: "\u2013" },
  { name: "U+2014 EM DASH", char: "\u2014" },
  { name: "U+2212 MINUS SIGN", char: "\u2212" },
  { name: "U+FF0D FULLWIDTH HYPHEN-MINUS", char: "\uff0d" },
];

for (const { name, char } of DASH_VARIANTS) {
  test(`C. advisory validation: ${name} folds to HYPHEN-MINUS`, () => {
    const replaced = SUPPLIED.map((s) => s.replace(/-/g, char));
    const result = buildRecommendationResult(replaced);
    const input = buildAdvisoryInput();
    validateAndProjectRecommendationBasis(input, result);
  });

  test(`C. recommendation establishment: ${name} folds to HYPHEN-MINUS`, () => {
    const replaced = SUPPLIED.map((s) => s.replace(/-/g, char));
    const advisory = buildRecommendationResult(replaced);
    const governed = SUPPLIED;
    assertPreservedGovernedUncertainty(advisory, governed);
  });
}

/* ------------------------------------------------------------------ *
 * D. Harmless whitespace variation passes.
 * ------------------------------------------------------------------ */
test("D. leading/trailing whitespace passes advisory validation", () => {
  const withSpace: string[] = SUPPLIED.map((s) => `  ${s}  `);
  const result = buildRecommendationResult(withSpace);
  const input = buildAdvisoryInput();
  validateAndProjectRecommendationBasis(input, result);
});

test("D. repeated ordinary whitespace passes advisory validation", () => {
  const withMultiSpace: string[] = SUPPLIED.map((s) => s.replace(/ /g, "   "));
  const result = buildRecommendationResult(withMultiSpace);
  const input = buildAdvisoryInput();
  validateAndProjectRecommendationBasis(input, result);
});

test("D. Unicode whitespace runs pass advisory validation", () => {
  // Use no-break space (U+00A0) and em space (U+2003)
  const withUnicode: string[] = SUPPLIED.map((s) => s.replace(/ /g, "\u00A0\u2003"));
  const result = buildRecommendationResult(withUnicode);
  const input = buildAdvisoryInput();
  validateAndProjectRecommendationBasis(input, result);
});

test("D. leading/trailing whitespace passes recommendation establishment", () => {
  const withSpace: string[] = SUPPLIED.map((s) => `  ${s}  `);
  const advisory = buildRecommendationResult(withSpace);
  const governed = SUPPLIED;
  assertPreservedGovernedUncertainty(advisory, governed);
});

/* ------------------------------------------------------------------ *
 * E. A paraphrase still fails.
 * ------------------------------------------------------------------ */
test("E. paraphrased uncertainty fails advisory validation", () => {
  const paraphrased: string[] = SUPPLIED.map((s) =>
    s.replace("comparison depends on", "comparison is based on")
      .replace("limited to a single reporting period", "restricted to one period"),
  );
  const result = buildRecommendationResult(paraphrased);
  const input = buildAdvisoryInput();

  assert.throws(
    () => validateAndProjectRecommendationBasis(input, result),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("invented or dropped material governed uncertainty"),
    "paraphrase must fail",
  );
});

test("E. paraphrased uncertainty fails recommendation establishment", () => {
  const paraphrased: string[] = SUPPLIED.map((s) =>
    s.replace("comparison depends on", "comparison is based on"),
  );
  const advisory = buildRecommendationResult(paraphrased);
  const governed = SUPPLIED;

  assert.throws(
    () => assertPreservedGovernedUncertainty(advisory, governed),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("dropped or invented material governed uncertainty"),
    "paraphrase must fail",
  );
});

/* ------------------------------------------------------------------ *
 * F. Fabricated uncertainty still fails.
 * ------------------------------------------------------------------ */
test("F. fabricated uncertainty fails advisory validation", () => {
  const fabricated: string[] = [...SUPPLIED, "The vendor has never published any reliability data."];
  const result = buildRecommendationResult(fabricated);
  const input = buildAdvisoryInput();

  assert.throws(
    () => validateAndProjectRecommendationBasis(input, result),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("invented or dropped material governed uncertainty"),
    "fabricated uncertainty must fail",
  );
});

test("F. fabricated uncertainty fails recommendation establishment", () => {
  const fabricated: string[] = [...SUPPLIED, "The vendor has never published any reliability data."];
  const advisory = buildRecommendationResult(fabricated);
  const governed = SUPPLIED;

  assert.throws(
    () => assertPreservedGovernedUncertainty(advisory, governed),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("dropped or invented material governed uncertainty"),
    "fabricated uncertainty must fail",
  );
});

/* ------------------------------------------------------------------ *
 * G. Dropped governed uncertainty still fails.
 * ------------------------------------------------------------------ */
test("G. omitted governed uncertainty fails advisory validation", () => {
  const dropped: string[] = [SUPPLIED[0] as string];
  const result = buildRecommendationResult(dropped);
  const input = buildAdvisoryInput();

  assert.throws(
    () => validateAndProjectRecommendationBasis(input, result),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("invented or dropped material governed uncertainty"),
    "dropped uncertainty must fail",
  );
});

test("G. omitted governed uncertainty fails recommendation establishment", () => {
  const dropped: string[] = [SUPPLIED[0] as string];
  const advisory = buildRecommendationResult(dropped);
  const governed = SUPPLIED;

  assert.throws(
    () => assertPreservedGovernedUncertainty(advisory, governed),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("dropped or invented material governed uncertainty"),
    "dropped uncertainty must fail",
  );
});

/* ------------------------------------------------------------------ *
 * H. Material text alteration still fails.
 * ------------------------------------------------------------------ */
test("H. changed number fails advisory validation", () => {
  const altered: string[] = SUPPLIED.map((s) =>
    s.replace("single reporting period", "two reporting periods"),
  );
  const result = buildRecommendationResult(altered);
  const input = buildAdvisoryInput();

  assert.throws(
    () => validateAndProjectRecommendationBasis(input, result),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("invented or dropped material governed uncertainty"),
    "changed number must fail",
  );
});

test("H. negation flip fails advisory validation", () => {
  const altered: string[] = SUPPLIED.map((s) =>
    s.replace("may not generalise", "will generalise"),
  );
  const result = buildRecommendationResult(altered);
  const input = buildAdvisoryInput();

  assert.throws(
    () => validateAndProjectRecommendationBasis(input, result),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("invented or dropped material governed uncertainty"),
    "negation flip must fail",
  );
});

test("H. entity change fails advisory validation", () => {
  const altered: string[] = SUPPLIED.map((s) =>
    s.replace("candidate approaches", "vendor products"),
  );
  const result = buildRecommendationResult(altered);
  const input = buildAdvisoryInput();

  assert.throws(
    () => validateAndProjectRecommendationBasis(input, result),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("invented or dropped material governed uncertainty"),
    "entity change must fail",
  );
});

test("H. substantive wording change fails recommendation establishment", () => {
  const altered: string[] = SUPPLIED.map((s) =>
    s.replace("not independently verified", "independently verified"),
  );
  const advisory = buildRecommendationResult(altered);
  const governed = SUPPLIED;

  assert.throws(
    () => assertPreservedGovernedUncertainty(advisory, governed),
    (error: Error) =>
      error instanceof Error &&
      error.message.includes("dropped or invented material governed uncertainty"),
    "substantive wording change must fail",
  );
});

/* ------------------------------------------------------------------ *
 * I. Durable Recommendation establishment accepts the same typographic
 *    variant accepted by advisory validation.
 * ------------------------------------------------------------------ */
test("I. end-to-end: U+2011 variant accepted by both boundaries", () => {
  const withNonBreakingHyphen: string[] = SUPPLIED.map((s) => s.replace(/-/g, "\u2011"));
  const advisory = buildRecommendationResult(withNonBreakingHyphen);
  const input = buildAdvisoryInput();

  // Advisory validation passes
  const findings = validateAndProjectRecommendationBasis(input, advisory);
  assert.ok(findings.length > 0);

  // Recommendation establishment passes
  const governed = SUPPLIED;
  assertPreservedGovernedUncertainty(advisory, governed);

  // The original preserved strings are what get stored in the Recommendation
  // (not the canonicalized keys). This is implicitly tested by the fact
  // that the advisory object still contains the original strings.
  assert.deepEqual(advisory.preservedUncertainties, withNonBreakingHyphen);
});

/* ------------------------------------------------------------------ *
 * J. Original raw string remains preserved rather than rewritten.
 * ------------------------------------------------------------------ */
test("J. advisory validation does not mutate the returned preservedUncertainties", () => {
  const withNonBreakingHyphen: string[] = SUPPLIED.map((s) => s.replace(/-/g, "\u2011"));
  const result = buildRecommendationResult(withNonBreakingHyphen);
  const input = buildAdvisoryInput();

  validateAndProjectRecommendationBasis(input, result);

  // The original array with the non-breaking hyphens is still what the
  // caller holds — the function does not rewrite it in place.
  assert.deepEqual(result.preservedUncertainties, withNonBreakingHyphen);
  // The second element has "long-term" -> "long\u2011term" after replacement
  const first = result.preservedUncertainties[1];
  assert.ok(first !== undefined && first.includes("\u2011"), "original U+2011 retained");
});

test("J. recommendation establishment does not mutate the advisory object", () => {
  const withNonBreakingHyphen: string[] = SUPPLIED.map((s) => s.replace(/-/g, "\u2011"));
  const advisory = buildRecommendationResult(withNonBreakingHyphen);
  const governed = SUPPLIED;

  assertPreservedGovernedUncertainty(advisory, governed);

  // The advisory object's preservedUncertainties remains the original
  assert.deepEqual(advisory.preservedUncertainties, withNonBreakingHyphen);
  const first = advisory.preservedUncertainties[1];
  assert.ok(first !== undefined && first.includes("\u2011"), "original U+2011 retained");
});

/* ------------------------------------------------------------------ *
 * Additional: helper function regressions
 * ------------------------------------------------------------------ */
test("canonicalUncertaintyKey: empty string returns empty", () => {
  assert.equal(canonicalUncertaintyKey(""), "");
});

test("canonicalUncertaintyKey: whitespace only returns empty", () => {
  assert.equal(canonicalUncertaintyKey("   \t\n  "), "");
});

test("canonicalUncertaintyKey: dash family folds correctly", () => {
  for (const { char } of DASH_VARIANTS) {
    assert.equal(canonicalUncertaintyKey(`long${char}term`), "long-term");
  }
});

test("canonicalUncertaintyKey: Unicode whitespace collapses", () => {
  assert.equal(canonicalUncertaintyKey("a\u00A0\u2003b"), "a b");
  assert.equal(canonicalUncertaintyKey("a\t\nb"), "a b");
});

test("canonicalUncertaintyArraysEqual: order independence", () => {
  assert.ok(canonicalUncertaintyArraysEqual(SUPPLIED, [...SUPPLIED].reverse()));
});

test("canonicalUncertaintyArraysEqual: duplicates on one side are ignored", () => {
  const left = [...SUPPLIED, SUPPLIED[0] as string] as string[];
  const right = SUPPLIED;
  assert.ok(canonicalUncertaintyArraysEqual(left, right));
});

test("uncertaintiesEquivalent: dash variant returns true", () => {
  assert.ok(uncertaintiesEquivalent("long-term", "long\u2011term"));
});

test("uncertaintiesEquivalent: paraphrase returns false", () => {
  assert.ok(!uncertaintiesEquivalent("long-term", "long duration"));
});

test("canonicalUncertaintySet: duplicates are deduplicated", () => {
  const set = canonicalUncertaintySet(["a", "a", "b"]);
  assert.equal(set.size, 2);
  assert.ok(set.has("a"));
  assert.ok(set.has("b"));
});