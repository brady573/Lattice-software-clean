import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { RunRequest } from "../src/domain.js";
import { laptopFixture } from "../src/fixtures.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import {
  createPendingRun,
  executePersistedRun,
  executePersistedRunTick,
} from "../src/run-execution.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;

const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

test(
  "PostgreSQL Run coordinator resumes from persisted intermediate ticks across store restarts",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
    const pool = new Pool({ connectionString: databaseUrl });
    let firstStore: PostgresRunStore | undefined;
    let secondStore: PostgresRunStore | undefined;
    let thirdStore: PostgresRunStore | undefined;

    try {
      firstStore = await PostgresRunStore.connect(databaseUrl);
      await firstStore.create(createPendingRun(`coordinator-restart-${runId}`, request, runId));

      for (const [status, version] of [
        ["UNDERSTANDING", 2],
        ["PLANNING", 3],
        ["INVESTIGATING", 4],
        ["VALIDATING", 5],
      ] as const) {
        const state = await executePersistedRunTick(firstStore, pipeline, runId);
        assert.equal(state.status, status);
        assert.equal(state.version, version);
      }
      const investigated = await firstStore.getTruthSnapshot(runId);
      assert.equal(investigated?.phase, "INVESTIGATED");
      await firstStore.close();
      firstStore = undefined;

      secondStore = await PostgresRunStore.connect(databaseUrl);
      const reloaded = await secondStore.get(runId);
      assert.ok(reloaded);
      assert.equal(reloaded.status, "VALIDATING");
      assert.equal(reloaded.version, 5);

      const validated = await executePersistedRunTick(secondStore, pipeline, runId);
      assert.equal(validated.status, "DECIDING");
      assert.equal(validated.version, 6);
      const validatedSnapshot = await secondStore.getTruthSnapshot(runId);
      assert.equal(validatedSnapshot?.phase, "VALIDATED");
      await secondStore.close();
      secondStore = undefined;

      thirdStore = await PostgresRunStore.connect(databaseUrl);
      const completed = await executePersistedRun(thirdStore, pipeline, runId);
      assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.version, 8);
      assert.ok(completed.decision);
      assert.ok(completed.explanation);
    } finally {
      await firstStore?.close();
      await secondStore?.close();
      await thirdStore?.close();
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
    }
  },
);
