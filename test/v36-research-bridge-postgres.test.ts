import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import { laptopFixture } from "./fixtures/legacy-laptop-fixture.js";
import { PostgresOrchestrationStore } from "../src/postgres-orchestration-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { processResearchDispatches } from "../src/research-worker.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";
import {
  createV36NeedsResearch,
  type V36NeedsResearch,
  type V36ResearchRequest,
} from "../src/truth/continuation.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";
import { PostgresV36ResearchBridge } from "../src/v36-research-bridge.js";

const databaseUrl = process.env.DATABASE_URL;
const request: RunRequest = {
  goal: "Exercise durable V36 continuation handoff.",
  hardConstraints: [],
  priorities: [],
};

function investigatingRun(id: string): LatticeRun {
  return {
    id,
    conversationId: `v36-bridge-${id}`,
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

async function yieldedFor(runId: string, dependent = true): Promise<V36NeedsResearch> {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const investigation = await pipeline.investigate(runId);
  const claimId = investigation.snapshot.bundle.claims[0]?.id;
  assert.ok(claimId);
  const requests: V36ResearchRequest[] = [{
    id: `${runId}-primary`,
    runId,
    claimId,
    parentRequestId: null,
    purpose: "PRIMARY_SOURCE",
    query: "Locate the primary source.",
    serialRound: 1,
  }];
  if (dependent) {
    requests.push({
      id: `${runId}-disconfirm`,
      runId,
      claimId,
      parentRequestId: requests[0]!.id,
      purpose: "DISCONFIRM",
      query: "Seek disconfirming evidence.",
      serialRound: 2,
    });
  }
  return createV36NeedsResearch(investigation.snapshot, requests, 1);
}

test(
  "PostgreSQL V36 bridge preserves checkpoint and rebuilds durable research handoff across restart",
  { skip: !databaseUrl, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    let bridge: PostgresV36ResearchBridge | undefined;
    let orchestration: PostgresOrchestrationStore | undefined;
    try {
      await runStore.create(investigatingRun(runId));
      const yielded = await yieldedFor(runId);
      bridge = await PostgresV36ResearchBridge.connect(databaseUrl, { migrate: false });
      const scheduled = await bridge.schedule({
        yielded,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
      });
      assert.equal(scheduled.outcome, "scheduled");
      if (scheduled.outcome !== "scheduled") return;
      assert.equal(scheduled.tasks.length, 2);

      const persisted = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM v36_research_continuations WHERE run_id=$1",
        [runId],
      );
      assert.equal(persisted.rows[0]?.count, "1");

      // Simulate interruption after the immutable continuation is durable but
      // before its task materialization can be relied upon after restart.
      await pool.query("DELETE FROM run_tasks WHERE run_id=$1", [runId]);
      await bridge.close();
      bridge = undefined;

      bridge = await PostgresV36ResearchBridge.connect(databaseUrl, { migrate: false });
      const recovered = await bridge.load(runId, yielded.checkpoint.checkpointHash);
      assert.equal(recovered.outcome, "pending");
      if (recovered.outcome !== "pending") return;
      assert.deepEqual(recovered.checkpoint, yielded.checkpoint);

      const recoveredTasks = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM run_tasks WHERE run_id=$1",
        [runId],
      );
      assert.equal(recoveredTasks.rows[0]?.count, "2");

      orchestration = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
      const executor = {
        execute: async () => ({ artifacts: [], edges: [], evidence: [] }),
      };
      await processResearchDispatches({
        orchestrationStore: orchestration,
        executor,
        workerId: `m4-a1-worker:${randomUUID()}`,
        now: new Date(),
        limit: 10,
      });
      await processResearchDispatches({
        orchestrationStore: orchestration,
        executor,
        workerId: `m4-a1-worker:${randomUUID()}`,
        now: new Date(),
        limit: 10,
      });

      const ready = await bridge.load(runId, yielded.checkpoint.checkpointHash);
      assert.equal(ready.outcome, "ready");
      if (ready.outcome !== "ready") return;
      assert.deepEqual(ready.checkpoint, yielded.checkpoint);
      assert.equal(ready.results.length, 2);
      assert.deepEqual(ready.results.map((result) => result.outcome), ["SUCCEEDED", "SUCCEEDED"]);
      assert.deepEqual(ready.results.map((result) => result.requestId), yielded.researchRequests.map((item) => item.id));
    } finally {
      if (orchestration) await orchestration.close();
      if (bridge) await bridge.close();
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await runStore.close();
    }
  },
);

test(
  "PostgreSQL V36 bridge returns durable execution exhaustion as operational failure only",
  { skip: !databaseUrl, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    let bridge: PostgresV36ResearchBridge | undefined;
    let orchestration: PostgresOrchestrationStore | undefined;
    try {
      await runStore.create(investigatingRun(runId));
      const yielded = await yieldedFor(runId, false);
      bridge = await PostgresV36ResearchBridge.connect(databaseUrl, { migrate: false });
      const scheduled = await bridge.schedule({
        yielded,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
      });
      assert.equal(scheduled.outcome, "scheduled");

      orchestration = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
      await processResearchDispatches({
        orchestrationStore: orchestration,
        executor: { execute: async () => { throw new Error("provider unavailable"); } },
        workerId: `m4-a1-failure:${randomUUID()}`,
        now: new Date(),
        limit: 10,
      });

      const ready = await bridge.load(runId, yielded.checkpoint.checkpointHash);
      assert.equal(ready.outcome, "ready");
      if (ready.outcome !== "ready") return;
      assert.equal(ready.results.length, 1);
      assert.equal(ready.results[0]?.outcome, "OPERATIONAL_FAILURE");
      if (ready.results[0]?.outcome !== "OPERATIONAL_FAILURE") return;
      assert.equal(ready.results[0].operationalFailure.code, "RESEARCH_TASK_EXHAUSTED");
      assert.equal(ready.results[0].operationalFailure.retryable, false);
      assert.equal(ready.results[0].result, null);
    } finally {
      if (orchestration) await orchestration.close();
      if (bridge) await bridge.close();
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await runStore.close();
    }
  },
);
