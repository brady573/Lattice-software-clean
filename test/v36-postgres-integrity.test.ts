import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import { laptopFixture } from "../src/fixtures.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { createTruthSnapshot } from "../src/truth/snapshot.js";

const databaseUrl = process.env.DATABASE_URL;
const executionContractId = "v36-test-contract";

const request: RunRequest = {
  goal: "Exercise V36 transactional truth persistence.",
  hardConstraints: [{ criterion: "price", operator: "lte", value: 1300 }],
  priorities: [{ criterion: "performance", weight: 1 }],
};

function investigatingRun(runId: string): LatticeRun {
  return {
    id: runId,
    conversationId: `v36-rollback-${runId}`,
    status: "INVESTIGATING",
    version: 4,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [
      { sequence: 1, type: "CREATED" },
      { sequence: 2, type: "UNDERSTANDING" },
      { sequence: 3, type: "PLANNING" },
      { sequence: 4, type: "INVESTIGATING" },
    ],
  };
}

function validatingRun(runId: string): LatticeRun {
  return {
    ...investigatingRun(runId),
    status: "VALIDATING",
    version: 5,
    events: [...investigatingRun(runId).events, { sequence: 5, type: "VALIDATING" }],
  };
}

test(
  "failed V36 validated-snapshot replacement rolls back to the prior durable investigation snapshot",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const store = await PostgresRunStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await store.create(investigatingRun(runId));
      const validBundle = evaluateFixtureTruth(runId, laptopFixture).bundle;
      const investigation = createTruthSnapshot("INVESTIGATED", executionContractId, validBundle);
      const advanced = await store.transition({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        nextStatus: "VALIDATING",
        truthSnapshot: investigation,
      });
      assert.deepEqual(advanced, { outcome: "advanced", version: 5 });

      const firstSource = validBundle.sources[0];
      assert.ok(firstSource);
      const invalidBundle = structuredClone(validBundle);
      // V36 structural integrity remains Run-scoped, but duplicate source PKs
      // force a database failure after replacement has begun inside the transaction.
      invalidBundle.sources.push(structuredClone(firstSource));
      const invalidValidated = createTruthSnapshot("VALIDATED", executionContractId, invalidBundle);

      await assert.rejects(
        store.transition({
          runId,
          expectedStatus: "VALIDATING",
          expectedVersion: 5,
          nextStatus: "DECIDING",
          truthSnapshot: invalidValidated,
        }),
        /duplicate key|unique/i,
      );

      const persistedRun = await store.get(runId);
      assert.ok(persistedRun);
      assert.equal(persistedRun.status, "VALIDATING");
      assert.equal(persistedRun.version, 5);
      assert.equal(persistedRun.truthAssessmentIds.length, validBundle.assessments.length);

      const reloaded = await store.getTruthSnapshot(runId);
      assert.ok(reloaded);
      assert.equal(reloaded.phase, "INVESTIGATED");
      assert.equal(reloaded.executionContractId, executionContractId);
      assert.equal(reloaded.bundleHash, investigation.bundleHash);

      const counts = await pool.query<{
        components: string;
        sources: string;
        claims: string;
        evidence: string;
        obligations: string;
        checks: string;
        assessments: string;
        snapshots: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM truth_provenance_components WHERE run_id = $1) AS components,
          (SELECT count(*)::text FROM truth_source_artifacts WHERE run_id = $1) AS sources,
          (SELECT count(*)::text FROM truth_claims WHERE run_id = $1) AS claims,
          (SELECT count(*)::text FROM truth_claim_evidence WHERE run_id = $1) AS evidence,
          (SELECT count(*)::text FROM truth_proof_obligations WHERE run_id = $1) AS obligations,
          (SELECT count(*)::text FROM truth_proof_checks WHERE run_id = $1) AS checks,
          (SELECT count(*)::text FROM truth_assessments WHERE run_id = $1) AS assessments,
          (SELECT count(*)::text FROM truth_snapshot_state WHERE run_id = $1) AS snapshots`,
        [runId],
      );
      assert.deepEqual(counts.rows[0], {
        components: String(validBundle.provenanceComponents.length),
        sources: String(validBundle.sources.length),
        claims: String(validBundle.claims.length),
        evidence: String(validBundle.claimEvidence.length),
        obligations: String(validBundle.obligations.length),
        checks: String(validBundle.checks.length),
        assessments: String(validBundle.assessments.length),
        snapshots: "1",
      });
    } finally {
      await pool.query("DELETE FROM runs WHERE id = $1", [runId]);
      await pool.end();
      await store.close();
    }
  },
);

test(
  "V36 snapshot metadata and material claim qualifiers survive PostgreSQL round-trip",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const store = await PostgresRunStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await store.create(validatingRun(runId));
      const bundle = evaluateFixtureTruth(runId, laptopFixture).bundle;
      const firstClaim = bundle.claims[0];
      assert.ok(firstClaim);
      firstClaim.jurisdiction = "US-CO";
      firstClaim.quotedContext = "The full quoted context remains material to the truth condition.";
      firstClaim.qualifiers = [
        { key: "currency", value: "USD" },
        { key: "comparison-window", value: "prototype-static" },
      ];
      const snapshot = createTruthSnapshot("VALIDATED", executionContractId, bundle);

      const advanced = await store.transition({
        runId,
        expectedStatus: "VALIDATING",
        expectedVersion: 5,
        nextStatus: "DECIDING",
        truthSnapshot: snapshot,
      });
      assert.deepEqual(advanced, { outcome: "advanced", version: 6 });

      const reloadedSnapshot = await store.getTruthSnapshot(runId);
      assert.ok(reloadedSnapshot);
      assert.equal(reloadedSnapshot.phase, "VALIDATED");
      assert.equal(reloadedSnapshot.executionContractId, executionContractId);
      assert.equal(reloadedSnapshot.bundleHash, snapshot.bundleHash);
      const persistedClaim = reloadedSnapshot.bundle.claims.find((claim) => claim.id === firstClaim.id);
      assert.ok(persistedClaim);
      assert.equal(persistedClaim.jurisdiction, "US-CO");
      assert.equal(
        persistedClaim.quotedContext,
        "The full quoted context remains material to the truth condition.",
      );
      assert.deepEqual(persistedClaim.qualifiers, [
        { key: "currency", value: "USD" },
        { key: "comparison-window", value: "prototype-static" },
      ]);

      const row = await pool.query<{
        phase: string;
        execution_contract_id: string;
        bundle_hash: string;
        jurisdiction_text: string | null;
        quoted_context_text: string | null;
        qualifiers_json: Array<{ key: string; value: string }>;
      }>(
        `SELECT s.phase, s.execution_contract_id, s.bundle_hash,
                c.jurisdiction_text, c.quoted_context_text, c.qualifiers_json
         FROM truth_snapshot_state s
         JOIN truth_claims c ON c.run_id = s.run_id
         WHERE s.run_id = $1 AND c.id = $2`,
        [runId, firstClaim.id],
      );
      assert.deepEqual(row.rows[0], {
        phase: "VALIDATED",
        execution_contract_id: executionContractId,
        bundle_hash: snapshot.bundleHash,
        jurisdiction_text: "US-CO",
        quoted_context_text: "The full quoted context remains material to the truth condition.",
        qualifiers_json: [
          { key: "currency", value: "USD" },
          { key: "comparison-window", value: "prototype-static" },
        ],
      });
    } finally {
      await pool.query("DELETE FROM runs WHERE id = $1", [runId]);
      await pool.end();
      await store.close();
    }
  },
);
