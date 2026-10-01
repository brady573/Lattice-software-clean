import assert from "node:assert/strict";
import test from "node:test";
import {
  admitActionCandidate,
  solandraAdvisoryResultSchema,
} from "../src/solandra/advisory.js";

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "RECOMMENDATION",
    recommendation: "Approve the follow-up plan.",
    basis: [{ knowledgeId: "k1", claimIds: ["c1"] }],
    rationale: ["Governed basis supports the proposal."],
    tradeoffs: [],
    assumptions: [],
    uncertainties: [],
    preservedUncertainties: [],
    alternatives: [],
    ...overrides,
  };
}

test("dp013_schema_accepts_valid_optional_candidate", () => {
  const rawCandidate = {
    action: "Book the follow-up call",
    expectedOutcome: "A date is set",
    verification: "Check the calendar invite",
  };
  const parsed = solandraAdvisoryResultSchema.parse(validEnvelope({ actionCandidate: rawCandidate }));
  assert.equal(parsed.status, "RECOMMENDATION");
  const admitted = admitActionCandidate(rawCandidate);
  assert.deepEqual(admitted, rawCandidate);
  assert.equal(Object.isFrozen(admitted), true);
});

test("dp013_schema_malformed_candidate_means_absent", () => {
  const parsed = solandraAdvisoryResultSchema.parse(validEnvelope({ actionCandidate: { action: 42 } }));
  assert.equal(parsed.status, "RECOMMENDATION");
  assert.equal(admitActionCandidate({ action: 42 }), undefined);
});

test("dp013_schema_strictness_preserved_for_unrelated_fields", () => {
  assert.throws(() => solandraAdvisoryResultSchema.parse(validEnvelope({ confidence: 0.9 })));
});

test("dp013_schema_strips_authority_bearing_candidate_keys", () => {
  const admitted = admitActionCandidate({
    action: "Call back",
    consequence: "LOW",
    support: "SUFFICIENT",
    claimIds: ["c1"],
  });
  assert.deepEqual(admitted, { action: "Call back" });
});

test("dp013_FAILURE_BOUNDARY_invalid_required_rejects_AND_invalid_candidate_only_removes_eligibility", () => {
  assert.throws(() =>
    solandraAdvisoryResultSchema.parse(
      validEnvelope({
        recommendation: "",
        actionCandidate: { action: "Book the follow-up call" },
      }),
    ),
  );
  const parsed = solandraAdvisoryResultSchema.parse(validEnvelope({ actionCandidate: {} }));
  assert.equal(parsed.status, "RECOMMENDATION");
  assert.equal(admitActionCandidate({}), undefined);
});

test("dp013_schema_absent_candidate_identical_behavior", () => {
  const parsed = solandraAdvisoryResultSchema.parse(validEnvelope());
  assert.equal(parsed.status, "RECOMMENDATION");
  assert.equal("actionCandidate" in parsed, false);
});
