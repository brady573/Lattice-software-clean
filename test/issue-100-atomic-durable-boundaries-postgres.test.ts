import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  MemoryApiRunControlStore,
  createApiRequestHash,
  type ApiIdempotencyInput,
  type ApiRunSubmissionInput,
} from "../src/api-control-store.js";
import { ConversationRunIndexRecordingApiRunControlStore } from "../src/conversation/run-index-control.js";
import {
  MemoryConversationRunIndexStore,
  PostgresConversationRunIndexStore,
  type ConversationRunIndexStore,
} from "../src/conversation/run-index-store.js";
import {
  MemoryConversationReferenceStore,
  appendConversationReference,
  type ConversationReferenceAuthority,
  type ConversationReferenceRecord,
  type ConversationReferenceStore,
} from "../src/conversation/conversation-reference-store.js";
import type { ConsultationRunRequest, LatticeRun } from "../src/domain.js";
import {
  MemoryAcceptedChoiceStore,
  buildAcceptedChoiceRecord,
} from "../src/intent/accepted-choice-store.js";
import {
  PostgresIntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import type { DecisionPlanFidelityPolicy } from "../src/intent/decision-plan-store.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { createPendingRun } from "../src/run-execution.js";
import { MemoryRunStore } from "../src/run-store.js";
import {
  connectPostgresRuntimeStores,
  migrateRuntimeDatabase,
} from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
const allowExactTestPlanning: DecisionPlanFidelityPolicy = () => {};
const injectedTriggerFunction = "issue100_injected_insert_failure";

function initialTransition(intentScopeId: string, objective: string): IntentTransitionCommand {
  return {
    transitionId: randomUUID(),
    intentScopeId,
    baseIntentVersionId: null,
    logicalUserTurnId: `turn-${randomUUID()}`,
    observedMessageHorizon: 1,
    sourceMessageId: `message-${randomUUID()}`,
    sourceDigest: `digest-${randomUUID()}`,
    operations: [{
      op: "SET",
      path: { kind: "OBJECTIVE" },
      value: { state: "VALUE", value: objective },
    }],
  };
}

function qualifiedRequest(
  intentScopeId: string,
  intentVersionId: string,
  objective = "Choose the most reliable bounded option",
): ConsultationRunRequest {
  return {
    kind: "consultation",
    objective,
    context: [],
    investigationQueries: [],
    advisoryRequested: false,
    decisionNeed: "QUALIFIED",
    resourceNeed: "NONE",
    sourceMessageId: `message-${randomUUID()}`,
    sourceMessageDigest: "a".repeat(64),
    intentVersion: 1,
    intentScopeId,
    intentVersionId,
    decisionInput: {
      schemaVersion: 1,
      intentScopeId,
      intentVersionId,
      criterionCatalogVersion: 1,
      objective,
      hardRequirements: [],
      priorities: [],
      tolerances: [],
      criterionBindings: [],
    },
  };
}

function idempotency(
  run: LatticeRun,
  identity = randomUUID(),
  expiresAt = new Date(Date.now() + 60_000),
): ApiIdempotencyInput {
  return {
    scopeKey: `issue-100:${identity}`,
    httpMethod: "POST",
    canonicalRoute: `/issue-100/${identity}/runs`,
    idempotencyKey: `idem-${identity}`,
    requestHash: createApiRequestHash(run.request),
    expiresAt,
  };
}

function submission(
  run: LatticeRun,
  intentScopeId: string,
  intentVersionId: string,
  idem?: ApiIdempotencyInput,
): ApiRunSubmissionInput {
  return {
    run,
    intentBinding: { intentScopeId, intentVersionId },
    dispatch: {
      logicalKey: `run:${run.id}:execute`,
      queueName: "lattice.run",
      payload: { runId: run.id, submittedVersion: run.version },
    },
    ...(idem ? { idempotency: idem } : {}),
  };
}

async function createExactIntent(
  store: PostgresIntentAuthorityStore,
  intentScopeId: string,
  objective: string,
): Promise<string> {
  const scope = await store.createScope({
    intentScopeId,
    initialTransition: initialTransition(intentScopeId, objective),
  });
  return scope.currentIntentVersionId;
}

async function installFailureTrigger(pool: Pool, table: string, trigger: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
  await pool.query(
    `CREATE TRIGGER ${trigger}
     BEFORE INSERT ON ${table}
     FOR EACH ROW EXECUTE FUNCTION ${injectedTriggerFunction}()`,
  );
}

async function removeFailureTrigger(pool: Pool, table: string, trigger: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
}

async function installFailureFunction(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE OR REPLACE FUNCTION ${injectedTriggerFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'issue100 injected insert failure';
     END;
     $$`,
  );
}

async function removeFailureFunction(pool: Pool): Promise<void> {
  await pool.query(`DROP FUNCTION IF EXISTS ${injectedTriggerFunction}()`);
}

async function durableCounts(pool: Pool, runId: string, idem?: ApiIdempotencyInput): Promise<{
  runs: number;
  bindings: number;
  plans: number;
  idempotency: number;
  dispatches: number;
}> {
  const result = await pool.query<{
    runs: string;
    bindings: string;
    plans: string;
    idempotency: string;
    dispatches: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM runs WHERE id=$1) AS runs,
       (SELECT count(*)::text FROM run_intent_bindings WHERE run_id=$1) AS bindings,
       (SELECT count(*)::text FROM decision_plans WHERE run_id=$1) AS plans,
       (SELECT count(*)::text FROM api_idempotency_keys
          WHERE run_id=$1
            AND ($2::text IS NULL OR scope_key=$2)
            AND ($3::text IS NULL OR idempotency_key=$3)) AS idempotency,
       (SELECT count(*)::text FROM dispatch_outbox WHERE run_id=$1) AS dispatches`,
    [runId, idem?.scopeKey ?? null, idem?.idempotencyKey ?? null],
  );
  const row = result.rows[0]!;
  return {
    runs: Number(row.runs),
    bindings: Number(row.bindings),
    plans: Number(row.plans),
    idempotency: Number(row.idempotency),
    dispatches: Number(row.dispatches),
  };
}

async function cleanupConversation(pool: Pool, conversationId: string, intentScopeId?: string): Promise<void> {
  await pool.query(
    "DELETE FROM decision_plans WHERE run_id IN (SELECT id::text FROM runs WHERE conversation_id=$1)",
    [conversationId],
  );
  await pool.query("DELETE FROM runs WHERE conversation_id=$1", [conversationId]);
  if (intentScopeId) await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]);
}

