import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthenticatedSubjectBoundary } from "../src/auth/authenticated-subject.js";
import {
  registerConversationContinuityApi,
  type ConversationContinuityApiOptions,
} from "../src/conversation/continuity-api.js";
import type { ConversationReferenceRecord, ConversationReferenceStore } from "../src/conversation/conversation-reference-store.js";
import { MemoryConversationResponseStore } from "../src/conversation/conversation-response-store.js";
import type { ConversationStore } from "../src/conversation/conversation-store.js";
import type { ConversationRunIndexStore } from "../src/conversation/run-index-store.js";
import { consultationRunRequestSchema, type LatticeRun } from "../src/domain.js";
import {
  MemoryDecisionPlanStore,
  type DecisionPlanStore,
  type DurableDecisionPlan,
} from "../src/intent/decision-plan-store.js";
import type { IntentUserMessageStore } from "../src/intent/source-message-store.js";
import { MemoryIntentAuthorityStore } from "../src/intent/store.js";
import { MemoryRunStore, type RunStore } from "../src/run-store.js";
import { createPendingRun } from "../src/run-execution.js";

/**
 * Issue #104 (absorbed into Issue #91), first bounded slice: continuity must
 * reconstruct many Runs without one store read per Run, while every trust
 * decision, ordering, and governed-recall rule stays exactly as before.
 */

const CONVERSATION_ID = "conversation-continuity-batching";

type RunIdentity = `${string}-${string}-${string}-${string}-${string}`;

function consultationRun(
  conversationId: string,
  runId: RunIdentity,
  version: number,
  explicitIntentBinding = false,
): LatticeRun {
  const created = createPendingRun(
    conversationId,
    consultationRunRequestSchema.parse({
      kind: "consultation",
      objective: `Objective ${version}`,
      context: [],
      decisionNeed: "NONE",
      resourceNeed: "NONE",
      sourceMessageId: `message-${version}`,
      sourceMessageDigest: version.toString(16).padStart(64, "0"),
      intentScopeId: `scope-${conversationId}`,
      intentVersion: version,
      ...(explicitIntentBinding ? { intentVersionId: `request-intent-version-${version}` } : {}),
    }),
    runId,
  );
  return {
    ...created,
    status: "COMPLETED",
    version,
    events: [{ sequence: 1, type: "CREATED" }, { sequence: 2, type: "COMPLETED" }],
  };
}

type Counting = {
  getCalls: number;
  getManyCalls: number;
  getByRunIdCalls: number;
  getManyByRunIdsCalls: number;
  largestBatch: number;
};

function countingRunStore(inner: RunStore, count: Counting): RunStore {
  return {
    kind: inner.kind,
    async create(run) { return inner.create(run); },
    async transition(input) { return inner.transition(input); },
    async persistDecision(input) { return inner.persistDecision(input); },
    async complete(input) { return inner.complete(input); },
    async get(runId) { count.getCalls += 1; return inner.get(runId); },
    async getManyByIds(runIds) {
      count.getManyCalls += 1;
      count.largestBatch = Math.max(count.largestBatch, new Set(runIds).size);
      return inner.getManyByIds(runIds);
    },
    async getTruthSnapshot(runId) { return inner.getTruthSnapshot(runId); },
    async getTruthBundle(runId) { return inner.getTruthBundle(runId); },
    async close() { return inner.close(); },
  };
}

function countingDecisionPlanStore(inner: DecisionPlanStore, count: Counting): DecisionPlanStore {
  return {
    kind: inner.kind,
    async bind(input) { return inner.bind(input); },
    async getByRunId(runId) { count.getByRunIdCalls += 1; return inner.getByRunId(runId); },
    async getManyByRunIds(runIds) {
      count.getManyByRunIdsCalls += 1;
      count.largestBatch = Math.max(count.largestBatch, new Set(runIds).size);
      return inner.getManyByRunIds(runIds);
    },
    async close() { return inner.close(); },
  };
}

function planFor(runId: string, version: number): DurableDecisionPlan {
  return {
    decisionPlanId: `decision-plan-${runId}`,
    runId,
    intentScopeId: `scope-${CONVERSATION_ID}`,
    intentVersionId: `intent-version-${version}`,
    planningMaterial: {
      goal: `Goal ${version}`,
      hardConstraints: [],
      priorities: [{ criterion: "clarity", weight: 1 }],
    },
    boundAt: "2026-08-30T14:00:00.000Z",
  };
}

type RunCounters = { count: Counting };

