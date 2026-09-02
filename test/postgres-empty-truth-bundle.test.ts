import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ConsultationRunRequest, LatticeRun } from "../src/domain.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";
import type { FixtureDataset } from "../src/fixtures.js";

const databaseUrl = process.env.DATABASE_URL;

const emptyDataset: FixtureDataset = {
  candidates: [],
  evidence: [],
  truthClaims: [],
  truthEvidence: [],
};

function consultationRequest(): ConsultationRunRequest {
  return {
    kind: "consultation",
    objective: "Explain the available knowledge without forcing a decision.",
    context: [],
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "postgres-empty-bundle-message",
    sourceMessageDigest: "a".repeat(64),
    intentVersion: 1,
  };
}

function investigatingRun(runId: string): LatticeRun {
  return {
    id: runId,
    conversationId: `postgres-empty-bundle-${runId}`,
    status: "INVESTIGATING",
    version: 4,
    request: consultationRequest(),
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

test(
  "PostgreSQL preserves an intentionally empty V36 bundle through validated consultation completion",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const request = consultationRequest();
    const pipeline = new OfflineFixtureTruthPipeline(emptyDataset);
    const store = await PostgresRunStore.connect(databaseUrl);

    try {
      await store.create({ ...investigatingRun(runId), request });

      const investigated = await pipeline.investigate(runId);
      assert.deepEqual(investigated.snapshot.bundle.claims, []);
      assert.deepEqual(investigated.snapshot.bundle.assessments, []);

      const validating = await store.transition({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        nextStatus: "VALIDATING",
        truthSnapshot: investigated.snapshot,
      });
      assert.deepEqual(validating, { outcome: "advanced", version: 5 });

      const reloadedInvestigation = await store.getTruthSnapshot(runId);
      assert.ok(reloadedInvestigation);
      assert.equal(reloadedInvestigation.phase, "INVESTIGATED");
      assert.deepEqual(reloadedInvestigation.bundle.claims, []);
      assert.deepEqual(reloadedInvestigation.bundle.assessments, []);

      const validated = await pipeline.validate(reloadedInvestigation);
      const completed = await store.transition({
        runId,
        expectedStatus: "VALIDATING",
        expectedVersion: 5,
        nextStatus: "COMPLETED",
        truthSnapshot: validated.snapshot,
      });
      assert.deepEqual(completed, { outcome: "advanced", version: 6 });

      const reloadedValidated = await store.getTruthSnapshot(runId);
      assert.ok(reloadedValidated);
      assert.equal(reloadedValidated.phase, "VALIDATED");
      assert.deepEqual(reloadedValidated.bundle.claims, []);
      assert.deepEqual(reloadedValidated.bundle.assessments, []);

      const directBundle = await store.getTruthBundle(runId);
      assert.deepEqual(directBundle, validated.bundle);
    } finally {
      await store.close();
    }
  },
);