class FailOnceRunIndexStore implements ConversationRunIndexStore {
  readonly kind = "memory" as const;
  private failNext = true;

  constructor(private readonly base: MemoryConversationRunIndexStore) {}

  async record(run: LatticeRun): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("issue100 injected Run-index projection failure");
    }
    await this.base.record(run);
  }

  async listRunIds(conversationId: string): Promise<string[]> {
    return this.base.listRunIds(conversationId);
  }

  async close(): Promise<void> {
    await this.base.close();
  }
}

class FailOnceConversationReferenceStore implements ConversationReferenceStore {
  readonly kind = "memory" as const;
  private failNext = true;

  constructor(private readonly base: MemoryConversationReferenceStore) {}

  async putReference(reference: ConversationReferenceRecord): Promise<ConversationReferenceRecord> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("issue100 injected ConversationReference failure");
    }
    return this.base.putReference(reference);
  }

  async getReference(referenceId: string): Promise<ConversationReferenceRecord | undefined> {
    return this.base.getReference(referenceId);
  }

  async listByConversation(conversationId: string): Promise<ConversationReferenceRecord[]> {
    return this.base.listByConversation(conversationId);
  }

  async latestReference(conversationId: string): Promise<ConversationReferenceRecord | undefined> {
    return this.base.latestReference(conversationId);
  }

  async close(): Promise<void> {
    await this.base.close();
  }
}

