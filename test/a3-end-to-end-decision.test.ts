import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import {
  ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
  AlphaDecisionConsultationInterpreter,
} from "../src/decision/alpha-decision-capability.js";
import { createAlphaDecisionRuntimeComposition } from "../src/decision/alpha-decision-composition.js";
import type { KnowledgeAcquisitionProvider } from "../src/knowledge/acquisition.js";
import {
  AlphaDecisionKnowledgeAcquisitionProvider,
  NpmDecisionKnowledgeAcquisitionProvider,
} from "../src/knowledge/npm-decision-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../src/truth/npm-decision-admission.js";

const fixedNow = "2026-09-06T23:59:00.000Z";
const packageVersions = new Map<string, { version: string; dependencies: Record<string, string> }>([
  ["express", { version: "5.1.0", dependencies: { alpha: "1", beta: "1", gamma: "1" } }],
  ["fastify", { version: "5.6.0", dependencies: { alpha: "1" } }],
]);

function npmFetch(overrides: ReadonlyMap<string, { version: string; dependencies: Record<string, string> }> = packageVersions): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const packageName = decodeURIComponent(parts[0] ?? "").toLocaleLowerCase("en-US");
    const metadata = overrides.get(packageName);
    if (!metadata || parts[1] !== "latest") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      name: packageName,
      version: metadata.version,
      dependencies: metadata.dependencies,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const emptyFallback: KnowledgeAcquisitionProvider = {
  kind: "a3-test-empty-fallback",
  async acquire() {
    return { sources: [], claims: [] };
  },
};

async function createA3App(
  metadata: ReadonlyMap<string, { version: string; dependencies: Record<string, string> }> = packageVersions,
): Promise<FastifyInstance> {
  const npm = new NpmDecisionKnowledgeAcquisitionProvider({
    fetchImpl: npmFetch(metadata),
    clock: () => new Date(fixedNow),
  });
  const truthPipeline = new KnowledgeAcquisitionTruthPipeline(
    new AlphaDecisionKnowledgeAcquisitionProvider(emptyFallback, npm),
    new AlphaDecisionKnowledgeEvidenceAdmissionPolicy(),
  );
  return createRuntimeApp(
    resolveRuntimeConfig({
      PORT: "3000",
      HOST: "127.0.0.1",
      LATTICE_DEPLOYMENT_MODE: "development",
      LATTICE_AUTO_MIGRATE: "false",
      LATTICE_AUTHENTICATION_MODE: "development-fixture",
      LATTICE_TRUTH_MODE: "v36-live",
    }),
    {
      memoryDispatchDelayMs: 1,
      truthPipeline,
      ...createAlphaDecisionRuntimeComposition(),
    },
  );
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForCompletedRun(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Run ${runId} unexpectedly reached ${status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not complete.`);
}

async function submitAndConfirmDecision(app: FastifyInstance, conversationId: string, message: string) {
  const proposed = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: "decision-turn", message },
  });
  assert.equal(proposed.statusCode, 202, proposed.body);
  const pending = proposed.json<{
    status: string;
    proposalId?: string;
    decisionNeed: string;
    intentVersionId: string;
    question: string;
  }>();
  assert.equal(pending.status, "NEEDS_CLARIFICATION");
  assert.ok(pending.proposalId, proposed.body);

  const beforePlan = await app.inject({
    method: "GET",
    url: "/api/v1/runs/not-created-yet/decision-plan",
  });
  assert.equal(beforePlan.statusCode, 404);

  const confirmed = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/clarifications/${pending.proposalId}/confirm`,
    payload: { turnId: "confirmation-turn", message: "Yes, that's correct." },
  });
  assert.equal(confirmed.statusCode, 202, confirmed.body);
  const accepted = confirmed.json<{
    status: string;
    runId: string;
    intentVersionId: string;
    decisionNeed: string;
  }>();
  assert.equal(accepted.status, "RUN_ACCEPTED");
  assert.equal(accepted.decisionNeed, "QUALIFIED");
  assert.notEqual(accepted.intentVersionId, pending.intentVersionId);
  await waitForCompletedRun(app, accepted.runId);
  return { pending, accepted };
}

