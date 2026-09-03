import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import ts from "typescript";
import { createRuntimeApp } from "../src/runtime-app.js";
import { buildLegacyTestApp } from "../src/legacy/legacy-test-app.js";
import { buildDevelopmentPrototypeApp } from "../src/development/development-prototype-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { createStandaloneRunWorker, type StandaloneRunWorker } from "../src/run-worker-process.js";
import { isConsultationRunRequest, type LatticeRunRequest } from "../src/domain.js";
import {
  ACTION_MESSAGE,
  DECISION_MESSAGE,
  FoundationalConsultationInterpreter,
  KNOWLEDGE_MESSAGE,
  createFoundationalTruthComposition,
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
    ...createFoundationalTruthComposition(),
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
    assert.equal(knowledgePlan.statusCode, 404, knowledgePlan.body);

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
    assert.equal(actionPlan.statusCode, 404, actionPlan.body);
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
          objectiveEffect: input.currentIntentVersion
            ? { kind: "PRESERVE" as const }
            : { kind: "ESTABLISH" as const, value: input.message.trim() },
          meaningKind: "ADDITIONAL_CONTEXT" as const,
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

test("ordinary conversational follow-ups preserve the authoritative objective", async () => {
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1 });
  try {
    const conversationId = await createConversation(app);
    const objective = "Explain how volcanic islands form.";
    const initial = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "objective-initial", message: objective },
    });
    assert.equal(initial.statusCode, 202, initial.body);
    const initialIntentVersionId = initial.json().intentVersionId as string;

    for (const [index, followUp] of [
      "why?",
      "show me the sources",
      "what about the other option?",
      "tell me more",
      "actually, what did that source say?",
    ].entries()) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: `follow-up-${index}`, message: followUp },
      });
      assert.equal(response.statusCode, 202, response.body);
      assert.equal(response.json().intentVersionId, initialIntentVersionId);
      assert.equal(response.json().acceptedUnderstanding, objective);
      const run = await app.inject({ method: "GET", url: `/api/v1/runs/${response.json().runId}` });
      assert.equal(run.statusCode, 200, run.body);
      assert.equal(run.json().request.objective, objective);
      assert.deepEqual(run.json().request.context, [followUp]);
      assert.equal(run.json().request.sourceMessageId, response.json().provenance.messageId);
      await waitForCompletedRun(app, response.json().runId);
      const outcome = await app.inject({
        method: "GET",
        url: `/api/v1/runs/${response.json().runId}/outcome`,
      });
      assert.equal(outcome.statusCode, 200, outcome.body);
      assert.equal(outcome.json().outcome.objective, objective);
    }
  } finally {
    await app.close();
  }
});