test("Issue #100: qualified PostgreSQL Run acceptance rolls back at every invariant/dispatch insertion boundary", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const control = await PostgresApiRunControlStore.connect(databaseUrl, {
    migrate: false,
    decisionPlanFidelityPolicy: allowExactTestPlanning,
  });
  const intentScopeId = `scope-${randomUUID()}`;
  const conversationIds: string[] = [];
  const installedTriggers = new Map<string, string>();
  try {
    const intentVersionId = await createExactIntent(intentStore, intentScopeId, "Choose the most reliable bounded option");
    await installFailureFunction(pool);

    const boundaries = [
      ["runs", "issue100_fail_runs"],
      ["run_intent_bindings", "issue100_fail_binding"],
      ["decision_plans", "issue100_fail_plan"],
      ["api_idempotency_keys", "issue100_fail_idem"],
      ["dispatch_outbox", "issue100_fail_dispatch"],
    ] as const;

    for (const [table, trigger] of boundaries) {
      const conversationId = `conversation-${randomUUID()}`;
      conversationIds.push(conversationId);
      const run = createPendingRun(conversationId, qualifiedRequest(intentScopeId, intentVersionId), randomUUID());
      const idem = idempotency(run);
      await installFailureTrigger(pool, table, trigger);
      installedTriggers.set(table, trigger);
      try {
        await assert.rejects(
          () => control.submitRun(submission(run, intentScopeId, intentVersionId, idem)),
          /issue100 injected insert failure/,
        );
      } finally {
        await removeFailureTrigger(pool, table, trigger);
        installedTriggers.delete(table);
      }
      assert.deepEqual(await durableCounts(pool, run.id, idem), {
        runs: 0,
        bindings: 0,
        plans: 0,
        idempotency: 0,
        dispatches: 0,
      }, `failure at ${table} must not expose a partially qualified operation`);
    }
  } finally {
    for (const [table, trigger] of installedTriggers) {
      await removeFailureTrigger(pool, table, trigger);
    }
    await removeFailureFunction(pool);
    for (const conversationId of conversationIds) await cleanupConversation(pool, conversationId);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]);
    await control.close();
    await intentStore.close();
    await pool.end();
  }
});

test("Issue #100: PostgreSQL qualified Run exact replay/conflict/concurrency/expiry/restart preserves one Plan and dispatch", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const intentScopeId = `scope-${randomUUID()}`;
  const conversationId = `conversation-${randomUUID()}`;
  let first = await PostgresApiRunControlStore.connect(databaseUrl, {
    migrate: false,
    decisionPlanFidelityPolicy: allowExactTestPlanning,
  });
  let second = await PostgresApiRunControlStore.connect(databaseUrl, {
    migrate: false,
    decisionPlanFidelityPolicy: allowExactTestPlanning,
  });
  try {
    const intentVersionId = await createExactIntent(intentStore, intentScopeId, "Choose the most reliable bounded option");
    const request = qualifiedRequest(intentScopeId, intentVersionId);
    const run = createPendingRun(conversationId, request, randomUUID());
    const idem = idempotency(run);
    const input = submission(run, intentScopeId, intentVersionId, idem);

    const concurrent = await Promise.all([first.submitRun(input), second.submitRun(input)]);
    assert.deepEqual(new Set(concurrent.map((result) => result.outcome)), new Set(["created", "existing"]));
    assert.ok(concurrent.every((result) => result.outcome !== "conflict" && result.response.runId === run.id));
    assert.deepEqual(await durableCounts(pool, run.id, idem), {
      runs: 1,
      bindings: 1,
      plans: 1,
      idempotency: 1,
      dispatches: 1,
    });

    const plan = await pool.query<{ planning_material_json: unknown; intent_scope_id: string; intent_version_id: string }>(
      "SELECT planning_material_json,intent_scope_id,intent_version_id FROM decision_plans WHERE run_id=$1",
      [run.id],
    );
    assert.deepEqual(plan.rows[0]?.planning_material_json, request.decisionInput);
    assert.equal(plan.rows[0]?.intent_scope_id, intentScopeId);
    assert.equal(plan.rows[0]?.intent_version_id, intentVersionId);

    await pool.query("UPDATE api_idempotency_keys SET expires_at=now()-interval '1 second' WHERE run_id=$1", [run.id]);
    await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [run.id]);
    await first.close();
    await second.close();

    first = await PostgresApiRunControlStore.connect(databaseUrl, {
      migrate: false,
      decisionPlanFidelityPolicy: allowExactTestPlanning,
    });
    const restartedReplay = await first.submitRun(input);
    assert.equal(restartedReplay.outcome, "existing");
    assert.equal(restartedReplay.response.runId, run.id);
    assert.deepEqual(await durableCounts(pool, run.id, idem), {
      runs: 1,
      bindings: 1,
      plans: 1,
      idempotency: 1,
      dispatches: 1,
    });

    await pool.query("UPDATE api_idempotency_keys SET expires_at=now()-interval '1 second' WHERE run_id=$1", [run.id]);
    const conflictingRun = structuredClone(run);
    conflictingRun.request.objective = "A conflicting objective must not rebind the committed Run";
    const conflictIdem: ApiIdempotencyInput = {
      ...idem,
      requestHash: createApiRequestHash(conflictingRun.request),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const conflict = await first.submitRun(submission(conflictingRun, intentScopeId, intentVersionId, conflictIdem));
    assert.equal(conflict.outcome, "conflict");
    assert.deepEqual(await durableCounts(pool, run.id), {
      runs: 1,
      bindings: 1,
      plans: 1,
      idempotency: 1,
      dispatches: 1,
    });
    const immutable = await pool.query<{ request_json: ConsultationRunRequest }>("SELECT request_json FROM runs WHERE id=$1", [run.id]);
    assert.deepEqual(immutable.rows[0]?.request_json, request);

    await pool.query("UPDATE api_idempotency_keys SET expires_at=now()-interval '1 second' WHERE run_id=$1", [run.id]);
    second = await PostgresApiRunControlStore.connect(databaseUrl, {
      migrate: false,
      decisionPlanFidelityPolicy: allowExactTestPlanning,
    });
    const exactConcurrentReplay = await Promise.all([first.submitRun(input), second.submitRun(input)]);
    assert.ok(exactConcurrentReplay.every((result) => result.outcome === "existing" && result.response.runId === run.id));
    assert.deepEqual(await durableCounts(pool, run.id, idem), {
      runs: 1,
      bindings: 1,
      plans: 1,
      idempotency: 1,
      dispatches: 1,
    });
  } finally {
    await first.close();
    await second.close();
    await cleanupConversation(pool, conversationId, intentScopeId);
    await intentStore.close();
    await pool.end();
  }
});

