import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { RunRequest, StructuredDecision } from "../src/domain.js";
import { parseStructuredDecision } from "../src/decision/structured-decision.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";

const databaseUrl = process.env.DATABASE_URL;
const request: RunRequest = {
  goal: "Choose one qualified alternative.",
  priorities: [{ criterion: "quality", weight: 1 }],
  hardConstraints: [{ criterion: "eligible", operator: "eq", value: true }],
};
const common = {
  goal: request.goal,
  evaluations: [],
  rationale: ["Preserve existing decision authority."],
  evidenceIds: ["evidence-1"],
  truthAssessmentIds: ["assessment-1"],
};

// Compile-time invariant checks: these current states must remain impossible.
// @ts-expect-error RECOMMENDATION requires winnerCandidateId.
const recommendationWithoutWinner: StructuredDecision = { ...common, outcome: "RECOMMENDATION", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] };
// @ts-expect-error TIE cannot carry winnerCandidateId.
const tieWithWinner: StructuredDecision = { ...common, outcome: "TIE", winnerCandidateId: "alpha", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: ["alpha", "beta"], materialUnknowns: [] };
// @ts-expect-error FRONTIER cannot carry winnerCandidateId.
const frontierWithWinner: StructuredDecision = { ...common, outcome: "FRONTIER", winnerCandidateId: "alpha", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: [], materialUnknowns: [] };
// @ts-expect-error NO_ELIGIBLE_CANDIDATE cannot carry an active frontier.
const noEligibleWithFrontier: StructuredDecision = { ...common, outcome: "NO_ELIGIBLE_CANDIDATE", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] };
// @ts-expect-error INSUFFICIENT_EVIDENCE requires at least one material unknown.
const insufficientWithoutUnknowns: StructuredDecision = { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] };

const currentDecisions: StructuredDecision[] = [
  { ...common, outcome: "RECOMMENDATION", winnerCandidateId: "alpha", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
  { ...common, outcome: "FRONTIER", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: [], materialUnknowns: [] },
  { ...common, outcome: "TIE", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: ["alpha", "beta"], materialUnknowns: [] },
  { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: ["beta:quality"] },
  { ...common, outcome: "UNRESOLVED", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: ["alpha:quality"] },
  { ...common, outcome: "NO_ELIGIBLE_CANDIDATE", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: [] },
];

test("every current StructuredDecision outcome round-trips through the persistence boundary", () => {
  for (const decision of currentDecisions) {
    assert.deepEqual(parseStructuredDecision(JSON.parse(JSON.stringify(decision))), decision);
  }
});

test("contradictory and ambiguous persisted decision states fail closed", () => {
  const invalid = [
    { ...common, outcome: "RECOMMENDATION", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
    { ...common, outcome: "RECOMMENDATION", winnerCandidateId: "alpha", frontierCandidateIds: ["beta"], tiedCandidateIds: [], materialUnknowns: [] },
    { ...common, outcome: "TIE", winnerCandidateId: "alpha", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: ["alpha", "beta"], materialUnknowns: [] },
    { ...common, outcome: "TIE", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: ["beta", "alpha"], materialUnknowns: [] },
    { ...common, outcome: "FRONTIER", winnerCandidateId: "alpha", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
    { ...common, outcome: "NO_ELIGIBLE_CANDIDATE", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
    { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
    { ...common, outcome: "UNRESOLVED", winnerCandidateId: "alpha", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: ["alpha:quality"] },
    { ...common },
  ];
  for (const value of invalid) {
    assert.throws(() => parseStructuredDecision(value), /Invalid persisted StructuredDecision/);
  }
});

test("the evidenced original winner-only decision shape upgrades explicitly without changing its authority", () => {
  const legacy = { ...common, winnerCandidateId: "alpha" };
  const upgraded = parseStructuredDecision(legacy);
  assert.equal(upgraded.outcome, "RECOMMENDATION");
  assert.equal(upgraded.winnerCandidateId, "alpha");
  assert.deepEqual(upgraded.frontierCandidateIds, ["alpha"]);
  assert.deepEqual(upgraded.tiedCandidateIds, []);
  assert.deepEqual(upgraded.materialUnknowns, []);
  assert.deepEqual(upgraded.evaluations, legacy.evaluations);
  assert.deepEqual(upgraded.rationale, legacy.rationale);
  assert.deepEqual(upgraded.evidenceIds, legacy.evidenceIds);
  assert.deepEqual(upgraded.truthAssessmentIds, legacy.truthAssessmentIds);
});

test(
  "PostgreSQL decision_json upgrades the evidenced legacy shape and rejects contradictory persisted state",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const store = await PostgresRunStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const legacyRunId = randomUUID();
    const invalidRunId = randomUUID();
    try {
      const legacy = { ...common, winnerCandidateId: "alpha" };
      const contradictory = {
        ...common,
        outcome: "TIE",
        winnerCandidateId: "alpha",
        frontierCandidateIds: ["alpha", "beta"],
        tiedCandidateIds: ["alpha", "beta"],
        materialUnknowns: [],
      };
      await pool.query(
        "INSERT INTO runs(id,conversation_id,status,version,request_json,decision_json,explanation) VALUES ($1,$2,'COMPLETED',8,$3::jsonb,$4::jsonb,$5)",
        [legacyRunId, "issue-133-legacy", JSON.stringify(request), JSON.stringify(legacy), "legacy"],
      );
      await pool.query(
        "INSERT INTO runs(id,conversation_id,status,version,request_json,decision_json,explanation) VALUES ($1,$2,'COMPLETED',8,$3::jsonb,$4::jsonb,$5)",
        [invalidRunId, "issue-133-invalid", JSON.stringify(request), JSON.stringify(contradictory), "invalid"],
      );

      const loaded = await store.get(legacyRunId);
      assert.equal(loaded?.decision?.outcome, "RECOMMENDATION");
      assert.equal(loaded?.decision?.winnerCandidateId, "alpha");
      await assert.rejects(store.get(invalidRunId), /Invalid persisted StructuredDecision/);
    } finally {
      await pool.query("DELETE FROM runs WHERE id IN ($1,$2)", [legacyRunId, invalidRunId]);
      await pool.end();
      await store.close();
    }
  },
);
