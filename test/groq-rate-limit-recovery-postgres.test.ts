import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
} from "../src/model/groq-knowledge-simplifier.js";
import {
  PostgresGroqRateLimitCoordinator,
  groqRateLimitScopeId,
} from "../src/model/groq-rate-limit-coordinator.js";
import type { CanonicalModelRequest, ModelCallContext } from "../src/model/types.js";

const databaseUrl = process.env.DATABASE_URL;

function request(): CanonicalModelRequest {
  return {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Cross-process recovery probe." }],
    temperature: 0,
    maxOutputTokens: 20,
  };
}

function context(): ModelCallContext {
  return {
    correlationId: "postgres-groq-recovery",
    requestIdentity: "postgres-groq-recovery-request",
    attempt: 0,
    signal: new AbortController().signal,
  };
}

test("PostgreSQL Groq recovery state coordinates independent API/Run-worker-style clients", {
  skip: databaseUrl === undefined ? "DATABASE_URL is required for PostgreSQL integration." : false,
}, async () => {
  assert.ok(databaseUrl);
  await PostgresGroqRateLimitCoordinator.migrate(databaseUrl);

  const credential = `gsk_pg_recovery_${randomUUID().replaceAll("-", "")}`;
  const scope = groqRateLimitScopeId(credential, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  let now = Math.floor(Date.now() / 1_000) * 1_000;
  const waits: number[] = [];
  const clientA = await PostgresGroqRateLimitCoordinator.connect(databaseUrl);
  const clientB = await PostgresGroqRateLimitCoordinator.connect(databaseUrl, {
    now: () => now,
    wait: async (delayMs) => {
      waits.push(delayMs);
      now += delayMs;
    },
  });
  const cleanup = new Pool({ connectionString: databaseUrl });

  try {
    const firstDeadline = now + 1_000;
    assert.equal(await clientA.extendBlockedUntil(scope, firstDeadline), firstDeadline);
    assert.equal(await clientB.blockedUntil(scope), firstDeadline);
    const persisted = await cleanup.query<{ scope_id: string }>(
      "SELECT scope_id FROM groq_rate_limit_recovery WHERE scope_id=$1",
      [scope],
    );
    assert.equal(persisted.rows[0]?.scope_id, scope);
    assert.equal(persisted.rows[0]?.scope_id.includes(credential), false);

    assert.equal(await clientB.extendBlockedUntil(scope, firstDeadline - 500), firstDeadline);
    const laterDeadline = firstDeadline + 1_000;
    assert.equal(await clientB.extendBlockedUntil(scope, laterDeadline), laterDeadline);
    assert.equal(await clientA.blockedUntil(scope), laterDeadline);

    let fetches = 0;
    const providerB = new GroqKnowledgeSimplifierModelProvider({
      apiKey: credential,
      rateLimitCoordinator: clientB,
      now: () => now,
      fetchImpl: async () => {
        fetches += 1;
        assert.ok(now >= laterDeadline, "independent client sent upstream before durable recovery deadline");
        return new Response(JSON.stringify({
          id: "pg-groq-recovery",
          model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
          choices: [{ message: { content: "Recovered." }, finish_reason: "stop" }],
        }), { status: 200 });
      },
    });

    assert.equal(fetches, 0);
    await providerB.generate(request(), context());
    assert.equal(fetches, 1);
    assert.ok(waits.length >= 1);
    assert.equal(await clientA.blockedUntil(scope), laterDeadline);
  } finally {
    await cleanup.query("DELETE FROM groq_rate_limit_recovery WHERE scope_id=$1", [scope]);
    await cleanup.end();
    await clientB.close();
    await clientA.close();
  }
});