test("Issue #100: DecisionPlan failure cannot escape through material-correction supersession and exact replay is singular", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const control = await PostgresApiRunControlStore.connect(databaseUrl, {
    migrate: false,
    decisionPlanFidelityPolicy: allowExactTestPlanning,
  });
  const intentScopeId = `scope-${randomUUID()}`;
  const conversationId = `conversation-${randomUUID()}`;
  const planFailureTrigger = "issue100_fail_supersession_plan";
  let triggerInstalled = false;
  try {
    const firstVersionId = await createExactIntent(intentStore, intentScopeId, "Choose the most reliable bounded option");
    const predecessorRequest = qualifiedRequest(intentScopeId, firstVersionId);
    const predecessor = createPendingRun(conversationId, predecessorRequest, randomUUID());
    const accepted = await control.submitRun(submission(predecessor, intentScopeId, firstVersionId));
    assert.equal(accepted.outcome, "created");

    const advanced = await intentStore.applyTransition({
      transitionId: randomUUID(),
      intentScopeId,
      baseIntentVersionId: firstVersionId,
      logicalUserTurnId: `turn-${randomUUID()}`,
      observedMessageHorizon: 2,
      sourceMessageId: `message-${randomUUID()}`,
      sourceDigest: `digest-${randomUUID()}`,
      operations: [{
        op: "SET",
        path: { kind: "PREFERENCE", key: "bounded-test-preference" },
        value: { state: "VALUE", value: "HIGH" },
      }],
    });
    assert.equal(advanced.disposition, "COMMITTED");
    const successorIntentVersionId = advanced.resultingIntentVersionId;
    assert.ok(successorIntentVersionId);

    const successor = createPendingRun(
      conversationId,
      qualifiedRequest(intentScopeId, successorIntentVersionId),
      randomUUID(),
    );
    const supersession = {
      supersession: {
        supersessionId: randomUUID(),
        predecessorRunId: predecessor.id,
        expectedPredecessorStatus: predecessor.status,
        expectedPredecessorVersion: predecessor.version,
        successorRun: successor,
        successorBinding: {
          intentScopeId,
          intentVersionId: successorIntentVersionId,
        },
      },
      dispatch: {
        logicalKey: `run:${successor.id}:execute`,
        queueName: "lattice.run",
        payload: { runId: successor.id, submittedVersion: successor.version },
      },
    } as const;

    await installFailureFunction(pool);
    await installFailureTrigger(pool, "decision_plans", planFailureTrigger);
    triggerInstalled = true;
    await assert.rejects(() => control.supersedeRun(supersession), /issue100 injected insert failure/);
    await removeFailureTrigger(pool, "decision_plans", planFailureTrigger);
    triggerInstalled = false;

    const predecessorAfterFailure = await pool.query<{ status: string; version: string }>(
      "SELECT status,version::text FROM runs WHERE id=$1",
      [predecessor.id],
    );
    assert.equal(predecessorAfterFailure.rows[0]?.status, "CREATED");
    assert.equal(predecessorAfterFailure.rows[0]?.version, String(predecessor.version));
    assert.deepEqual(await durableCounts(pool, successor.id), {
      runs: 0,
      bindings: 0,
      plans: 0,
      idempotency: 0,
      dispatches: 0,
    });
    const failedLineage = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM run_supersessions WHERE supersession_id=$1",
      [supersession.supersession.supersessionId],
    );
    assert.equal(failedLineage.rows[0]?.count, "0");

    const committed = await control.supersedeRun(supersession);
    assert.equal(committed.outcome, "superseded");
    const replay = await control.supersedeRun(supersession);
    assert.equal(replay.outcome, "replayed");
    assert.equal(replay.response.runId, successor.id);
    assert.deepEqual(await durableCounts(pool, successor.id), {
      runs: 1,
      bindings: 1,
      plans: 1,
      idempotency: 0,
      dispatches: 1,
    });
    const lineage = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM run_supersessions WHERE supersession_id=$1",
      [supersession.supersession.supersessionId],
    );
    assert.equal(lineage.rows[0]?.count, "1");
  } finally {
    if (triggerInstalled) await removeFailureTrigger(pool, "decision_plans", planFailureTrigger);
    await removeFailureFunction(pool);
    await cleanupConversation(pool, conversationId, intentScopeId);
    await control.close();
    await intentStore.close();
    await pool.end();
  }
});

