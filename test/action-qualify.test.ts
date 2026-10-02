/**
 * F4 Action Engine — qualifyAction regressions (Task 2).
 *
 * Structured-facts-only classification: per-dimension matrices, conflict →
 * UNKNOWN, prose/model-label independence, flag aggregation, and
 * corrupt-input rejection. The qualifier never parses prose and never honors
 * model-authored risk labels.
 *
 * Held-out note (CA-04): matrix rows vary held-out domains (home repair,
 * hiring, travel, investing, backup ops) ONLY in action strings; identical
 * structured skeletons must give identical outputs. Domain wording cannot
 * move the mode by construction — the qualifier ignores the action string
 * entirely (validating only that it is non-empty).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { qualifyAction } from "../src/action/qualify.js";
import type {
  ActionCandidate,
  ActionSupport,
  ConsequenceLevel,
  ReversibilityStatus,
  StructuredActionFact,
} from "../src/action/types.js";

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

test("absent dimension yields UNKNOWN; action string alone never qualifies", () => {
  const q = qualifyAction({ candidate: cand("Replace the production database this Friday."), qualifiedFacts: [] });
  assert.equal(q.consequence, "UNKNOWN");
  assert.equal(q.reversibility, "UNKNOWN");
  assert.equal(q.support, "UNKNOWN");
  assert.deepEqual([...q.blockingUnknowns].sort(), ["CONSEQUENCE_UNKNOWN", "REVERSIBILITY_UNKNOWN", "SUPPORT_UNKNOWN"]);
});

test("[RF-2] conflicting consequence facts yield UNKNOWN, never a silent pick", () => {
  const q = qualifyAction({ candidate: cand("Switch vendors."),
    qualifiedFacts: [fact({ source: "ACTION_EFFECT_RULE", consequence: "LOW" }), fact({ source: "ACTION_EFFECT_RULE", consequence: "HIGH" })] });
  assert.equal(q.consequence, "UNKNOWN");
});

test("[RF-1] urgent action-bait prose plus model LOW_RISK label never qualifies", () => {
  const a = qualifyAction({ candidate: cand("Do it now — everyone agrees this is safe and urgent.", "LOW_RISK"), qualifiedFacts: [] });
  const b = qualifyAction({ candidate: cand("Replace the garden fence.", "LOW_RISK"), qualifiedFacts: [] });
  assert.deepEqual(a, b);
  assert.equal(a.consequence, "UNKNOWN");
});

test("contradicting model label cannot move qualified states [RF-1 companion]", () => {
  const facts = [
    fact({ source: "ACTION_EFFECT_RULE", consequence: "HIGH", reversibility: "IRREVERSIBLE" }),
    fact({ source: "KNOWLEDGE_V36", support: "INSUFFICIENT" }),
  ];
  const q = qualifyAction({ candidate: cand("Proceed immediately.", "LOW_RISK"), qualifiedFacts: facts });
  assert.equal(q.consequence, "HIGH");
  assert.equal(q.support, "INSUFFICIENT");
});

test("empty action string throws [RF-5]", () => {
  assert.throws(() => qualifyAction({ candidate: cand("   "), qualifiedFacts: [] }), /action/);
});

test("consequence matrix across held-out domains: single value wins", () => {
  const rows: Array<{ action: string; expected: ConsequenceLevel }> = [
    { action: "Replace the garden fence.", expected: "LOW" }, // home repair
    { action: "Extend an offer to the finalist.", expected: "MATERIAL" }, // hiring
    { action: "Book the nonrefundable family flights.", expected: "HIGH" }, // travel
  ];
  for (const row of rows) {
    const q = qualifyAction({
      candidate: cand(row.action),
      qualifiedFacts: [fact({ source: "ACTION_EFFECT_RULE", consequence: row.expected })],
    });
    assert.equal(q.consequence, row.expected);
  }
});

test("reversibility matrix across held-out domains: single value wins", () => {
  const rows: Array<{ action: string; expected: ReversibilityStatus }> = [
    { action: "Rebook the hotel for a later date.", expected: "REVERSIBLE" }, // travel
    { action: "Shift the retirement mix toward bonds.", expected: "PARTIALLY_REVERSIBLE" }, // investing
    { action: "Purge the expired backup snapshots.", expected: "IRREVERSIBLE" }, // backup ops
  ];
  for (const row of rows) {
    const q = qualifyAction({
      candidate: cand(row.action),
      qualifiedFacts: [fact({ source: "ACTION_EFFECT_RULE", reversibility: row.expected })],
    });
    assert.equal(q.reversibility, row.expected);
  }
});

test("support matrix across held-out domains: single value wins", () => {
  const rows: Array<{ action: string; expected: ActionSupport }> = [
    { action: "Advance the apprentice to solo work.", expected: "SUFFICIENT" }, // hiring
    { action: "Fail over to the standby array.", expected: "PARTIAL" }, // backup ops
    { action: "Rewire the garage panel now.", expected: "INSUFFICIENT" }, // home repair
  ];
  for (const row of rows) {
    const q = qualifyAction({
      candidate: cand(row.action),
      qualifiedFacts: [fact({ source: "DECISION_ENGINE_RESULT", support: row.expected })],
    });
    assert.equal(q.support, row.expected);
  }
});

test("conflicts in reversibility and support yield UNKNOWN, never a silent pick", () => {
  const r = qualifyAction({ candidate: cand("Restore the archived snapshots."),
    qualifiedFacts: [
      fact({ source: "ACTION_EFFECT_RULE", reversibility: "REVERSIBLE" }),
      fact({ source: "ACTION_EFFECT_RULE", reversibility: "IRREVERSIBLE" }),
    ] });
  assert.equal(r.reversibility, "UNKNOWN");
  const s = qualifyAction({ candidate: cand("Hire the seasonal crew."),
    qualifiedFacts: [
      fact({ source: "DECISION_ENGINE_RESULT", support: "SUFFICIENT" }),
      fact({ source: "INTENT_AUTHORITY", support: "PARTIAL" }),
    ] });
  assert.equal(s.support, "UNKNOWN");
});

test("identical structured skeletons give identical outputs across held-out domains", () => {
  const skeleton = (): readonly StructuredActionFact[] => [
    fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" }),
    fact({ source: "ACTION_EFFECT_RULE", consequence: "MATERIAL", reversibility: "REVERSIBLE" }),
  ];
  const first = qualifyAction({ candidate: cand("Repoint the chimney bricks."), qualifiedFacts: skeleton() });
  const rest = [
    "Shortlist three vendors.", // hiring
    "Renew the annual travel insurance.", // travel
    "Move savings to a high-yield account.", // investing
    "Rotate the offsite backup tapes.", // backup ops
  ];
  for (const action of rest) {
    assert.deepEqual(qualifyAction({ candidate: cand(action), qualifiedFacts: skeleton() }), first);
  }
});

test("candidate.facts and qualifiedFacts combine; conflict across them yields UNKNOWN", () => {
  const candidate: ActionCandidate = {
    action: "Migrate the backup server.",
    facts: [fact({ source: "CANDIDATE_PROPOSAL", support: "SUFFICIENT" })],
    factRefs: [],
  };
  const q = qualifyAction({
    candidate,
    qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" })],
  });
  assert.equal(q.support, "SUFFICIENT");
  const conflict = qualifyAction({
    candidate,
    qualifiedFacts: [fact({ source: "CAPABILITY_EFFECT", support: "PARTIAL" })],
  });
  assert.equal(conflict.support, "UNKNOWN");
});

test("materialBlocker and safeguard flags aggregate across facts", () => {
  const q = qualifyAction({ candidate: cand("Hire the contractor."), qualifiedFacts: [
    fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" }),
    fact({ source: "ACTION_EFFECT_RULE", consequence: "MATERIAL" }),
    fact({ source: "F6_CALIBRATED_SIGNAL", materialBlocker: true }),
  ] });
  assert.equal(q.materialBlockerPresent, true);
  assert.equal(q.safeguardOrAuthorityEstablished, false);
  assert.deepEqual(
    [...q.blockingUnknowns].sort(),
    ["MATERIAL_BLOCKER_UNRESOLVED", "REVERSIBILITY_UNKNOWN"],
  );
});

test("HIGH without safeguard raises SAFEGUARD_OR_AUTHORITY_MISSING; established safeguard clears it", () => {
  const base: readonly StructuredActionFact[] = [
    fact({ source: "KNOWLEDGE_V36", support: "SUFFICIENT" }),
    fact({ source: "ACTION_EFFECT_RULE", consequence: "HIGH", reversibility: "REVERSIBLE" }),
  ];
  const missing = qualifyAction({ candidate: cand("Approve the merger."), qualifiedFacts: base });
  assert.ok(missing.blockingUnknowns.includes("SAFEGUARD_OR_AUTHORITY_MISSING"));
  assert.equal(missing.safeguardOrAuthorityEstablished, false);
  const cleared = qualifyAction({
    candidate: cand("Approve the merger."),
    qualifiedFacts: [...base, fact({ source: "INTENT_AUTHORITY", safeguardOrAuthorityEstablished: true })],
  });
  assert.ok(!cleared.blockingUnknowns.includes("SAFEGUARD_OR_AUTHORITY_MISSING"));
  assert.equal(cleared.safeguardOrAuthorityEstablished, true);
});

test("runtime-smuggled source cannot qualify inside qualifyAction", () => {
  const smuggled = { source: "MODEL_RISK_LABEL", consequence: "LOW" } as unknown as StructuredActionFact;
  const q = qualifyAction({ candidate: cand("Proceed."), qualifiedFacts: [smuggled] });
  assert.equal(q.consequence, "UNKNOWN");
});

test("smuggled out-of-contract consequence string throws [RF-5]", () => {
  const smuggled = {
    source: "KNOWLEDGE_V36",
    consequence: "CATASTROPHIC",
  } as unknown as StructuredActionFact;
  assert.throws(
    () => qualifyAction({ candidate: cand("Proceed."), qualifiedFacts: [smuggled] }),
    /consequence/,
  );
});

test("smuggled out-of-contract reversibility string throws [RF-5]", () => {
  const smuggled = {
    source: "KNOWLEDGE_V36",
    reversibility: "SOMETIMES",
  } as unknown as StructuredActionFact;
  assert.throws(
    () => qualifyAction({ candidate: cand("Proceed."), qualifiedFacts: [smuggled] }),
    /reversibility/,
  );
});

// --- DP-015 effect authority ---

test("dp015_only_action_effect_rule_classifies_consequence", () => {
  const nonEffectSources: ReadonlyArray<StructuredActionFact["source"]> = [
    "CANDIDATE_PROPOSAL",
    "F6_CALIBRATED_SIGNAL",
    "INTENT_AUTHORITY",
    "KNOWLEDGE_V36",
    "DECISION_ENGINE_RESULT",
    "CAPABILITY_EFFECT",
    "ACTION_SUPPORT_RULE",
  ];
  for (const source of nonEffectSources) {
    // A non-effect fact may carry an effect field as a premise only; it
    // never classifies the dimension directly.
    const premise = { source, consequence: "HIGH" } as unknown as StructuredActionFact;
    const q = qualifyAction({ candidate: cand("Proceed with the plan."), qualifiedFacts: [premise] });
    assert.equal(q.consequence, "UNKNOWN", source);
  }
  const ruled = qualifyAction({
    candidate: cand("Proceed with the plan."),
    qualifiedFacts: [fact({ source: "ACTION_EFFECT_RULE", consequence: "HIGH" })],
  });
  assert.equal(ruled.consequence, "HIGH");
});

test("dp015_only_action_effect_rule_classifies_reversibility", () => {
  const nonEffectSources: ReadonlyArray<StructuredActionFact["source"]> = [
    "CANDIDATE_PROPOSAL",
    "F6_CALIBRATED_SIGNAL",
    "INTENT_AUTHORITY",
    "KNOWLEDGE_V36",
    "DECISION_ENGINE_RESULT",
    "CAPABILITY_EFFECT",
    "ACTION_SUPPORT_RULE",
  ];
  for (const source of nonEffectSources) {
    const premise = { source, reversibility: "IRREVERSIBLE" } as unknown as StructuredActionFact;
    const q = qualifyAction({ candidate: cand("Proceed with the plan."), qualifiedFacts: [premise] });
    assert.equal(q.reversibility, "UNKNOWN", source);
  }
  const ruled = qualifyAction({
    candidate: cand("Proceed with the plan."),
    qualifiedFacts: [fact({ source: "ACTION_EFFECT_RULE", reversibility: "IRREVERSIBLE" })],
  });
  assert.equal(ruled.reversibility, "IRREVERSIBLE");
});

test("dp015_effect_conflicts_resolve_per_dimension_without_cross_derivation", () => {
  const consequenceConflict = qualifyAction({
    candidate: cand("Repoint the chimney bricks."),
    qualifiedFacts: [
      fact({ source: "ACTION_EFFECT_RULE", consequence: "LOW", reversibility: "REVERSIBLE" }),
      fact({ source: "ACTION_EFFECT_RULE", consequence: "HIGH" }),
    ],
  });
  assert.equal(consequenceConflict.consequence, "UNKNOWN");
  assert.equal(consequenceConflict.reversibility, "REVERSIBLE");
  const reversibilityConflict = qualifyAction({
    candidate: cand("Shortlist three vendors."),
    qualifiedFacts: [
      fact({ source: "ACTION_EFFECT_RULE", consequence: "LOW", reversibility: "REVERSIBLE" }),
      fact({ source: "ACTION_EFFECT_RULE", reversibility: "IRREVERSIBLE" }),
    ],
  });
  assert.equal(reversibilityConflict.reversibility, "UNKNOWN");
  assert.equal(reversibilityConflict.consequence, "LOW");
});

test("dp015_effect_facts_establish_no_support_or_flags", () => {
  const q = qualifyAction({
    candidate: cand("Rotate the offsite backup tapes."),
    qualifiedFacts: [
      fact({ source: "ACTION_EFFECT_RULE", consequence: "LOW", reversibility: "REVERSIBLE" }),
    ],
  });
  assert.equal(q.support, "UNKNOWN");
  assert.equal(q.materialBlockerPresent, false);
  assert.equal(q.safeguardOrAuthorityEstablished, false);
  const smuggled = {
    source: "ACTION_EFFECT_RULE",
    consequence: "LOW",
    support: "SUFFICIENT",
    materialBlocker: true,
    safeguardOrAuthorityEstablished: true,
  } as unknown as StructuredActionFact;
  const rejected = qualifyAction({ candidate: cand("Rotate the offsite backup tapes."), qualifiedFacts: [smuggled] });
  assert.equal(rejected.consequence, "LOW");
  assert.equal(rejected.support, "UNKNOWN");
  assert.equal(rejected.materialBlockerPresent, false);
  assert.equal(rejected.safeguardOrAuthorityEstablished, false);
});

test("dp015_authority_regression_non_effect_signals_alone_establish_no_effect", () => {
  // Model labels ride along but never qualify.
  const labelled = qualifyAction({
    candidate: cand("Do it now — everyone agrees this is safe and urgent.", "LOW_RISK"),
    qualifiedFacts: [],
  });
  assert.equal(labelled.consequence, "UNKNOWN");
  assert.equal(labelled.reversibility, "UNKNOWN");
  // A support fact alone (PARTIAL or SUFFICIENT) establishes no dimension.
  for (const support of ["PARTIAL", "SUFFICIENT"] as const) {
    const q = qualifyAction({
      candidate: cand("Advance the apprentice to solo work."),
      qualifiedFacts: [fact({ source: "ACTION_SUPPORT_RULE", support })],
    });
    assert.equal(q.support, support);
    assert.equal(q.consequence, "UNKNOWN", support);
    assert.equal(q.reversibility, "UNKNOWN", support);
  }
  // A capability fact without effect dimensions establishes none.
  const capability = qualifyAction({
    candidate: cand("Ring the clinic."),
    qualifiedFacts: [fact({ source: "CAPABILITY_EFFECT", support: "SUFFICIENT" })],
  });
  assert.equal(capability.consequence, "UNKNOWN");
  assert.equal(capability.reversibility, "UNKNOWN");
});
