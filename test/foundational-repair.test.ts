import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { createStandaloneRunWorker, type StandaloneRunWorker } from "../src/run-worker-process.js";
import {
  ACTION_MESSAGE,
  DECISION_MESSAGE,
  FoundationalConsultationInterpreter,
  FoundationalTruthPipeline,
  KNOWLEDGE_MESSAGE,
  foundationalCriterionCatalog,
} from "./fixtures/foundational-consultation-fixture.js";

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);
const databaseUrl = process.env.DATABASE_URL;

async function waitForCompletedRun(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Run ${runId} unexpectedly reached ${status}.`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Run ${runId} did not complete.`);
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

test("A Knowledge, B Decision, and C Action Preparation use the same canonical conversation API", async () => {
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new FoundationalTruthPipeline(),
    consultationInterpreter: new FoundationalConsultationInterpreter(),
    criterionCatalog: foundationalCriterionCatalog,
  });
  try {
    const knowledgeConversation = await createConversation(app);
    const knowledgeAccepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${knowledgeConversation}/turns`,
      payload: { turnId: "knowledge-turn", message: KNOWLEDGE_MESSAGE },
    });
    assert.equal(knowledgeAccepted.statusCode, 202, knowledgeAccepted.body);
    assert.equal(knowledgeAccepted.json().decisionNeed, "NONE");
    await waitForCompletedRun(app, knowledgeAccepted.json().runId);
    const knowledgeOutcome = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${knowledgeAccepted.json().runId}/outcome`,
    });
    assert.equal(knowledgeOutcome.statusCode, 200, knowledgeOutcome.body);
    assert.equal(knowledgeOutcome.json().outcome.kind, "KNOWLEDGE");
    assert.equal(knowledgeOutcome.json().outcome.acceptedUnderstanding, KNOWLEDGE_MESSAGE);
    assert.equal(knowledgeOutcome.json().outcome.findings[0]?.status, "SUPPORTED");
    const knowledgePlan = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${knowledgeAccepted.json().runId}/decision-plan`,
    });
    assert.equal(knowledgePlan.statusCode, 200, knowledgePlan.body);

    const decisionConversation = await createConversation(app);
    const decisionPending = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${decisionConversation}/turns`,
      payload: { turnId: "decision-turn", message: DECISION_MESSAGE },
    });
    assert.equal(decisionPending.statusCode, 202, decisionPending.body);
    assert.equal(decisionPending.json().status, "NEEDS_CLARIFICATION");
    assert.equal(decisionPending.json().decisionNeed, "UNRESOLVED");
    assert.equal(decisionPending.json().runId, undefined);
    const decisionAccepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${decisionConversation}/clarifications/${decisionPending.json().proposalId}/confirm`,
      payload: { turnId: "decision-confirm", message: "Yes, that's correct." },
    });
    assert.equal(decisionAccepted.statusCode, 202, decisionAccepted.body);
    assert.equal(decisionAccepted.json().decisionNeed, "QUALIFIED");
    await waitForCompletedRun(app, decisionAccepted.json().runId);
    const decisionOutcome = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${decisionAccepted.json().runId}/outcome`,
    });
    assert.equal(decisionOutcome.statusCode, 200, decisionOutcome.body);
    assert.equal(decisionOutcome.json().outcome.kind, "DECISION_SUPPORT");
    assert.equal(decisionOutcome.json().outcome.decision.outcome, "RECOMMENDATION");
    assert.equal(decisionOutcome.json().outcome.decision.winnerCandidateId, "cedar");
    assert.equal(decisionOutcome.json().outcome.selectionAuthorized, false);
    const decisionPlan = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${decisionAccepted.json().runId}/decision-plan`,
    });
    assert.equal(decisionPlan.statusCode, 200, decisionPlan.body);
    assert.equal(decisionPlan.json().decisionPlan.intentVersionId, decisionAccepted.json().intentVersionId);

    const actionConversation = await createConversation(app);
    const actionAccepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${actionConversation}/turns`,
      payload: { turnId: "action-turn", message: ACTION_MESSAGE },
    });
    assert.equal(actionAccepted.statusCode, 202, actionAccepted.body);
    assert.equal(actionAccepted.json().decisionNeed, "NONE");
    await waitForCompletedRun(app, actionAccepted.json().runId);
    const actionOutcome = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${actionAccepted.json().runId}/outcome`,
    });
    assert.equal(actionOutcome.statusCode, 200, actionOutcome.body);
    assert.equal(actionOutcome.json().outcome.kind, "ACTION_PREPARATION");
    assert.equal(actionOutcome.json().outcome.resource.kind, "CHECKLIST");
    assert.equal(actionOutcome.json().outcome.resource.executionAuthorized, false);
    const actionPlan = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${actionAccepted.json().runId}/decision-plan`,
    });
    assert.equal(actionPlan.statusCode, 200, actionPlan.body);
  } finally {
    await app.close();
  }
});