test("A3 recognizes decision requests but leaves informational comparison on the Knowledge path", async () => {
  const interpreter = new AlphaDecisionConsultationInterpreter();
  const decision = await interpreter.interpret({
    message: "Help me choose between npm packages express and fastify. Fewer runtime dependencies are my top priority.",
    context: [],
  });
  assert.equal(decision.decisionRequested, true);
  assert.ok(decision.materialClarification);

  const knowledge = await interpreter.interpret({
    message: "Tell me the differences between npm packages express and fastify.",
    context: [],
  });
  assert.equal(knowledge.decisionRequested, false);
  assert.equal(knowledge.materialClarification, undefined);
});

test("A3 asks for missing material decision meaning instead of inventing criterion semantics", async () => {
  const app = await createA3App();
  try {
    const conversationId = await createConversation(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "missing-meaning",
        message: "Help me choose between npm packages express and fastify.",
      },
    });
    assert.equal(response.statusCode, 202, response.body);
    const body = response.json<{ status: string; question: string }>();
    assert.equal(body.status, "NEEDS_CLARIFICATION");
    assert.match(body.question, /published runtime dependency count/iu);

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.deepEqual(continuity.json<{ runs: unknown[] }>().runs, []);
  } finally {
    await app.close();
  }
});

test("A3 preserves a confirmed USER hard requirement and lets it eliminate an alternative", async () => {
  const app = await createA3App();
  try {
    const conversationId = await createConversation(app);
    const { accepted } = await submitAndConfirmDecision(
      app,
      conversationId,
      "Help me choose between npm packages express and fastify. I need at most 2 runtime dependencies.",
    );

    const planResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/decision-plan` });
    assert.equal(planResponse.statusCode, 200, planResponse.body);
    const plan = planResponse.json<{ decisionPlan: { intentVersionId: string; planningMaterial: { hardRequirements: Array<{ criterionId: string; operator: string; expected: number }>; priorities: unknown[] } } }>().decisionPlan;
    assert.equal(plan.intentVersionId, accepted.intentVersionId);
    assert.deepEqual(plan.planningMaterial.hardRequirements, [{
      criterionId: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
      criterionVersion: 1,
      operator: "LTE",
      expected: 2,
    }]);
    assert.deepEqual(plan.planningMaterial.priorities, []);

    const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
    const outcome = outcomeResponse.json<{ outcome: { kind: string; selectionAuthorized: boolean; decision: { outcome: string; winnerCandidateId?: string; evaluations: Array<{ candidateId: string; eligible: boolean }> } } }>().outcome;
    assert.equal(outcome.kind, "DECISION_SUPPORT");
    assert.equal(outcome.selectionAuthorized, false);
    assert.equal(outcome.decision.outcome, "RECOMMENDATION");
    assert.equal(outcome.decision.winnerCandidateId, "fastify");
    assert.equal(outcome.decision.evaluations.find((item) => item.candidateId === "express")?.eligible, false);

    const presentation = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/presentation` });
    assert.equal(presentation.statusCode, 200, presentation.body);
    const view = presentation.json<{ presentation: { phase: string; durableUnderstanding: { requirements: Array<{ semanticKey: string; provenance: { kind: string } }> }; nextAction: { outcome: string; winnerCandidateId?: string } } }>().presentation;
    assert.equal(view.phase, "actionable");
    assert.equal(view.durableUnderstanding.requirements[0]?.semanticKey, `${ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID}::max`);
    assert.equal(view.durableUnderstanding.requirements[0]?.provenance.kind, "USER_CONFIRMED");
    assert.equal(view.nextAction.outcome, "RECOMMENDATION");
    assert.equal(view.nextAction.winnerCandidateId, "fastify");
  } finally {
    await app.close();
  }
});

