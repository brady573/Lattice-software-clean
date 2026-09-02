import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { registerAuthenticatedSubjectBoundary } from "../src/auth/authenticated-subject.js";
import { registerConversationApi } from "../src/conversation/conversation-api.js";
import { MemoryConversationStore, PostgresConversationStore } from "../src/conversation/conversation-store.js";
import type { LatticeRun } from "../src/domain.js";
import { MemoryRunStore } from "../src/run-store.js";

const databaseUrl = process.env.DATABASE_URL;

function testApp() {
  const conversationStore = new MemoryConversationStore();
  const runStore = new MemoryRunStore();
  const app = buildApp({ runStore });
  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: (request) => {
      const header = request.headers["x-test-subject"];
      return typeof header === "string" ? { subjectId: header } : undefined;
    },
  });
  registerConversationApi(app, { conversationStore, runStore });
  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/deletion-probe",
    async (_request, reply) => reply.status(202).send({ ok: true }),
  );
  app.get<{ Params: { runId: string } }>(
    "/api/v1/runs/:runId/events/stream",
    async (_request, reply) => reply.status(200).send({ ok: true }),
  );
  return { app, conversationStore, runStore };
}

function pendingRun(runId: string, conversationId: string): LatticeRun {
  return {
    id: runId,
    conversationId,
    status: "CREATED",
    version: 0,
    request: {
      goal: "Exercise deletion-state enforcement",
      hardConstraints: [],
      priorities: [],
    },
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [],
  };
}

test("M8-F2 deletion immediately hides conversation, execution, progress, result, reconnect, and mutation scope", async () => {
  const { app, conversationStore, runStore } = testApp();
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/conversations",
      headers: { "x-test-subject": "subject-a" },
    });
    assert.equal(created.statusCode, 201);
    const conversation = created.json<{ conversation: { id: string; deletedAt: string | null } }>().conversation;
    assert.equal(conversation.deletedAt, null);

    const runId = randomUUID();
    await runStore.create(pendingRun(runId, conversation.id));

    const crossSubjectDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${conversation.id}`,
      headers: { "x-test-subject": "subject-b" },
    });
    assert.equal(crossSubjectDelete.statusCode, 404);
    assert.deepEqual(crossSubjectDelete.json(), { error: "CONVERSATION_NOT_FOUND" });

    const stillActive = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversation.id}`,
      headers: { "x-test-subject": "subject-a" },
    });
    assert.equal(stillActive.statusCode, 200);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${conversation.id}`,
      headers: { "x-test-subject": "subject-a" },
    });
    assert.equal(deleted.statusCode, 204);

    const inaccessible = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/v1/conversations/${conversation.id}`,
        headers: { "x-test-subject": "subject-a" },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversation.id}/deletion-probe`,
        headers: { "x-test-subject": "subject-a" },
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}`,
        headers: { "x-test-subject": "subject-a" },
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}/events`,
        headers: { "x-test-subject": "subject-a" },
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}/events/stream`,
        headers: { "x-test-subject": "subject-a" },
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}/result`,
        headers: { "x-test-subject": "subject-a" },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/cancel`,
        headers: { "x-test-subject": "subject-a" },
      }),
    ]);

    assert.deepEqual(inaccessible.map((response) => response.statusCode), [404, 404, 404, 404, 404, 404, 404]);
    assert.deepEqual(inaccessible[0]?.json(), { error: "CONVERSATION_NOT_FOUND" });
    assert.deepEqual(inaccessible[1]?.json(), { error: "CONVERSATION_NOT_FOUND" });
    for (const response of inaccessible.slice(2)) {
      assert.deepEqual(response.json(), { error: "RUN_NOT_FOUND" });
    }
    assert.equal(await conversationStore.getOwned(conversation.id, "subject-a"), undefined);

    const retained = await conversationStore.getRetained(conversation.id);
    assert.ok(retained?.deletedAt);

    const candidates = await conversationStore.listPurgeCandidates({
      deletedBefore: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.deepEqual(candidates.map((candidate) => candidate.id), [conversation.id]);
  } finally {
    await app.close();
  }
});

test("M8-F2 repeated deletion is non-disclosing after the scope becomes inaccessible", async () => {
  const { app } = testApp();
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/conversations",
      headers: { "x-test-subject": "subject-a" },
    });
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const firstDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${conversationId}`,
      headers: { "x-test-subject": "subject-a" },
    });
    assert.equal(firstDelete.statusCode, 204);

    const repeatedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${conversationId}`,
      headers: { "x-test-subject": "subject-a" },
    });
    const missingDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${randomUUID()}`,
      headers: { "x-test-subject": "subject-a" },
    });
    assert.equal(repeatedDelete.statusCode, 404);
    assert.equal(missingDelete.statusCode, 404);
    assert.deepEqual(repeatedDelete.json(), missingDelete.json());
  } finally {
    await app.close();
  }
});

test("M8-F2 PostgreSQL deletion survives reconnect while retained state remains purge-policy distinguishable", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresConversationStore.migrate(databaseUrl);
  const id = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  let store = await PostgresConversationStore.connect(databaseUrl);
  try {
    await store.create(id, "subject-a");
    assert.equal(await store.deleteOwned(id, "subject-a"), true);
    await store.close();
    store = await PostgresConversationStore.connect(databaseUrl);

    assert.equal(await store.get(id), undefined);
    assert.equal(await store.getOwned(id, "subject-a"), undefined);
    const retained = await store.getRetained(id);
    assert.ok(retained?.deletedAt);

    const candidates = await store.listPurgeCandidates({
      deletedBefore: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.ok(candidates.some((candidate) => candidate.id === id));
  } finally {
    await store.close();
    await pool.query("DELETE FROM conversations WHERE id=$1", [id]);
    await pool.end();
  }
});
