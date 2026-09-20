import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ConsultationRunRequest, LatticeRun } from "../src/domain.js";
import type { KnowledgeAcquisitionProvider } from "../src/knowledge/acquisition.js";
import { buildKnowledgeOutcome } from "../src/outcome.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;

function request(): ConsultationRunRequest {
  return {
    kind: "consultation",
    objective: "Explain a held-out external topic.",
    context: [],
    investigationQueries: ["external topic reference"],
    advisoryRequested: false,
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "knowledge-failure-postgres-message",
    sourceMessageDigest: "d".repeat(64),
    intentVersion: 1,
    intentScopeId: "knowledge-failure-postgres-scope",
    intentVersionId: "knowledge-failure-postgres-intent",
  };
}

function investigatingRun(runId: string, consultation: ConsultationRunRequest): LatticeRun {
  return {
    id: runId,
    conversationId: `knowledge-failure-postgres-${runId}`,
    status: "INVESTIGATING",
    version: 4,
    request: consultation,
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

const unavailableSource: KnowledgeAcquisitionProvider = {
  kind: "knowledge-failure-postgres-source",
  async acquire() {
    return {
      sources: [],
      claims: [],
      completion: { status: "FAILED", reason: "PROVIDER_FAILURE" },
    };
  },
};

test(
  "PostgreSQL restart preserves Knowledge source-unavailable state through the existing TruthBundle schema",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const consultation = request();
    const pipeline = new KnowledgeAcquisitionTruthPipeline(unavailableSource);

    let first = await PostgresRunStore.connect(databaseUrl);
    try {
      await first.create(investigatingRun(runId, consultation));
      const investigated = await pipeline.investigate(runId, consultation);
      assert.equal(
        investigated.snapshot.bundle.claims[0]?.qualifiers.find((item) =>
          item.key === "acquisition-state")?.value,
        "SOURCE_UNAVAILABLE",
      );
      assert.deepEqual(await first.transition({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        nextStatus: "VALIDATING",
        truthSnapshot: investigated.snapshot,
      }), { outcome: "advanced", version: 5 });
    } finally {
      await first.close();
    }

    const second = await PostgresRunStore.connect(databaseUrl);
    try {
      const restoredInvestigation = await second.getTruthSnapshot(runId);
      assert.ok(restoredInvestigation);
      assert.equal(
        restoredInvestigation.bundle.claims[0]?.qualifiers.find((item) =>
          item.key === "acquisition-state")?.value,
        "SOURCE_UNAVAILABLE",
      );

      const validated = await pipeline.validate(restoredInvestigation);
      assert.deepEqual(await second.transition({
        runId,
        expectedStatus: "VALIDATING",
        expectedVersion: 5,
        nextStatus: "COMPLETED",
        truthSnapshot: validated.snapshot,
      }), { outcome: "advanced", version: 6 });
    } finally {
      await second.close();
    }

    const third = await PostgresRunStore.connect(databaseUrl);
    try {
      const restoredRun = await third.get(runId);
      const restoredTruth = await third.getTruthBundle(runId);
      assert.ok(restoredRun);
      assert.ok(restoredTruth);
      const knowledge = buildKnowledgeOutcome(restoredRun, restoredTruth);
      assert.equal(knowledge.availability, "SOURCE_UNAVAILABLE");
      assert.deepEqual(knowledge.findings, []);
    } finally {
      await third.close();
    }
  },
);
