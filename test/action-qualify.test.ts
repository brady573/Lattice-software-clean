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
    qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", consequence: "LOW" }), fact({ source: "CAPABILITY_EFFECT", consequence: "HIGH" })] });
  assert.equal(q.consequence, "UNKNOWN");
});

test("[RF-1] urgent action-bait prose plus model LOW_RISK label never qualifies", () => {
  const a = qualifyAction({ candidate: cand("Do it now — everyone agrees this is safe and urgent.", "LOW_RISK"), qualifiedFacts: [] });
  const b = qualifyAction({ candidate: cand("Replace the garden fence.", "LOW_RISK"), qualifiedFacts: [] });
  assert.deepEqual(a, b);
  assert.equal(a.consequence, "UNKNOWN");
});

test("contradicting model label cannot move qualified states [RF-1 companion]", () => {
  const facts = [fact({ source: "KNOWLEDGE_V36", consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "INSUFFICIENT" })];
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
      qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", consequence: row.expected })],
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
      qualifiedFacts: [fact({ source: "CAPABILITY_EFFECT", reversibility: row.expected })],
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
      fact({ source: "CAPABILITY_EFFECT", reversibility: "REVERSIBLE" }),
      fact({ source: "KNOWLEDGE_V36", reversibility: "IRREVERSIBLE" }),
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
    fact({ source: "KNOWLEDGE_V36", consequence: "MATERIAL", reversibility: "REVERSIBLE", support: "SUFFICIENT" }),
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
    fact({ source: "KNOWLEDGE_V36", consequence: "MATERIAL", support: "SUFFICIENT" }),
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
    fact({ source: "KNOWLEDGE_V36", consequence: "HIGH", reversibility: "REVERSIBLE", support: "SUFFICIENT" }),
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