test("Issue #100: Run-index projection failure does not fail Run authority and ordinary recovery repairs exactly once", async () => {
  const runStore = new MemoryRunStore();
  const authoritativeIndex = new MemoryConversationRunIndexStore(runStore);
  const flakyIndex = new FailOnceRunIndexStore(authoritativeIndex);
  const control = new ConversationRunIndexRecordingApiRunControlStore(
    new MemoryApiRunControlStore(runStore),
    flakyIndex,
  );
  const conversationId = `conversation-${randomUUID()}`;
  const run = createPendingRun(conversationId, {
    goal: "Preserve authoritative Run acceptance",
    priorities: [{ criterion: "reliability", weight: 1 }],
    hardConstraints: [{ criterion: "budget", operator: "lte", value: 1000 }],
  });
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const result = await control.submitRun({
      run,
      dispatch: {
        logicalKey: `run:${run.id}:execute`,
        queueName: "lattice.run",
        payload: { runId: run.id },
      },
    });
    assert.equal(result.outcome, "created");
    assert.equal((await runStore.get(run.id))?.id, run.id);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0]), /reconnect reconciliation is required/);

    assert.deepEqual(await flakyIndex.listRunIds(conversationId), [run.id]);
    assert.deepEqual(await flakyIndex.listRunIds(conversationId), [run.id]);
  } finally {
    console.warn = originalWarn;
    await control.close();
  }
});

test("Issue #100: PostgreSQL Run-index reconnect derives exact identity from authoritative Runs without duplicates", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const conversationId = `conversation-${randomUUID()}`;
  const run = createPendingRun(conversationId, {
    goal: "Repair the derived index from Run authority",
    priorities: [{ criterion: "reliability", weight: 1 }],
    hardConstraints: [{ criterion: "budget", operator: "lte", value: 1000 }],
  });
  let index = await PostgresConversationRunIndexStore.connect(databaseUrl);
  try {
    await runStore.create(run);
    assert.deepEqual(await index.listRunIds(conversationId), [run.id]);
    await index.close();
    index = await PostgresConversationRunIndexStore.connect(databaseUrl);
    assert.deepEqual(await index.listRunIds(conversationId), [run.id]);
    assert.deepEqual(await index.listRunIds(conversationId), [run.id]);
  } finally {
    await index.close();
    await runStore.close();
    await cleanupConversation(pool, conversationId);
    await pool.end();
  }
});