test("an unresolved decision need remains explicit and does not force Decision Engine execution", async () => {
  const message = "I need help making a decision, but I have not supplied the material criteria yet.";
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    consultationInterpreter: {
      async interpret(input) {
        return {
          objective: input.message.trim(),
          decisionRequested: true,
          resourceNeed: "NONE" as const,
        };
      },
    },
  });
  try {
    const conversationId = await createConversation(app);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "unresolved-decision", message },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.equal(accepted.json().decisionNeed, "UNRESOLVED");
    await waitForCompletedRun(app, accepted.json().runId);
    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.json().runId}` });
    assert.equal(run.statusCode, 200, run.body);
    assert.equal(run.json().request.decisionNeed, "UNRESOLVED");
    assert.equal(run.json().decision, null);
    assert.equal(run.json().events.some((event: { type: string }) => event.type === "DECIDING"), false);
  } finally {
    await app.close();
  }
});

test("qualified free-form decision intake survives the live PostgreSQL API-to-worker boundary", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const app = await createRuntimeApp(resolveRuntimeConfig({
    DATABASE_URL: databaseUrl,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: "true",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
  } as NodeJS.ProcessEnv), {
    truthPipeline: new FoundationalTruthPipeline(),
    consultationInterpreter: new FoundationalConsultationInterpreter(),
    criterionCatalog: foundationalCriterionCatalog,
  });
  let worker: StandaloneRunWorker | undefined;
  let conversationId: string | undefined;
  let runId: string | undefined;
  try {
    conversationId = await createConversation(app);
    const pending = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: `pg-decision-${randomUUID()}`, message: DECISION_MESSAGE },
    });
    assert.equal(pending.statusCode, 202, pending.body);
    assert.equal(pending.json().decisionNeed, "UNRESOLVED");
    const preConfirmation = await pool.query<{
      state_json: {
        objective: { value: { state: string; value: string } };
        requirements: Record<string, unknown>;
        preferences: Record<string, unknown>;
      };
    }>("SELECT state_json FROM intent_versions WHERE intent_version_id=$1", [pending.json().intentVersionId]);
    assert.equal(preConfirmation.rows[0]?.state_json.objective.value.value, DECISION_MESSAGE);
    assert.deepEqual(preConfirmation.rows[0]?.state_json.requirements, {});
    assert.deepEqual(preConfirmation.rows[0]?.state_json.preferences, {});
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/clarifications/${pending.json().proposalId}/confirm`,
      payload: { turnId: `pg-confirm-${randomUUID()}`, message: "Confirmed." },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.equal(accepted.json().decisionNeed, "QUALIFIED");
    runId = accepted.json().runId as string;

    worker = await createStandaloneRunWorker({
      databaseUrl,
      workerId: `foundational-worker:${randomUUID()}`,
      pollMs: 5,
      leaseMs: 30_000,
      retryDelayMs: 10,
      batchSize: 10,
    }, {
      truthPipeline: new FoundationalTruthPipeline(),
      criterionCatalog: foundationalCriterionCatalog,
    });
    worker.start();
    await waitForCompletedRun(app, runId);
    const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.equal(outcome.statusCode, 200, outcome.body);
    assert.equal(outcome.json().outcome.kind, "DECISION_SUPPORT");
    assert.equal(outcome.json().outcome.decision.winnerCandidateId, "cedar");

    const persisted = await pool.query<{
      intent_scope_id: string;
      intent_version_id: string;
      decision_outcome: string;
    }>(
      `SELECT b.intent_scope_id,b.intent_version_id,r.decision_json->>'outcome' AS decision_outcome
       FROM run_intent_bindings b JOIN runs r ON r.id=b.run_id WHERE b.run_id=$1`,
      [runId],
    );
    assert.equal(persisted.rows[0]?.intent_scope_id, `consultation:${conversationId}`);
    assert.match(persisted.rows[0]?.intent_version_id ?? "", /^[0-9a-f-]{36}$/u);
    assert.equal(persisted.rows[0]?.decision_outcome, "RECOMMENDATION");
  } finally {
    await worker?.close();
    await app.close();
    if (runId) await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    if (conversationId) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    await pool.end();
  }
});

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'](\.[^"']+)["']/gu;

async function canonicalDependencyClosure(entrypoints: readonly string[]): Promise<Map<string, string>> {
  const pending = entrypoints.map((entrypoint) => resolve(entrypoint));
  const visited = new Map<string, string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    const source = await readFile(path, "utf8");
    visited.set(path, source);
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]!;
      const resolved = resolve(dirname(path), specifier.replace(/\.js$/u, ".ts"));
      if (resolved.includes("/src/")) pending.push(resolved);
    }
  }
  return visited;
}

