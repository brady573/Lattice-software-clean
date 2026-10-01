import assert from "node:assert/strict";
import test from "node:test";
import { emptyIntentState } from "../src/intent/types.js";
import {
  admitActionCandidate,
  buildAdvisoryRequest,
  solandraAdvisoryResultSchema,
  type SolandraAdvisoryInput,
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

test("dp013_schema_authority_bearing_candidate_keys_mean_absent_recommendation_preserved", () => {
  const rawAuthorityBearing = {
    action: "Call back",
    consequence: "LOW",
    support: "SUFFICIENT",
    claimIds: ["c1"],
  };
  const parsedAuthority = solandraAdvisoryResultSchema.parse(
    validEnvelope({ actionCandidate: rawAuthorityBearing }),
  );
  assert.equal(parsedAuthority.status, "RECOMMENDATION");
  assert.equal(admitActionCandidate(rawAuthorityBearing), undefined);
  const rawUnknownKey = { action: "Call back", notebook: "ring twice" };
  const parsedUnknown = solandraAdvisoryResultSchema.parse(
    validEnvelope({ actionCandidate: rawUnknownKey }),
  );
  assert.equal(parsedUnknown.status, "RECOMMENDATION");
  assert.equal(admitActionCandidate(rawUnknownKey), undefined);
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

function minimalAdvisoryInput(): SolandraAdvisoryInput {
  return {
    conversationId: "conv-test",
    userMessageId: "msg-test",
    authoritativeIntent: {
      intentScopeId: "scope-test",
      intentVersionId: "v-test",
      version: 1,
      predecessorIntentVersionId: null,
      transitionId: "t-test",
      lineageKind: "INITIAL",
      lineageTargetIntentVersionId: null,
      state: emptyIntentState(),
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    authoritativeObjective: "Decide the follow-up plan.",
    userContext: [],
    knowledge: [],
  };
}

function advisorySystemContent(): string {
  const request = buildAdvisoryRequest("test-model", minimalAdvisoryInput());
  const system = request.messages[0];
  assert.ok(system !== undefined && system.role === "system");
  assert.equal(typeof system.content, "string");
  return system.content;
}

test("dp013_prompt_describes_candidate_as_optional_proposal_only", () => {
  const content = advisorySystemContent();
  assert.ok(content.includes("proposal material only"));
  assert.ok(content.includes("naturally follows the recommendation"));
});

test("dp013_prompt_prohibits_authorization_classification_mode", () => {
  const content = advisorySystemContent();
  assert.ok(content.includes("must not state whether Lattice should authorize or execute it"));
  assert.ok(content.includes("must not classify its safety, consequence, or reversibility"));
  assert.ok(content.includes("must not select a mode"));
});

test("dp013_prompt_has_no_f4_vocabulary", () => {
  const content = advisorySystemContent();
  for (const token of ["INVESTIGATE", "TEST", "ACT", "WAIT", "ESCALATE"]) {
    assert.equal(content.includes(token), false, `system content must not contain ${token}`);
  }
});

test("dp013_prompt_contract_shows_optional_candidate_shape", () => {
  const content = advisorySystemContent();
  const contractLine = content.split("\n").find((line) => line.startsWith("["));
  assert.ok(contractLine !== undefined);
  const contract = JSON.parse(contractLine) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(contract));
  const first = contract[0];
  assert.ok(first !== undefined);
  const candidate = first["actionCandidate"] as Record<string, unknown> | undefined;
  assert.ok(candidate !== undefined && typeof candidate === "object");
  assert.deepEqual(Object.keys(candidate).sort(), ["action", "expectedOutcome", "verification"]);
});