test("qualified follow-up context remains Run-usable without entering IntentVersion or DecisionPlan authority", async () => {
  const explanationFollowUp = "Why is that recommendation supported?";
  const foundationalInterpreter = new FoundationalConsultationInterpreter();
  const truthComposition = createFoundationalTruthComposition();
  const investigatedRequests: LatticeRunRequest[] = [];
  const truthPipeline = new Proxy(truthComposition.truthPipeline, {
    get(target, property) {
      if (property === "investigate") {
        return async (runId: string, request?: LatticeRunRequest) => {
          if (request) investigatedRequests.push(structuredClone(request));
          return target.investigate(runId, request);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    ...truthComposition,
    truthPipeline,
    criterionCatalog: foundationalCriterionCatalog,
    consultationInterpreter: {
      async interpret(input) {
        if (input.message.trim() === explanationFollowUp) {
          return {
            objectiveEffect: { kind: "PRESERVE" as const },
            meaningKind: "RESOURCE_OR_EXPLANATION_REQUEST" as const,
            decisionRequested: true,
            resourceNeed: "NONE" as const,
          };
        }
        return foundationalInterpreter.interpret(input);
      },
    },
  });
  try {
    const conversationId = await createConversation(app);
    const pending = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "decision-with-follow-up", message: DECISION_MESSAGE },
    });
    assert.equal(pending.statusCode, 202, pending.body);
    assert.equal(pending.json().status, "NEEDS_CLARIFICATION");

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/clarifications/${pending.json().proposalId}/confirm`,
      payload: { turnId: "decision-with-follow-up-confirm", message: "Yes, that's correct." },
    });
    assert.equal(confirmed.statusCode, 202, confirmed.body);
    assert.equal(confirmed.json().decisionNeed, "QUALIFIED");
    const authoritativeIntentVersionId = confirmed.json().intentVersionId as string;
    await waitForCompletedRun(app, confirmed.json().runId);

    const followUp = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "decision-explanation-follow-up", message: explanationFollowUp },
    });
    assert.equal(followUp.statusCode, 202, followUp.body);
    assert.equal(followUp.json().decisionNeed, "QUALIFIED");
    assert.equal(followUp.json().intentVersionId, authoritativeIntentVersionId);
    assert.equal(followUp.json().acceptedUnderstanding, DECISION_MESSAGE);

    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${followUp.json().runId}` });
    assert.equal(run.statusCode, 200, run.body);
    assert.equal(run.json().request.objective, DECISION_MESSAGE);
    assert.deepEqual(run.json().request.context, [explanationFollowUp]);

    const plan = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${followUp.json().runId}/decision-plan`,
    });
    assert.equal(plan.statusCode, 200, plan.body);
    assert.equal(plan.json().decisionPlan.intentVersionId, authoritativeIntentVersionId);
    assert.equal("context" in plan.json().decisionPlan.planningMaterial, false);

    await waitForCompletedRun(app, followUp.json().runId);
    const outcome = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${followUp.json().runId}/outcome`,
    });
    assert.equal(outcome.statusCode, 200, outcome.body);
    assert.equal(outcome.json().outcome.kind, "DECISION_SUPPORT");
    const investigatedFollowUp = investigatedRequests.find((request) => (
      isConsultationRunRequest(request) && request.sourceMessageId === followUp.json().provenance.messageId
    ));
    assert.ok(investigatedFollowUp && isConsultationRunRequest(investigatedFollowUp));
    assert.equal(investigatedFollowUp.objective, DECISION_MESSAGE);
    assert.deepEqual(investigatedFollowUp.context, [explanationFollowUp]);
  } finally {
    await app.close();
  }
});

test("explicit objective correction creates a successor and supersedes a pending material proposal", async () => {
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    ...createFoundationalTruthComposition(),
    consultationInterpreter: new FoundationalConsultationInterpreter(),
    criterionCatalog: foundationalCriterionCatalog,
  });
  try {
    const conversationId = await createConversation(app);
    const pending = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "correction-initial", message: DECISION_MESSAGE },
    });
    assert.equal(pending.statusCode, 202, pending.body);
    assert.equal(pending.json().status, "NEEDS_CLARIFICATION");

    const correctedObjective = "Explain reliable long-term preservation principles instead.";
    const correction = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "correction-turn", message: `No, actually ${correctedObjective}` },
    });
    assert.equal(correction.statusCode, 202, correction.body);
    assert.notEqual(correction.json().intentVersionId, pending.json().intentVersionId);
    assert.equal(correction.json().acceptedUnderstanding, correctedObjective);
    await waitForCompletedRun(app, correction.json().runId);
    const continued = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${correction.json().runId}/outcome`,
    });
    assert.equal(continued.statusCode, 200, continued.body);
    assert.equal(continued.json().outcome.kind, "KNOWLEDGE");
    assert.equal(continued.json().outcome.acceptedUnderstanding, correctedObjective);

    const staleConfirmation = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/clarifications/${pending.json().proposalId}/confirm`,
      payload: { turnId: "stale-confirmation", message: "Yes, that's correct." },
    });
    assert.equal(staleConfirmation.statusCode, 409, staleConfirmation.body);
    assert.equal(staleConfirmation.json().error, "CLARIFICATION_STALE");
  } finally {
    await app.close();
  }
});