test("Example Firewall rejects canonical imports, calls, and dependencies on legacy bounded adapters", async () => {
  const closure = await canonicalDependencyClosure([
    "src/index.ts",
    "src/runtime-app.ts",
    "src/run-worker-main.ts",
    "src/run-worker-process.ts",
  ]);
  const forbiddenModules = [
    "src/fixtures.ts",
    "src/intent/bounded-decision-intake.ts",
    "src/intent/bounded-clear-decision-intake.ts",
    "src/intent/bounded-decision-correction.ts",
    "src/intent/exact-planning-fidelity.ts",
  ].map((path) => resolve(path));
  for (const forbidden of forbiddenModules) {
    assert.equal(
      closure.has(forbidden),
      false,
      `canonical dependency closure must not reach ${relative(process.cwd(), forbidden)}`,
    );
  }

  const canonicalSource = [...closure.entries()]
    .map(([path, source]) => `// ${relative(process.cwd(), path)}\n${source}`)
    .join("\n");
  for (const forbiddenCall of [
    "registerBoundedDecisionIntentIntake(",
    "registerBoundedClearDecisionIntentIntake(",
    "registerBoundedDecisionCorrection(",
    "deriveQualifiedLegacyBoundedRunRequest(",
    "defaultDecisionFixture",
    "laptopFixture",
  ]) {
    assert.equal(
      canonicalSource.includes(forbiddenCall),
      false,
      `canonical dependency closure must not call or reference ${forbiddenCall}`,
    );
  }
});

test("legacy bounded and historical default routes are absent from the canonical Fastify registry", async () => {
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1 });
  try {
    await app.ready();
    const hasPostRoute = (url: string): boolean => app.hasRoute({ method: "POST", url });
    assert.equal(hasPostRoute("/api/v1/prototype/consultations/default"), false);
    assert.equal(hasPostRoute(
      "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/user-messages",
    ), false);
    assert.equal(hasPostRoute(
      "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/clear-user-messages",
    ), false);
    assert.equal(hasPostRoute(
      "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/clarifications/:proposalId/confirm",
    ), false);
    assert.equal(hasPostRoute(
      "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/runs/:runId/corrections",
    ), false);
    assert.equal(hasPostRoute("/api/v1/conversations/:conversationId/turns"), true);
    assert.equal(hasPostRoute(
      "/api/v1/conversations/:conversationId/clarifications/:proposalId/confirm",
    ), true);
  } finally {
    await app.close();
  }
});

test("authoritative Solandra no longer aliases the historical prototype renderer", async () => {
  const source = await readFile("src/ui/solandra-authoritative-conversation-page.ts", "utf8");
  assert.match(source, /renderSolandraConversationPage/u);
  assert.doesNotMatch(source, /solandra-prototype-page/u);
});
