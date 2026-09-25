import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { consultationRunRequestSchema, type LatticeRun } from "../src/domain.js";
import {
  PostgresDecisionPlanStore,
  type DecisionPlanFidelityPolicy,
  type DurableDecisionPlan,
} from "../src/intent/decision-plan-store.js";
import {
  PostgresIntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { createPendingRun } from "../src/run-execution.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

/**
 * Issue #104 (absorbed into Issue #91): PostgreSQL evidence that the new
 * bounded Run/DecisionPlan batch reads do not issue one query per identity.
 */

const databaseUrl = process.env.DATABASE_URL;
const allowExactTestPlanning: DecisionPlanFidelityPolicy = () => {};

type StatementCounts = Record<string, number>;

function initialTransition(intentScopeId: string, objective: string): IntentTransitionCommand {
  return {
    transitionId: randomUUID(),
    intentScopeId,
    baseIntentVersionId: null,
    logicalUserTurnId: `turn-${randomUUID()}`,
    observedMessageHorizon: 1,
    sourceMessageId: `message-${randomUUID()}`,
    sourceDigest: `digest-${randomUUID()}`,
    operations: [{ op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: objective } }],
  };
}

function consultationRun(
  conversationId: string,
  runId: `${string}-${string}-${string}-${string}-${string}`,
  version: number,
): LatticeRun {
  const created = createPendingRun(
    conversationId,
    consultationRunRequestSchema.parse({
      kind: "consultation",
      objective: `Objective ${version}`,
      context: [],
      decisionNeed: "NONE",
      resourceNeed: "NONE",
      sourceMessageId: `message-${version}-${runId}`,
      sourceMessageDigest: runId.replace(/[^a-f0-9]/gu, "0").slice(0, 32).padEnd(64, "0"),
      intentScopeId: `scope-${conversationId}`,
      intentVersion: version,
    }),
    runId,
  );
  return { ...created, status: "COMPLETED", version, events: [{ sequence: 1, type: "CREATED" }] };
}

async function countStoreQueries<T>(
  run: () => Promise<T>,
): Promise<{ result: T; counts: StatementCounts }> {
  const counts: StatementCounts = {};
  const original = Pool.prototype.query;
  // eslint-disable-next-line no-explicit-any
  Pool.prototype.query = function patched(this: any, text: any, ...rest: any[]) {
    const statement = typeof text === "string" ? text : text?.text;
    if (typeof statement === "string") {
      for (const table of ["runs", "run_events", "truth_assessments", "decision_plans"]) {
        if (statement.includes(`FROM ${table}`)) counts[table] = (counts[table] ?? 0) + 1;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return original.apply(this, [text, ...rest] as never) as never;
  };
  try {
    return { result: await run(), counts };
  } finally {
    Pool.prototype.query = original;
  }
}

test("Issue #104 PostgreSQL: bounded Run batch reads return the same Runs with constant query count", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const conversationId = `conversation-${randomUUID()}`;
  const otherConversationId = `conversation-${randomUUID()}`;
  const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const pool = new Pool({ connectionString: databaseUrl });
  const runIds: string[] = [];
  try {
    for (let index = 1; index <= 8; index += 1) {
      // runs.id is a uuid column, so the fixture identities are real uuids.
      const runId = randomUUID();
      runIds.push(runId);
      await runStore.create(consultationRun(conversationId, runId, index));
    }
    const foreignRunId = randomUUID();
    await runStore.create(consultationRun(otherConversationId, foreignRunId, 1));
    const requested = [...runIds, randomUUID(), foreignRunId];

    const batched = await countStoreQueries(() => runStore.getManyByIds(requested));
    assert.equal(batched.counts.runs, 1, "one Run query for every requested identity");
    assert.equal(batched.counts.run_events, 1, "one Run-event query for every requested identity");
    assert.equal(batched.counts.truth_assessments, 1, "one truth-assessment query for every requested identity");
    assert.deepEqual([...batched.result.keys()], runIds.concat(foreignRunId));

    for (const runId of runIds) {
      assert.deepEqual(batched.result.get(runId), await runStore.get(runId), `batched Run differs from per-identity read: ${runId}`);
    }

    // A malformed identity stays absent exactly like the single-record read and
    // must not discard the exact identities that are present.
    const withMalformed = await countStoreQueries(() => runStore.getManyByIds([
      ...requested,
      "not-a-uuid",
      "11111111-1111-1111-1111-11111111111x",
    ]));
    assert.deepEqual([...withMalformed.result.keys()], runIds.concat(foreignRunId));
    assert.deepEqual(withMalformed.counts, batched.counts, "malformed identities are filtered before binding");
    assert.equal(await runStore.getManyByIds(["not-a-uuid"]).then((result) => result.size), 0);
    const emptyBatch = await runStore.getManyByIds([]);
    assert.equal(emptyBatch.size, 0, "an empty batch never queries");

    // Query count is independent of identity count: 4 identities cost the same
    // three bounded reads as 10.
    const four = requested.slice(0, 4);
    const wider = await countStoreQueries(() => runStore.getManyByIds(four));
    assert.deepEqual(wider.counts, batched.counts);
    assert.deepEqual([...wider.result.keys()], runIds.slice(0, 4));

    const perIdentityCost = requested.length * 3;
    const batchedCost = (batched.counts.runs ?? 0) + (batched.counts.run_events ?? 0) + (batched.counts.truth_assessments ?? 0);
    assert.ok(
      batchedCost < perIdentityCost,
      `batched reads (${batchedCost}) must be cheaper than per-identity reads (${perIdentityCost})`,
    );
  } finally {
    await runStore.close();
    await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]).catch(() => undefined);
    await pool.query("DELETE FROM conversations WHERE id=$1", [otherConversationId]).catch(() => undefined);
    await pool.end();
  }
});

