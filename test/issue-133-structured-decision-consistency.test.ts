import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { LatticeRun, RunRequest, StructuredDecision } from "../src/domain.js";
import {
  parseStructuredDecision,
  validateCurrentStructuredDecision,
} from "../src/decision/structured-decision.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { MemoryRunStore } from "../src/run-store.js";

const databaseUrl = process.env.DATABASE_URL;
const request: RunRequest = {
  goal: "Choose one qualified alternative.",
  priorities: [{ criterion: "quality", weight: 1 }],
  hardConstraints: [{ criterion: "eligible", operator: "eq", value: true }],
};

function evaluation(candidateId: string, eligible: boolean) {
  return {
    candidateId,
    eligible,
    rawScore: 0,
    normalizedScore: 0,
    constraints: [],
    supportingEvidenceIds: [],
  };
}

const common = {
  goal: request.goal,
  evaluations: [
    evaluation("alpha", true),
    evaluation("beta", true),
    evaluation("gamma", false),
  ],
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
// @ts-expect-error singleton FRONTIER is not a canonical current producer state.
const singletonFrontier: StructuredDecision = { ...common, outcome: "FRONTIER", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] };
// @ts-expect-error NO_ELIGIBLE_CANDIDATE cannot carry an active frontier.
const noEligibleWithFrontier: StructuredDecision = { ...common, outcome: "NO_ELIGIBLE_CANDIDATE", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] };
// @ts-expect-error INSUFFICIENT_EVIDENCE requires a non-empty frontier.
const insufficientWithEmptyFrontier: StructuredDecision = { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: ["gamma:eligible"] };
// @ts-expect-error INSUFFICIENT_EVIDENCE requires at least one material unknown.
const insufficientWithoutUnknowns: StructuredDecision = { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: ["gamma"], tiedCandidateIds: [], materialUnknowns: [] };

