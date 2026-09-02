import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthenticatedSubjectBoundary } from "../src/auth/authenticated-subject.js";
import { registerConversationContinuityApi } from "../src/conversation/continuity-api.js";
import type { ConversationStore } from "../src/conversation/conversation-store.js";
import type { ConversationRunIndexStore } from "../src/conversation/run-index-store.js";
import type { LatticeRun } from "../src/domain.js";
import type { DecisionPlanStore, DurableDecisionPlan } from "../src/intent/decision-plan-store.js";
import type { IntentUserMessageStore } from "../src/intent/source-message-store.js";
import type { RunStore } from "../src/run-store.js";

const plan: DurableDecisionPlan = {
  decisionPlanId: "decision-plan:run-alice",
  runId: "run-alice",
  intentScopeId: "scope-alice",
  intentVersionId: "intent-version-alice",
  planningMaterial: {
    goal: "Choose an eligible option",
    hardConstraints: [{ criterion: "price", operator: "lte", value: 1300 }],
    priorities: [{ criterion: "performance", weight: 1 }],
  },
  boundAt: "2026-08-30T14:00:00.000Z",
};

const completedRun: LatticeRun = {
  id: "run-alice",
  conversationId: "conversation-alice",
  status: "COMPLETED",
  version: 8,
  request: structuredClone(plan.planningMaterial),
  decision: {
    goal: plan.planningMaterial.goal,
    winnerCandidateId: "candidate-a",
    evaluations: [],
    rationale: ["Candidate A is the eligible winner."],
    evidenceIds: ["evidence-1"],
    truthAssessmentIds: ["truth-1"],
  },
  explanation: "Candidate A is the supported recommendation.",
  truthAssessmentIds: ["truth-1"],
  events: [],
};

function createApp() {
  const app = Fastify({ logger: false });
  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: (request) => {
      const raw = request.headers["x-test-subject"];
      return typeof raw === "string" && raw.trim() ? { subjectId: raw } : undefined;
    },
  });

  const conversationStore = {
    kind: "memory" as const,
    async create() { throw new Error("not used"); },
    async get(id: string) {
      return id === "conversation-alice"
        ? { id, ownerSubjectId: "alice", createdAt: "2026-08-30T14:00:00.000Z", deletedAt: null }
        : undefined;
    },
    async getOwned(id: string, subjectId: string) {
      return id === "conversation-alice" && subjectId === "alice"
        ? { id, ownerSubjectId: "alice", createdAt: "2026-08-30T14:00:00.000Z", deletedAt: null }
        : undefined;
    },
    async getRetained(id: string) {
      return id === "conversation-alice"
        ? { id, ownerSubjectId: "alice", createdAt: "2026-08-30T14:00:00.000Z", deletedAt: null }
        : undefined;
    },
    async deleteOwned() { return false; },
    async listPurgeCandidates() { return []; },
    async close() {},
  } satisfies ConversationStore;

  const userMessageStore = {
    kind: "memory" as const,
    async append() { throw new Error("not used"); },
    async get() { return undefined; },
    async listByConversation() { return []; },
    async close() {},
  } satisfies IntentUserMessageStore;

  const runIndexStore = {
    kind: "memory" as const,
    async record() {},
    async listRunIds(conversationId: string) {
      return conversationId === "conversation-alice" ? [completedRun.id] : [];
    },
    async close() {},
  } satisfies ConversationRunIndexStore;

  const runStore = {
    kind: "memory" as const,
    async create() {},
    async transition() { return { outcome: "stale" as const }; },
    async persistDecision() { return { outcome: "stale" as const }; },
    async complete() { return { outcome: "stale" as const }; },
    async get(runId: string) { return runId === completedRun.id ? structuredClone(completedRun) : undefined; },
    async getTruthSnapshot() { return undefined; },
    async getTruthBundle() { return undefined; },
    async close() {},
  } satisfies RunStore;

  const decisionPlanStore = {
    kind: "memory" as const,
    async bind() { throw new Error("not used"); },
    async getByRunId(runId: string) { return runId === plan.runId ? structuredClone(plan) : undefined; },
    async close() {},
  } satisfies DecisionPlanStore;

  registerConversationContinuityApi(app, {
    conversationStore,
    userMessageStore,
    runStore,
    runIndexStore,
    decisionPlanStore,
  });
  return app;
}

test("continuity, presentation, and resource hydration are subject-owned while stale resources fail explicitly", async (t) => {
  const app = createApp();
  t.after(async () => app.close());

  const aliceContinuity = await app.inject({
    method: "GET",
    url: "/api/v1/conversations/conversation-alice/continuity",
    headers: { "x-test-subject": "alice" },
  });
  assert.equal(aliceContinuity.statusCode, 200);
  assert.equal(aliceContinuity.json().conversation.ownerSubjectId, "alice");

  const bobContinuity = await app.inject({
    method: "GET",
    url: "/api/v1/conversations/conversation-alice/continuity",
    headers: { "x-test-subject": "bob" },
  });
  assert.equal(bobContinuity.statusCode, 404);
  assert.deepEqual(bobContinuity.json(), { error: "CONVERSATION_NOT_FOUND" });

  const alicePresentation = await app.inject({
    method: "GET",
    url: "/api/v1/conversations/conversation-alice/presentation",
    headers: { "x-test-subject": "alice" },
  });
  assert.equal(alicePresentation.statusCode, 200);
  const snapshot = alicePresentation.json().presentation;
  assert.equal(snapshot.phase, "actionable");
  assert.equal(snapshot.nextAction.winnerCandidateId, "candidate-a");
  assert.equal(snapshot.resources.length, 2);

  const bobPresentation = await app.inject({
    method: "GET",
    url: "/api/v1/conversations/conversation-alice/presentation",
    headers: { "x-test-subject": "bob" },
  });
  assert.equal(bobPresentation.statusCode, 404);
  assert.deepEqual(bobPresentation.json(), { error: "CONVERSATION_NOT_FOUND" });

  const resourceId = snapshot.resources[0].id as string;
  const aliceResource = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/conversation-alice/presentation/resources/${encodeURIComponent(resourceId)}?presentationRevision=${encodeURIComponent(snapshot.presentationRevision)}`,
    headers: { "x-test-subject": "alice" },
  });
  assert.equal(aliceResource.statusCode, 200);
  assert.equal(aliceResource.json().resource.presentationRevision, snapshot.presentationRevision);

  const staleResource = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/conversation-alice/presentation/resources/${encodeURIComponent(resourceId)}?presentationRevision=stale-revision`,
    headers: { "x-test-subject": "alice" },
  });
  assert.equal(staleResource.statusCode, 409);
  assert.equal(staleResource.json().error, "PRESENTATION_STALE");

  const bobResource = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/conversation-alice/presentation/resources/${encodeURIComponent(resourceId)}?presentationRevision=${encodeURIComponent(snapshot.presentationRevision)}`,
    headers: { "x-test-subject": "bob" },
  });
  assert.equal(bobResource.statusCode, 404);
  assert.deepEqual(bobResource.json(), { error: "CONVERSATION_NOT_FOUND" });
});