test("Issue #104 PostgreSQL: bounded DecisionPlan batch read returns the same bindings in one query", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const conversationId = `conversation-${randomUUID()}`;
  const intentScopeId = `scope-${randomUUID()}`;
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const planStore = await PostgresDecisionPlanStore.connect(databaseUrl, {
    migrate: false,
    fidelityPolicy: allowExactTestPlanning,
  });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const scope = await intentStore.createScope({
      intentScopeId,
      initialTransition: initialTransition(intentScopeId, "Establish the exact binding"),
    });
    const runIds: string[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const runId = `plan-run-${index}-${randomUUID()}`;
      runIds.push(runId);
      const plan: Omit<DurableDecisionPlan<never>, "boundAt"> = {
        decisionPlanId: `decision-plan-${runId}`,
        runId,
        intentScopeId,
        intentVersionId: scope.currentIntentVersionId,
        planningMaterial: {
          goal: "Establish the exact binding",
          hardConstraints: [],
          priorities: [{ criterion: "clarity", weight: 1 }],
        },
      } as unknown as Omit<DurableDecisionPlan<never>, "boundAt">;
      await planStore.bind(plan);
    }

    const requested = [...runIds, `plan-run-absent-${randomUUID()}`];
    const batched = await countStoreQueries(() => planStore.getManyByRunIds(requested));
    assert.equal(batched.counts.decision_plans, 1, "one DecisionPlan query for every requested binding");
    assert.deepEqual([...batched.result.keys()], runIds);
    for (const runId of runIds) {
      assert.deepEqual(batched.result.get(runId), await planStore.getByRunId(runId));
    }
    const narrower = await countStoreQueries(() => planStore.getManyByRunIds(runIds.slice(0, 2)));
    assert.deepEqual(narrower.counts, batched.counts, "query count is independent of binding count");
  } finally {
    await planStore.close();
    await intentStore.close();
    await pool.query("DELETE FROM decision_plans WHERE intent_scope_id=$1", [intentScopeId]).catch(() => undefined);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]).catch(() => undefined);
    await pool.end();
  }
});