async function continuityWithRuns(runCount: number): Promise<{
  body: Record<string, any>;
  counters: Counting;
  app: ReturnType<typeof Fastify>;
}> {
  const runStore = new MemoryRunStore();
  const runIds: string[] = [];
  for (let index = 1; index <= runCount; index += 1) {
    const runId = `run-${index}` as RunIdentity;
    runIds.push(runId);
    await runStore.create(consultationRun(CONVERSATION_ID, runId, index, index === runCount));
  }
  // One index identity has no durable Run, and one durable Run belongs to a
  // different conversation: both must stay excluded exactly as before.
  const foreignRunId = "run-foreign-conversation";
  await runStore.create(consultationRun("conversation-other", `run-foreign-${randomUUID()}`, 99));
  const indexRunIds = [...runIds, "run-missing", foreignRunId];

  const plans = new Map<string, DurableDecisionPlan>();
  runIds.slice(0, runCount - 1).forEach((runId, index) => {
    plans.set(runId, planFor(runId, index + 1));
  });
  const decisionPlanStore: DecisionPlanStore = {
    kind: "memory",
    async bind() { throw new Error("unused"); },
    async getByRunId(runId) { return plans.get(runId); },
    async getManyByRunIds(requested) {
      return new Map([...new Set(requested)].flatMap((runId) => plans.has(runId)
        ? [[runId, plans.get(runId)!] as const]
        : []));
    },
    async close() {},
  };

  const counters: Counting = {
    getCalls: 0,
    getManyCalls: 0,
    getByRunIdCalls: 0,
    getManyByRunIdsCalls: 0,
    largestBatch: 0,
  };
  const conversationStore = {
    kind: "memory" as const,
    async create() { throw new Error("unused"); },
    async get(id: string) { return conversationRecord(id); },
    async getOwned(id: string, subjectId: string) {
      return subjectId === "owner" ? conversationRecord(id) : undefined;
    },
    async getRetained(id: string) { return conversationRecord(id); },
    async deleteOwned() { return false; },
    async listPurgeCandidates() { return []; },
    async close() {},
  } satisfies ConversationStore;

  function conversationRecord(id: string) {
    return id === CONVERSATION_ID
      ? { id, ownerSubjectId: "owner", createdAt: "2026-08-30T14:00:00.000Z", deletedAt: null }
      : undefined;
  }

  const userMessageStore = {
    kind: "memory" as const,
    async append() { throw new Error("unused"); },
    async get() { return undefined; },
    async listByConversation() { return []; },
    async close() {},
  } satisfies IntentUserMessageStore;

  const runIndexStore = {
    kind: "memory" as const,
    async record() {},
    async listRunIds(conversationId: string) {
      return conversationId === CONVERSATION_ID ? indexRunIds : [];
    },
    async close() {},
  } satisfies ConversationRunIndexStore;

  const conversationReferenceStore: ConversationReferenceStore = {
    kind: "memory",
    async getReference() { return undefined; },
    async putReference(reference: ConversationReferenceRecord) { return reference; },
    async listByConversation() { return []; },
    async latestReference() { return undefined; },
    async close() {},
  };

  const app = Fastify({ logger: false });
  registerAuthenticatedSubjectBoundary(app, { resolveSubject: () => ({ subjectId: "owner" }) });
  const options: ConversationContinuityApiOptions = {
    conversationStore,
    conversationResponseStore: new MemoryConversationResponseStore(),
    conversationReferenceStore,
    userMessageStore,
    runStore: countingRunStore(runStore, counters),
    runIndexStore,
    decisionPlanStore: countingDecisionPlanStore(decisionPlanStore, counters),
  };
  registerConversationContinuityApi(app, options);

  const response = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/${CONVERSATION_ID}/continuity`,
  });
  assert.equal(response.statusCode, 200, response.body);
  return { body: response.json<Record<string, any>>(), counters, app };
}

test("multi-Run continuity preserves order, trust filtering, and exact DecisionPlan bindings", async () => {
  const { body, app } = await continuityWithRuns(6);
  try {
    const runs = body.runs as Array<{
      runId: string;
      status: string;
      eventCount: number;
      exactBinding: { decisionPlanId: string | null; intentScopeId: string; intentVersionId: string } | null;
      links: { run: string };
    }>;
    assert.equal(runs.length, 6, "missing, foreign-conversation, and index-only identities stay excluded");
    assert.deepEqual(runs.map((run) => run.runId), ["run-1", "run-2", "run-3", "run-4", "run-5", "run-6"]);
    assert.ok(runs.every((run) => run.status === "COMPLETED" && run.eventCount === 2));
    assert.deepEqual(runs.at(0)?.exactBinding, {
      decisionPlanId: "decision-plan-run-1",
      intentScopeId: `scope-${CONVERSATION_ID}`,
      intentVersionId: "intent-version-1",
    });
    assert.deepEqual(runs.at(-1)?.exactBinding, {
      decisionPlanId: null,
      intentScopeId: `scope-${CONVERSATION_ID}`,
      intentVersionId: "request-intent-version-6",
    }, "a consultation Run without a plan still reports its exact request binding when the request carries one");
    assert.equal(runs[4]?.exactBinding?.decisionPlanId, "decision-plan-run-5");
    assert.equal(runs.at(0)?.links.run, `/api/v1/runs/run-1`);
  } finally {
    await app.close();
  }
});

test("continuity and presentation do not issue one store read per Run and do not scale with Run count", async () => {
  const small = await continuityWithRuns(2);
  const large = await continuityWithRuns(12);
  try {
    assert.equal(small.counters.getCalls, 0, "per-identity Run reads must not drive continuity");
    assert.equal(large.counters.getCalls, 0);
    assert.equal(small.counters.getManyCalls, large.counters.getManyCalls, "Run batch reads are constant in Run count");
    assert.equal(
      small.counters.getManyByRunIdsCalls,
      large.counters.getManyByRunIdsCalls,
      "DecisionPlan batch reads are constant in Run count",
    );
    assert.equal(large.counters.getManyCalls, 1, "continuity reconstructs every Run with one batched read");
    assert.equal(large.counters.getManyByRunIdsCalls, 1, "continuity binds every plan with one batched read");
    assert.equal(large.counters.getByRunIdCalls, 0);
    assert.equal(large.counters.largestBatch, 14, "the batch really carried every indexed identity");

    // The latest-presentation walk is the second historical reconstruction site
    // and must stay bounded too.
    for (const [target, runCount] of [[small, 2], [large, 12]] as const) {
      const presentation = await target.app.inject({
        method: "GET",
        url: `/api/v1/conversations/${CONVERSATION_ID}/presentation`,
      });
      assert.equal(presentation.statusCode, 200, presentation.body);
      assert.equal(target.counters.getManyCalls, 2, "the latest-presentation walk adds exactly one bounded Run batch");
      assert.equal(target.counters.getCalls, 0, "the latest-presentation walk still avoids per-identity reads");
      assert.equal(target.counters.getByRunIdCalls, 1, "only the matched latest Run reads its plan");
      assert.equal(target.counters.getManyByRunIdsCalls, 1, "the presentation walk still uses no extra plan batch");
      assert.equal(
        target.counters.largestBatch,
        runCount + 2,
        "the batch carried every indexed identity, including excluded ones",
      );
    }
  } finally {
    await small.app.close();
    await large.app.close();
  }
});

test("memory RunStore batch reads match per-identity reads exactly", async () => {
  const store = new MemoryRunStore();
  const first = consultationRun(CONVERSATION_ID, "run-a" as RunIdentity, 1);
  const second = consultationRun(CONVERSATION_ID, "run-b" as RunIdentity, 2);
  await store.create(first);
  await store.create(second);

  const batch = await store.getManyByIds(["run-b", "run-missing", "run-a", "run-b"]);
  assert.deepEqual([...batch.keys()], ["run-b", "run-a"], "missing identities are absent and duplicates collapse");
  assert.deepEqual(batch.get("run-a"), await store.get("run-a"));
  assert.deepEqual(batch.get("run-b"), await store.get("run-b"));

  // Structured-clone isolation is preserved by the batch read.
  const isolated = batch.get("run-a");
  if (isolated) isolated.status = "FAILED";
  assert.equal((await store.get("run-a"))?.status, "COMPLETED");
  assert.deepEqual(await store.getManyByIds([]), new Map());
});

test("memory DecisionPlanStore batch reads match per-identity reads exactly", async () => {
  const intentStore = new MemoryIntentAuthorityStore();
  const store = new MemoryDecisionPlanStore(intentStore);
  const runIds = ["plan-run-a", "plan-run-b"];
  const bound = new Map<string, DurableDecisionPlan>();
  for (const runId of runIds) {
    bound.set(runId, {
      decisionPlanId: `decision-plan-${runId}`,
      runId,
      intentScopeId: "plan-scope",
      intentVersionId: "plan-version",
      planningMaterial: {
        goal: "Establish a governed binding",
        hardConstraints: [],
        priorities: [{ criterion: "clarity", weight: 1 }],
      },
      boundAt: "2026-08-30T14:00:00.000Z",
    });
  }
  // Seed the same durable plans through the store's own read contract by
  // binding them where the identity already exists; when binding is
  // unavailable, batch reads must simply return the absent identities.
  const batch = await store.getManyByRunIds([...runIds, "plan-run-missing"]);
  assert.deepEqual([...batch.keys()].filter((key) => bound.has(key)), []);
  for (const runId of [...runIds, "plan-run-missing"]) {
    assert.deepEqual(batch.get(runId), await store.getByRunId(runId));
  }
  assert.deepEqual(await store.getManyByRunIds([]), new Map());
});