test("Issue #100: governed AcceptedChoice survives ConversationReference failure and exact replay restores one reference", async () => {
  const conversationId = `conversation-${randomUUID()}`;
  const intentScopeId = `scope-${randomUUID()}`;
  const intentVersionId = `intent-${randomUUID()}`;
  const sourceMessageId = `message-${randomUUID()}`;
  const recommendationId = `recommendation-${randomUUID()}`;
  const optionId = `option-${randomUUID()}`;
  const acceptedChoiceStore = new MemoryAcceptedChoiceStore();
  const choice = buildAcceptedChoiceRecord({
    conversationId,
    intentScopeId,
    intentVersionId,
    recommendationId,
    optionId,
    optionText: "Bounded option",
    sourceMessageId,
    sourceMessageDigest: "b".repeat(64),
    createdAt: new Date().toISOString(),
  });
  await acceptedChoiceStore.putAcceptedChoice(choice);

  const authority: ConversationReferenceAuthority = {
    conversationStore: {
      async get(id) {
        return id === conversationId ? { id, ownerSubjectId: "issue-100-owner" } : undefined;
      },
    },
    userMessageStore: {
      async get(messageId) {
        return messageId === sourceMessageId ? { messageId, conversationId, intentScopeId } : undefined;
      },
    },
    intentStore: {
      async getVersion(id) {
        return id === intentVersionId ? { intentVersionId: id, intentScopeId } : undefined;
      },
    },
    knowledgeStore: { async getKnowledge() { return undefined; } },
    recommendationStore: {
      async getRecommendation(id) {
        return id === recommendationId
          ? { recommendationId: id, conversationId, proposals: [{ proposalId: optionId }] }
          : undefined;
      },
      async listRecommendationsByConversation(id) {
        return id === conversationId
          ? [{ recommendationId, conversationId, proposals: [{ proposalId: optionId }] }]
          : [];
      },
    },
    acceptedChoiceStore,
    preparedResourceStore: { async getPreparedResource() { return undefined; } },
  };
  const durableReferences = new MemoryConversationReferenceStore(authority);
  const flakyReferences = new FailOnceConversationReferenceStore(durableReferences);
  const referenceInput = {
    conversationId,
    userMessageId: sourceMessageId,
    responseId: `accepted-choice:${choice.acceptedChoiceId}`,
    intentVersionId,
    targets: [
      { kind: "RECOMMENDATION" as const, targetId: recommendationId, relation: "CONSUMED" as const },
      { kind: "OPTION" as const, targetId: optionId, relation: "CONSUMED" as const },
      { kind: "ACCEPTED_CHOICE" as const, targetId: choice.acceptedChoiceId, relation: "PRODUCED" as const },
    ],
    createdAt: choice.createdAt,
  };
  try {
    await assert.rejects(
      () => appendConversationReference(flakyReferences, referenceInput),
      /issue100 injected ConversationReference failure/,
    );
    assert.deepEqual(await acceptedChoiceStore.getAcceptedChoice(choice.acceptedChoiceId), choice);
    assert.deepEqual(await durableReferences.listByConversation(conversationId), []);

    const governedReplay = await acceptedChoiceStore.putAcceptedChoice(choice);
    assert.deepEqual(governedReplay, choice);
    const repaired = await appendConversationReference(flakyReferences, referenceInput);
    const exactReplay = await appendConversationReference(flakyReferences, referenceInput);
    assert.equal(exactReplay.referenceId, repaired.referenceId);
    assert.deepEqual(await durableReferences.listByConversation(conversationId), [repaired]);
  } finally {
    await flakyReferences.close();
    await acceptedChoiceStore.close();
  }
});

test("Issue #100: final PostgreSQL ConversationReference connection failure closes every earlier startup store", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const observer = new Pool({ connectionString: databaseUrl });
  try {
    const countConnections = async (): Promise<number> => {
      const result = await observer.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_stat_activity
         WHERE datname=current_database() AND pid <> pg_backend_pid()`,
      );
      return Number(result.rows[0]?.count ?? 0);
    };
    const baseline = await countConnections();
    await assert.rejects(
      () => connectPostgresRuntimeStores(
        databaseUrl,
        false,
        allowExactTestPlanning,
        {
          connectConversationReferenceStore: async () => {
            throw new Error("issue100 injected final ConversationReference connection failure");
          },
        },
      ),
      /issue100 injected final ConversationReference connection failure/,
    );
    assert.equal(await countConnections(), baseline);
  } finally {
    await observer.end();
  }
});