const currentDecisions: StructuredDecision[] = [
  { ...common, outcome: "RECOMMENDATION", winnerCandidateId: "alpha", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
  { ...common, outcome: "FRONTIER", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: [], materialUnknowns: [] },
  { ...common, outcome: "FRONTIER", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: [] },
  { ...common, outcome: "TIE", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: ["alpha", "beta"], materialUnknowns: [] },
  { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: ["alpha", "gamma"], tiedCandidateIds: [], materialUnknowns: ["gamma:eligible"] },
  { ...common, outcome: "UNRESOLVED", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: ["alpha:quality"] },
  { ...common, outcome: "NO_ELIGIBLE_CANDIDATE", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: [] },
];

const recommendationMismatch: StructuredDecision = {
  ...common,
  outcome: "RECOMMENDATION",
  winnerCandidateId: "alpha",
  frontierCandidateIds: ["beta"],
  tiedCandidateIds: [],
  materialUnknowns: [],
};

function decidingRun(id: string, decision: StructuredDecision | null = null): LatticeRun {
  return {
    id,
    conversationId: `issue-133-${id}`,
    status: "DECIDING",
    version: 6,
    request,
    decision,
    explanation: null,
    truthAssessmentIds: decision?.truthAssessmentIds ?? [],
    events: [{ sequence: 1, type: "CREATED" }],
  };
}

test("every valid current StructuredDecision outcome round-trips through the persistence parser", () => {
  for (const decision of currentDecisions) {
    assert.deepEqual(parseStructuredDecision(JSON.parse(JSON.stringify(decision))), decision);
  }
});

test("current TIE membership is set-based and canonicalizes tied order to frontier order", () => {
  const reordered = {
    ...common,
    outcome: "TIE",
    frontierCandidateIds: ["alpha", "beta"],
    tiedCandidateIds: ["beta", "alpha"],
    materialUnknowns: [],
  };
  const current = validateCurrentStructuredDecision(reordered);
  const persisted = parseStructuredDecision(reordered);
  assert.equal(current.outcome, "TIE");
  assert.equal(persisted.outcome, "TIE");
  assert.deepEqual(current.frontierCandidateIds, ["alpha", "beta"]);
  assert.deepEqual(current.tiedCandidateIds, ["alpha", "beta"]);
  assert.deepEqual(persisted.tiedCandidateIds, ["alpha", "beta"]);
});

test("current relational contradictions fail closed while an empty cyclic FRONTIER shape remains valid", () => {
  const invalid = [
    recommendationMismatch,
    { ...common, outcome: "TIE", frontierCandidateIds: ["alpha", "alpha"], tiedCandidateIds: ["alpha", "alpha"], materialUnknowns: [] },
    { ...common, outcome: "TIE", frontierCandidateIds: ["alpha", "beta"], tiedCandidateIds: ["alpha", "gamma"], materialUnknowns: [] },
    { ...common, outcome: "FRONTIER", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
    { ...common, outcome: "FRONTIER", frontierCandidateIds: ["alpha", "alpha"], tiedCandidateIds: [], materialUnknowns: [] },
    { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: [], tiedCandidateIds: [], materialUnknowns: ["gamma:eligible"] },
    { ...common, outcome: "INSUFFICIENT_EVIDENCE", frontierCandidateIds: ["alpha", "alpha"], tiedCandidateIds: [], materialUnknowns: ["alpha:quality"] },
    { ...common, outcome: "UNRESOLVED", frontierCandidateIds: ["gamma"], tiedCandidateIds: [], materialUnknowns: ["gamma:quality"] },
    { ...common, outcome: "NO_ELIGIBLE_CANDIDATE", frontierCandidateIds: ["alpha"], tiedCandidateIds: [], materialUnknowns: [] },
  ];
  for (const value of invalid) {
    assert.throws(() => validateCurrentStructuredDecision(value), /Invalid current StructuredDecision/);
  }

  assert.deepEqual(validateCurrentStructuredDecision({
    ...common,
    outcome: "FRONTIER",
    frontierCandidateIds: [],
    tiedCandidateIds: [],
    materialUnknowns: [],
  }).frontierCandidateIds, []);
});

test("active candidate identity must resolve unambiguously to outcome-appropriate evaluations", () => {
  const duplicateEvaluations = {
    ...common,
    evaluations: [evaluation("alpha", true), evaluation("alpha", true)],
    outcome: "RECOMMENDATION",
    winnerCandidateId: "alpha",
    frontierCandidateIds: ["alpha"],
    tiedCandidateIds: [],
    materialUnknowns: [],
  };
  const missingWinner = {
    ...common,
    outcome: "RECOMMENDATION",
    winnerCandidateId: "missing",
    frontierCandidateIds: ["missing"],
    tiedCandidateIds: [],
    materialUnknowns: [],
  };
  const ineligibleWinner = {
    ...common,
    outcome: "RECOMMENDATION",
    winnerCandidateId: "gamma",
    frontierCandidateIds: ["gamma"],
    tiedCandidateIds: [],
    materialUnknowns: [],
  };
  const missingFrontier = {
    ...common,
    outcome: "FRONTIER",
    frontierCandidateIds: ["alpha", "missing"],
    tiedCandidateIds: [],
    materialUnknowns: [],
  };
  const missingTie = {
    ...common,
    outcome: "TIE",
    frontierCandidateIds: ["alpha", "missing"],
    tiedCandidateIds: ["missing", "alpha"],
    materialUnknowns: [],
  };

  for (const value of [duplicateEvaluations, missingWinner, ineligibleWinner, missingFrontier, missingTie]) {
    assert.throws(() => validateCurrentStructuredDecision(value), /Invalid current StructuredDecision/);
  }

  const insufficientWithUnknownEligibility = validateCurrentStructuredDecision({
    ...common,
    outcome: "INSUFFICIENT_EVIDENCE",
    frontierCandidateIds: ["alpha", "gamma"],
    tiedCandidateIds: [],
    materialUnknowns: ["gamma:eligible"],
  });
  assert.equal(insufficientWithUnknownEligibility.outcome, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(insufficientWithUnknownEligibility.frontierCandidateIds, ["alpha", "gamma"]);
});

test("legacy winner-only compatibility upgrades only historically producible winner authority", () => {
  const validLegacy = {
    ...common,
    winnerCandidateId: "alpha",
  };
  const upgraded = parseStructuredDecision(validLegacy);
  assert.equal(upgraded.outcome, "RECOMMENDATION");
  assert.equal(upgraded.winnerCandidateId, "alpha");
  assert.deepEqual(upgraded.frontierCandidateIds, ["alpha"]);
  assert.deepEqual(upgraded.evaluations, validLegacy.evaluations);
  assert.deepEqual(upgraded.rationale, validLegacy.rationale);
  assert.deepEqual(upgraded.evidenceIds, validLegacy.evidenceIds);
  assert.deepEqual(upgraded.truthAssessmentIds, validLegacy.truthAssessmentIds);

  assert.throws(
    () => parseStructuredDecision({ ...common, winnerCandidateId: "missing" }),
    /Invalid persisted StructuredDecision/,
  );
  assert.throws(
    () => parseStructuredDecision({ ...common, winnerCandidateId: "gamma" }),
    /Invalid persisted StructuredDecision/,
  );
  assert.throws(
    () => parseStructuredDecision({ ...common }),
    /Invalid persisted StructuredDecision/,
  );
});

test("MemoryRunStore validates both create and persistDecision before current decision storage", async () => {
  const store = new MemoryRunStore();
  try {
    await assert.rejects(
      store.create(decidingRun("memory-invalid-create", recommendationMismatch)),
      /Invalid current StructuredDecision/,
    );
    assert.equal(await store.get("memory-invalid-create"), undefined);

    const run = decidingRun("memory-invalid-persist");
    await store.create(run);
    await assert.rejects(
      store.persistDecision({ runId: run.id, expectedVersion: run.version, decision: recommendationMismatch }),
      /Invalid current StructuredDecision/,
    );
    const unchanged = await store.get(run.id);
    assert.equal(unchanged?.decision, null);
    assert.equal(unchanged?.version, 6);

    const tieRun = decidingRun("memory-tie");
    await store.create(tieRun);
    const result = await store.persistDecision({
      runId: tieRun.id,
      expectedVersion: tieRun.version,
      decision: {
        ...common,
        outcome: "TIE",
        frontierCandidateIds: ["alpha", "beta"],
        tiedCandidateIds: ["beta", "alpha"],
        materialUnknowns: [],
      },
    });
    assert.deepEqual(result, { outcome: "advanced", version: 7 });
    assert.deepEqual((await store.get(tieRun.id))?.decision?.tiedCandidateIds, ["alpha", "beta"]);
  } finally {
    await store.close();
  }
});

test(
  "PostgreSQL validates current writes and preserves narrow legacy read compatibility",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const store = await PostgresRunStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const invalidCreateId = randomUUID();
    const invalidPersistId = randomUUID();
    const tieId = randomUUID();
    const legacyId = randomUUID();
    const absentLegacyWinnerId = randomUUID();
    const ineligibleLegacyWinnerId = randomUUID();
    try {
      await assert.rejects(
        store.create(decidingRun(invalidCreateId, recommendationMismatch)),
        /Invalid current StructuredDecision/,
      );
      const invalidCreateCount = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM runs WHERE id=$1",
        [invalidCreateId],
      );
      assert.equal(invalidCreateCount.rows[0]?.count, "0");

      const invalidPersistRun = decidingRun(invalidPersistId);
      await store.create(invalidPersistRun);
      await assert.rejects(
        store.persistDecision({
          runId: invalidPersistId,
          expectedVersion: invalidPersistRun.version,
          decision: recommendationMismatch,
        }),
        /Invalid current StructuredDecision/,
      );
      const unchanged = await pool.query<{ version: string | number; decision_json: unknown | null }>(
        "SELECT version,decision_json FROM runs WHERE id=$1",
        [invalidPersistId],
      );
      assert.equal(Number(unchanged.rows[0]?.version), 6);
      assert.equal(unchanged.rows[0]?.decision_json, null);

      const tieRun = decidingRun(tieId);
      await store.create(tieRun);
      assert.deepEqual(await store.persistDecision({
        runId: tieId,
        expectedVersion: tieRun.version,
        decision: {
          ...common,
          outcome: "TIE",
          frontierCandidateIds: ["alpha", "beta"],
          tiedCandidateIds: ["beta", "alpha"],
          materialUnknowns: [],
        },
      }), { outcome: "advanced", version: 7 });
      assert.deepEqual((await store.get(tieId))?.decision?.tiedCandidateIds, ["alpha", "beta"]);

      const validLegacy = { ...common, winnerCandidateId: "alpha" };
      const absentLegacyWinner = { ...common, winnerCandidateId: "missing" };
      const ineligibleLegacyWinner = { ...common, winnerCandidateId: "gamma" };
      for (const [id, value] of [
        [legacyId, validLegacy],
        [absentLegacyWinnerId, absentLegacyWinner],
        [ineligibleLegacyWinnerId, ineligibleLegacyWinner],
      ] as const) {
        await pool.query(
          "INSERT INTO runs(id,conversation_id,status,version,request_json,decision_json,explanation) VALUES ($1,$2,'COMPLETED',8,$3::jsonb,$4::jsonb,$5)",
          [id, `issue-133-${id}`, JSON.stringify(request), JSON.stringify(value), "legacy"],
        );
      }

      const loaded = await store.get(legacyId);
      assert.equal(loaded?.decision?.outcome, "RECOMMENDATION");
      assert.equal(loaded?.decision?.winnerCandidateId, "alpha");
      await assert.rejects(store.get(absentLegacyWinnerId), /Invalid persisted StructuredDecision/);
      await assert.rejects(store.get(ineligibleLegacyWinnerId), /Invalid persisted StructuredDecision/);
    } finally {
      await pool.query(
        "DELETE FROM runs WHERE id = ANY($1::uuid[])",
        [[invalidCreateId, invalidPersistId, tieId, legacyId, absentLegacyWinnerId, ineligibleLegacyWinnerId]],
      );
      await pool.end();
      await store.close();
    }
  },
);