test("A3 preserves a confirmed USER priority and lets existing decision semantics resolve the trade-off", async () => {
  const app = await createA3App();
  try {
    const conversationId = await createConversation(app);
    const { accepted } = await submitAndConfirmDecision(
      app,
      conversationId,
      "Help me choose between npm packages express and fastify. Fewer runtime dependencies are my top priority.",
    );

    const planResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/decision-plan` });
    assert.equal(planResponse.statusCode, 200, planResponse.body);
    const planningMaterial = planResponse.json<{ decisionPlan: { planningMaterial: { hardRequirements: unknown[]; priorities: Array<{ criterionId: string; criterionVersion: number; tier: string }> } } }>().decisionPlan.planningMaterial;
    assert.deepEqual(planningMaterial.hardRequirements, []);
    assert.deepEqual(planningMaterial.priorities, [{
      criterionId: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
      criterionVersion: 1,
      tier: "MATTERS_MOST",
    }]);

    const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
    const outcome = outcomeResponse.json<{ outcome: { selectionAuthorized: boolean; decision: { outcome: string; winnerCandidateId?: string }; explanation: string | null } }>().outcome;
    assert.equal(outcome.selectionAuthorized, false);
    assert.equal(outcome.decision.outcome, "RECOMMENDATION");
    assert.equal(outcome.decision.winnerCandidateId, "fastify");
    assert.match(outcome.explanation ?? "", /requirements and priorities you confirmed/iu);
    assert.match(outcome.explanation ?? "", /qualified preference comparison favors fastify/iu);
    assert.doesNotMatch(outcome.explanation ?? "", /weighted preference score/iu);

    const presentation = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/presentation` });
    const view = presentation.json<{ presentation: { durableUnderstanding: { preferences: Array<{ semanticKey: string; provenance: { kind: string } }> } } }>().presentation;
    assert.equal(view.durableUnderstanding.preferences[0]?.semanticKey, ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID);
    assert.equal(view.durableUnderstanding.preferences[0]?.provenance.kind, "USER_CONFIRMED");
  } finally {
    await app.close();
  }
});

test("A3 preserves a no-winner outcome when admitted evidence shows no meaningful difference", async () => {
  const tied = new Map<string, { version: string; dependencies: Record<string, string> }>([
    ["express", { version: "5.1.0", dependencies: { alpha: "1" } }],
    ["fastify", { version: "5.6.0", dependencies: { alpha: "1" } }],
  ]);
  const app = await createA3App(tied);
  try {
    const conversationId = await createConversation(app);
    const { accepted } = await submitAndConfirmDecision(
      app,
      conversationId,
      "Help me choose between npm packages express and fastify. Fewer runtime dependencies are my top priority.",
    );
    const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
    const outcome = outcomeResponse.json<{ outcome: { selectionAuthorized: boolean; decision: { outcome: string; winnerCandidateId?: string; tiedCandidateIds?: string[] }; explanation: string | null } }>().outcome;
    assert.equal(outcome.selectionAuthorized, false);
    assert.equal(outcome.decision.outcome, "TIE");
    assert.equal(outcome.decision.winnerCandidateId, undefined);
    assert.deepEqual(new Set(outcome.decision.tiedCandidateIds), new Set(["express", "fastify"]));
    assert.match(outcome.explanation ?? "", /no meaningful difference/iu);
  } finally {
    await app.close();
  }
});

test("A3 Knowledge request bypasses DecisionPlan and Decision Engine", async () => {
  const app = await createA3App();
  try {
    const conversationId = await createConversation(app);
    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "knowledge-turn",
        message: "Tell me the differences between npm packages express and fastify.",
      },
    });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const accepted = submitted.json<{ status: string; decisionNeed: string; runId: string }>();
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.equal(accepted.decisionNeed, "NONE");
    await waitForCompletedRun(app, accepted.runId);

    const plan = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/decision-plan` });
    assert.equal(plan.statusCode, 404);
    const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
    assert.equal(outcomeResponse.json<{ outcome: { kind: string } }>().outcome.kind, "KNOWLEDGE");
  } finally {
    await app.close();
  }
});
