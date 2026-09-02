import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  getAuthenticatedSubject,
  registerAuthenticatedSubjectBoundary,
} from "../src/auth/authenticated-subject.js";
import { buildApp } from "../src/http-app.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const databaseUrl = process.env.DATABASE_URL;
const request = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

function subjectHeaders(subjectId: string): Record<string, string> {
  return { "x-test-subject": subjectId };
}

function resolveTestSubject(request: { headers: Record<string, unknown> }) {
  const value = request.headers["x-test-subject"];
  return typeof value === "string" ? { subjectId: value } : undefined;
}

test("M8-D scopes the same route and idempotency key independently by authenticated subject", async () => {
  const app = buildApp({
    apiSubject: (request) => getAuthenticatedSubject(request).subjectId,
  });
  registerAuthenticatedSubjectBoundary(app, { resolveSubject: resolveTestSubject });

  try {
    const url = "/api/v1/conversations/shared-idempotency/messages";
    const key = "same-subject-key";
    const firstA = await app.inject({
      method: "POST",
      url,
      headers: { ...subjectHeaders("subject-a"), "idempotency-key": key },
      payload: request,
    });
    assert.equal(firstA.statusCode, 202);

    const replayA = await app.inject({
      method: "POST",
      url,
      headers: { ...subjectHeaders("subject-a"), "idempotency-key": key },
      payload: request,
    });
    assert.equal(replayA.statusCode, 202);
    assert.equal(replayA.json().runId, firstA.json().runId);

    const firstB = await app.inject({
      method: "POST",
      url,
      headers: { ...subjectHeaders("subject-b"), "idempotency-key": key },
      payload: request,
    });
    assert.equal(firstB.statusCode, 202);
    assert.notEqual(firstB.json().runId, firstA.json().runId);

    const conflictA = await app.inject({
      method: "POST",
      url,
      headers: { ...subjectHeaders("subject-a"), "idempotency-key": key },
      payload: { ...request, goal: `${request.goal} changed` },
    });
    assert.equal(conflictA.statusCode, 409);
    assert.deepEqual(conflictA.json(), { error: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY" });
  } finally {
    await app.close();
  }
});

test(
  "M8-D durable runtime persists authenticated subjects as idempotency scope keys",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const key = `m8-d-${randomUUID()}`;
    const pool = new Pool({ connectionString: databaseUrl });
    const config = resolveRuntimeConfig({
      DATABASE_URL: databaseUrl,
      LATTICE_DEPLOYMENT_MODE: "durable",
      LATTICE_TRUTH_MODE: "v36-offline",
      LATTICE_AUTO_MIGRATE: "true",
    } as NodeJS.ProcessEnv);
    const app = await createRuntimeApp(config, {
      authenticatedSubjectResolver: resolveTestSubject,
    });

    let conversationA: string | undefined;
    let conversationB: string | undefined;
    let runA: string | undefined;
    let runB: string | undefined;
    try {
      const createdA = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: subjectHeaders("subject-a"),
      });
      assert.equal(createdA.statusCode, 201);
      conversationA = createdA.json().conversation.id as string;

      const createdB = await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers: subjectHeaders("subject-b"),
      });
      assert.equal(createdB.statusCode, 201);
      conversationB = createdB.json().conversation.id as string;

      const submitA = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationA}/messages`,
        headers: { ...subjectHeaders("subject-a"), "idempotency-key": key },
        payload: request,
      });
      assert.equal(submitA.statusCode, 202);
      runA = submitA.json().runId as string;

      const replayA = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationA}/messages`,
        headers: { ...subjectHeaders("subject-a"), "idempotency-key": key },
        payload: request,
      });
      assert.equal(replayA.statusCode, 202);
      assert.equal(replayA.json().runId, runA);

      const conflictA = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationA}/messages`,
        headers: { ...subjectHeaders("subject-a"), "idempotency-key": key },
        payload: { ...request, goal: `${request.goal} changed` },
      });
      assert.equal(conflictA.statusCode, 409);

      const submitB = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationB}/messages`,
        headers: { ...subjectHeaders("subject-b"), "idempotency-key": key },
        payload: request,
      });
      assert.equal(submitB.statusCode, 202);
      runB = submitB.json().runId as string;
      assert.notEqual(runB, runA);

      const rows = await pool.query<{ scope_key: string }>(
        "SELECT scope_key FROM api_idempotency_keys WHERE idempotency_key=$1 ORDER BY scope_key",
        [key],
      );
      assert.deepEqual(rows.rows.map((row) => row.scope_key), ["subject-a", "subject-b"]);
    } finally {
      await pool.query("DELETE FROM api_idempotency_keys WHERE idempotency_key=$1", [key]);
      if (runA) await pool.query("DELETE FROM runs WHERE id=$1", [runA]);
      if (runB) await pool.query("DELETE FROM runs WHERE id=$1", [runB]);
      if (conversationA) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationA]);
      if (conversationB) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationB]);
      await app.close();
      await pool.end();
    }
  },
);