test("decision qualification accepts valid requirement-only and preference-only projections", async () => {
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    ...createFoundationalTruthComposition(),
    criterionCatalog: foundationalCriterionCatalog,
    consultationInterpreter: {
      async interpret(input) {
        const requirementOnly = input.message.includes("constraint-only");
        return {
          objectiveEffect: input.currentIntentVersion
            ? { kind: "PRESERVE" as const }
            : { kind: "ESTABLISH" as const, value: input.message.trim() },
          meaningKind: "MATERIAL_INFERENCE" as const,
          decisionRequested: true,
          resourceNeed: "NONE" as const,
          materialClarification: {
            operations: requirementOnly
              ? [{
                  op: "SET" as const,
                  path: { kind: "REQUIREMENT" as const, key: "cost::max" },
                  value: { state: "VALUE" as const, value: 100 },
                }]
              : [{
                  op: "SET" as const,
                  path: { kind: "PREFERENCE" as const, key: "throughput" },
                  value: { state: "VALUE" as const, value: "IMPORTANT" },
                }],
            question: "Confirm the explicit decision semantics?",
            confirmationExample: "Yes.",
          },
        };
      },
    },
  });
  try {
    for (const [suffix, message] of [
      ["requirement", "Use a constraint-only decision projection."],
      ["preference", "Use a comparative preference-only decision projection."],
    ]) {
      const conversationId = await createConversation(app);
      const pending = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: `${suffix}-turn`, message },
      });
      assert.equal(pending.statusCode, 202, pending.body);
      const accepted = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/clarifications/${pending.json().proposalId}/confirm`,
        payload: { turnId: `${suffix}-confirm`, message: "Yes." },
      });
      assert.equal(accepted.statusCode, 202, accepted.body);
      assert.equal(accepted.json().decisionNeed, "QUALIFIED");
      const plan = await app.inject({
        method: "GET",
        url: `/api/v1/runs/${accepted.json().runId}/decision-plan`,
      });
      assert.equal(plan.statusCode, 200, plan.body);
    }
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
    ...createFoundationalTruthComposition(),
    consultationInterpreter: new FoundationalConsultationInterpreter(),
    criterionCatalog: foundationalCriterionCatalog,
  });
  let worker: StandaloneRunWorker | undefined;
  let conversationId: string | undefined;
  let runId: string | undefined;
  let followUpRunId: string | undefined;
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
      ...createFoundationalTruthComposition(),
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

    const followUpMessage = "Why is that recommendation supported?";
    const followUp = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: `pg-follow-up-${randomUUID()}`, message: followUpMessage },
    });
    assert.equal(followUp.statusCode, 202, followUp.body);
    assert.equal(followUp.json().intentVersionId, accepted.json().intentVersionId);
    assert.equal(followUp.json().acceptedUnderstanding, DECISION_MESSAGE);
    followUpRunId = followUp.json().runId as string;

    const persistedFollowUp = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${followUpRunId}`,
    });
    assert.equal(persistedFollowUp.statusCode, 200, persistedFollowUp.body);
    assert.equal(persistedFollowUp.json().request.objective, DECISION_MESSAGE);
    assert.deepEqual(persistedFollowUp.json().request.context, [followUpMessage]);

    const followUpPlan = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${followUpRunId}/decision-plan`,
    });
    assert.equal(followUpPlan.statusCode, 404, followUpPlan.body);
    await waitForCompletedRun(app, followUpRunId);
  } finally {
    await worker?.close();
    await app.close();
    if (followUpRunId) await pool.query("DELETE FROM runs WHERE id=$1", [followUpRunId]);
    if (runId) await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    if (conversationId) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    await pool.end();
  }
});

function relativeDependencies(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dependencies: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text.startsWith(".")
    ) {
      dependencies.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteral(argument)) {
        throw new Error(`canonical runtime uses a constructed dynamic import in ${relative(process.cwd(), path)}`);
      }
      if (argument.text.startsWith(".")) dependencies.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return dependencies;
}

async function canonicalDependencyClosure(entrypoints: readonly string[]): Promise<Map<string, string>> {
  const canonicalSourceRoot = resolve("src");
  const pending = entrypoints.map((entrypoint) => resolve(entrypoint));
  const visited = new Map<string, string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    const source = await readFile(path, "utf8");
    visited.set(path, source);
    for (const specifier of relativeDependencies(path, source)) {
      if (specifier.endsWith(".json")) continue;
      const resolved = resolve(dirname(path), specifier.replace(/\.js$/u, ".ts"));
      const runtimeRelativePath = relative(canonicalSourceRoot, resolved);
      if (
        runtimeRelativePath === ".."
        || runtimeRelativePath.startsWith(`..${sep}`)
        || isAbsolute(runtimeRelativePath)
      ) {
        throw new Error(
          `canonical runtime imports a non-runtime local dependency: ${relative(process.cwd(), resolved)}`,
        );
      }
      pending.push(resolved);
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
    "test/fixtures/legacy-laptop-fixture.ts",
    "test/fixtures/legacy-bounded-decision-intake.ts",
    "test/fixtures/legacy-bounded-clear-decision-intake.ts",
    "test/fixtures/legacy-bounded-decision-correction.ts",
    "test/fixtures/legacy-exact-planning-fidelity.ts",
    "src/legacy/legacy-test-app.ts",
    "src/development/development-prototype-app.ts",
    "src/development/development-runtime-app.ts",
    "src/prototype/android-model-prototype.ts",
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
    "buildLegacyTestApp(",
    "buildDevelopmentPrototypeApp(",
    "createDevelopmentRuntimeApp(",
    "registerAndroidModelPrototype(",
  ]) {
    assert.equal(
      canonicalSource.includes(forbiddenCall),
      false,
      `canonical dependency closure must not call or reference ${forbiddenCall}`,
    );
  }

  for (const removedRuntimeModule of forbiddenModules.slice(0, 5)) {
    await assert.rejects(
      readFile(removedRuntimeModule, "utf8"),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
      `${relative(process.cwd(), removedRuntimeModule)} must not remain runtime source`,
    );
  }
});

test("Example Firewall dependency analysis cannot be bypassed by aliases or constructed imports", () => {
  assert.deepEqual(
    relativeDependencies(
      resolve("src/synthetic-canonical.ts"),
      'import { registerBoundedDecisionIntentIntake as harmlessName } from "./intent/bounded-decision-intake.js";',
    ),
    ["./intent/bounded-decision-intake.js"],
  );
  assert.throws(
    () => relativeDependencies(
      resolve("src/synthetic-canonical.ts"),
      'const moduleName = "./intent/" + "bounded-decision-intake.js"; void import(moduleName);',
    ),
    /constructed dynamic import/,
  );
});

test("legacy bounded and historical default routes are absent from the canonical Fastify registry", async () => {
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1 });
  try {
    await app.ready();
    const hasPostRoute = (url: string): boolean => app.hasRoute({ method: "POST", url });
    assert.equal(hasPostRoute("/api/v1/prototype/consultations/default"), false);
    assert.equal(hasPostRoute("/runs"), false);
    assert.equal(app.hasRoute({ method: "GET", url: "/runs/:id" }), false);
    assert.equal(hasPostRoute("/api/v1/conversations/:conversationId/messages"), false);
    assert.equal(hasPostRoute(
      "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/versions/:intentVersionId/runs",
    ), false);
    assert.equal(hasPostRoute("/api/v1/prototype/model-conversations/:conversationId/messages"), false);
    assert.equal(hasPostRoute("/api/v1/prototype/android-model-conversations/:conversationId/messages"), false);
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

test("legacy and simulated routes require explicit non-canonical composition", async () => {
  const legacy = buildLegacyTestApp();
  const development = buildDevelopmentPrototypeApp();
  try {
    await Promise.all([legacy.ready(), development.ready()]);
    assert.equal(legacy.hasRoute({ method: "POST", url: "/runs" }), true);
    assert.equal(legacy.hasRoute({ method: "GET", url: "/runs/:id" }), true);
    assert.equal(legacy.hasRoute({
      method: "POST",
      url: "/api/v1/conversations/:conversationId/messages",
    }), true);
    assert.equal(development.hasRoute({
      method: "POST",
      url: "/api/v1/prototype/model-conversations/:conversationId/messages",
    }), true);
    assert.equal(legacy.hasRoute({
      method: "POST",
      url: "/api/v1/prototype/model-conversations/:conversationId/messages",
    }), false);
  } finally {
    await Promise.all([legacy.close(), development.close()]);
  }
});

test("authoritative Solandra no longer aliases the historical prototype renderer", async () => {
  const source = await readFile("src/ui/solandra-authoritative-conversation-page.ts", "utf8");
  assert.match(source, /renderSolandraConversationPage/u);
  assert.doesNotMatch(source, /solandra-prototype-page/u);
});
