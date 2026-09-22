import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelInvocationProvenance,
  ModelProviderResult,
} from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  ModelSolandraCognitiveRuntime,
  type SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import type {
  SolandraKnowledgePresentationInput,
  SolandraKnowledgePresentationResult,
  SolandraKnowledgePresenter,
} from "../src/solandra/knowledge-presenter.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const MODEL = "consultation-continuation-reliability-model";
const PROVIDER = "consultation-continuation-reliability-provider";
const PRESENTATION_PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "consultation-continuation-presenter",
  requestedModel: "consultation-continuation-presenter",
  actualProvider: "consultation-continuation-presenter",
  actualModel: "consultation-continuation-presenter",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "consultation-continuation-presenter-request",
  routeProvenance: "COMPLETE",
});

type HeldOutCase = Readonly<{
  id: string;
  seed: string;
  followUp: string;
  finding: string;
  sourceLabel: string;
}>;

const HELD_OUT_CASES: readonly HeldOutCase[] = [
  {
    id: "window-heat",
    seed: "Please establish what reliable evidence says about how an insulating window covering can reduce heat transfer at night.",
    followUp: "Can you trace the support for the explanation you just established?",
    finding: "An insulating layer at a window can reduce heat transfer between indoor air and a colder exterior surface.",
    sourceLabel: "Held-out building-physics source",
  },
  {
    id: "garden-moisture",
    seed: "Please establish what reliable evidence says about how surface mulch affects moisture loss from garden soil.",
    followUp: "What was the source basis for the result you gave me a moment ago?",
    finding: "A surface mulch layer can reduce direct evaporation from exposed garden soil.",
    sourceLabel: "Held-out horticulture source",
  },
];

function projection(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: [],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    referencedOptionId: null,
    referencedIntentProposalId: null,
    ...overrides,
  };
}

class TimeoutThenRecoveryProvider implements ModelProvider {
  readonly kind = PROVIDER;
  readonly attempts: number[] = [];
  calls = 0;
  referencedKnowledgeId: string | null = null;

  async generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    this.attempts.push(context.attempt);

    if (this.calls === 2) {
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          context.signal.removeEventListener("abort", onAbort);
          reject(context.signal.reason ?? new Error("Timed model fixture was aborted."));
        };
        if (context.signal.aborted) {
          onAbort();
          return;
        }
        context.signal.addEventListener("abort", onAbort, { once: true });
      });
      throw new Error("Timed model fixture unexpectedly resumed after abort.");
    }

    const semantic = this.calls === 1
      ? projection({
        objectiveRelation: "NEW_OBJECTIVE",
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: ["Establish the requested external factual basis."],
      })
      : projection({
        objectiveRelation: "CONTINUE",
        requestedHelp: "SOURCES_REFERENCE",
        referencedKnowledgeId: this.referencedKnowledgeId,
      });

    return {
      response: {
        id: `continuation-reliability-${this.calls}`,
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({ mode: "GOVERNED", projection: semantic }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `continuation-reliability-${this.calls}`,
      },
    };
  }
}

class StableKnowledgePresenter implements SolandraKnowledgePresenter {
  async present(
    _input: SolandraKnowledgePresentationInput,
  ): Promise<SolandraKnowledgePresentationResult> {
    return {
      status: "PRESENTED",
      text: "I established the available governed Knowledge for this held-out case.",
      invocationProvenance: PRESENTATION_PROVENANCE,
    };
  }
}

function truthPipeline(input: HeldOutCase): OfflineFixtureTruthPipeline {
  const sourceId = `${input.id}-source`;
  const evidenceId = `${input.id}-evidence`;
  const claimId = `${input.id}-claim`;
  return new OfflineFixtureTruthPipeline({
    evidence: [{
      id: evidenceId,
      value: input.finding,
      sourceId,
      sourceLabel: input.sourceLabel,
      admitted: true,
    }],
    truthClaims: [{
      id: claimId,
      text: input.finding,
      claimType: "FACTUAL",
      evidenceIds: [evidenceId],
      scope: "consultation",
      checks: Object.fromEntries(
        requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"]),
      ),
      materiallyMisleading: false,
    }],
    truthEvidence: [{
      evidenceId,
      claimId,
      provenanceComponentKey: sourceId,
      provenanceConfidence: "HIGH",
      relation: "SUPPORTS",
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED",
    }],
  });
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

function clientModelCallDiagnostic(
  header: string | number | string[] | undefined,
): Record<string, unknown> {
  assert.equal(typeof header, "string");
  if (typeof header !== "string") {
    throw new Error("Expected model-call diagnostic response header.");
  }
  const diagnostic = JSON.parse(header) as Record<string, unknown>;
  assert.equal("rateLimitLimitTokens" in diagnostic, false);
  assert.equal("rateLimitRemainingTokens" in diagnostic, false);
  assert.equal("rateLimitResetTokensMs" in diagnostic, false);
  return diagnostic;
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForCompletion(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Held-out continuation Run reached ${status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Held-out continuation Run did not complete.");
}

type ContinuityBody = {
  messages: Array<{
    id: string;
    logicalUserTurnId: string;
    role: "USER" | "SOLANDRA";
    content: string;
  }>;
  runs: Array<{ runId: string }>;
  knowledge: Array<{ knowledgeId: string }>;
  conversationReferences: Array<{
    referenceId: string;
    userMessageId: string;
    parentReferenceId: string | null;
    targets: Array<{ kind: string; relation: string; targetId: string }>;
  }>;
};

async function continuity(app: FastifyInstance, conversationId: string): Promise<ContinuityBody> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/${conversationId}/continuity`,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<ContinuityBody>();
}

test("ordinary governed continuations expose timeout truthfully and exact replay recovers without changing Knowledge", async () => {
  for (const heldOut of HELD_OUT_CASES) {
    const provider = new TimeoutThenRecoveryProvider();
    const cognition = new ModelSolandraCognitiveRuntime(
      new ModelRuntime(provider, { timeoutMs: 40 }),
      MODEL,
      2,
    );
    const app = await createRuntimeApp(config, {
      memoryDispatchDelayMs: 1,
      truthPipeline: truthPipeline(heldOut),
      solandraCognition: cognition,
      solandraKnowledgePresenter: new StableKnowledgePresenter(),
    });

    try {
      const conversationId = await createConversation(app);
      const seedTurnId = randomUUID();
      const seed = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: seedTurnId, message: heldOut.seed },
      });
      assert.equal(seed.statusCode, 202, seed.body);
      const accepted = seed.json<{ status: string; runId: string }>();
      assert.equal(accepted.status, "RUN_ACCEPTED");
      const seedDiagnostic = clientModelCallDiagnostic(
        seed.headers["x-lattice-model-call-diagnostic"],
      );
      assert.equal(seedDiagnostic.outcome, "SUCCESS");
      assert.equal(typeof seedDiagnostic.modelElapsedMs, "number");
      await waitForCompletion(app, accepted.runId);

      const outcome = await app.inject({
        method: "GET",
        url: `/api/v1/runs/${accepted.runId}/outcome`,
      });
      assert.equal(outcome.statusCode, 200, outcome.body);
      const established = outcome.json<{
        knowledgeReference: { knowledgeId: string; referenceId: string };
      }>().knowledgeReference;
      assert.ok(established.knowledgeId);
      assert.ok(established.referenceId);
      provider.referencedKnowledgeId = established.knowledgeId;

      const knowledgeBeforeResponse = await app.inject({
        method: "GET",
        url: `/api/v1/knowledge/${established.knowledgeId}`,
      });
      assert.equal(knowledgeBeforeResponse.statusCode, 200, knowledgeBeforeResponse.body);
      const knowledgeBefore = knowledgeBeforeResponse.json();

      const before = await continuity(app, conversationId);
      const produced = before.conversationReferences.find((reference) =>
        reference.referenceId === established.referenceId);
      assert.ok(produced);
      assert.deepEqual(produced.targets, [{
        kind: "KNOWLEDGE",
        relation: "PRODUCED",
        targetId: established.knowledgeId,
      }]);

      const followUpTurnId = randomUUID();
      const timedOut = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: followUpTurnId, message: heldOut.followUp },
      });
      assert.equal(timedOut.statusCode, 503, timedOut.body);
      assert.deepEqual(timedOut.json(), {
        error: "CONSULTATION_COGNITION_TIMEOUT",
        message: "Solandra's cognition model route did not complete within its bounded runtime budget.",
      });
      const diagnostic = clientModelCallDiagnostic(
        timedOut.headers["x-lattice-model-call-diagnostic"],
      ) as unknown as {
        timeoutPhase: string;
        providerRequestMs: number;
        totalMs: number;
        attemptsStarted: number;
        retryCount: number;
        requestBytes: number;
        maxOutputTokens: number | null;
      };
      assert.equal(diagnostic.timeoutPhase, "PROVIDER_REQUEST");
      assert.equal(diagnostic.attemptsStarted, 1);
      assert.equal(diagnostic.retryCount, 0);
      assert.equal(diagnostic.maxOutputTokens, 1_600);
      assert.ok(diagnostic.providerRequestMs > 0);
      assert.ok(diagnostic.totalMs >= 30);
      assert.ok(diagnostic.requestBytes > 0);
      const serializedDiagnostic = JSON.stringify(diagnostic);
      assert.equal(serializedDiagnostic.includes(heldOut.followUp), false);
      assert.equal(serializedDiagnostic.includes(heldOut.seed), false);
      assert.equal(provider.calls, 2, "logical timeout must remain terminal inside the first failed call");

      const afterTimeout = await continuity(app, conversationId);
      assert.equal(afterTimeout.runs.length, before.runs.length);
      assert.deepEqual(afterTimeout.knowledge, before.knowledge);
      assert.equal(afterTimeout.conversationReferences.length, before.conversationReferences.length);
      const failedMessage = afterTimeout.messages.find((message) =>
        message.logicalUserTurnId === followUpTurnId);
      assert.ok(failedMessage);
      assert.equal(failedMessage.content, heldOut.followUp);

      const unchangedAfterTimeout = await app.inject({
        method: "GET",
        url: `/api/v1/knowledge/${established.knowledgeId}`,
      });
      assert.equal(unchangedAfterTimeout.statusCode, 200, unchangedAfterTimeout.body);
      assert.deepEqual(unchangedAfterTimeout.json(), knowledgeBefore);

      const recovered = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: followUpTurnId, message: heldOut.followUp },
      });
      assert.equal(recovered.statusCode, 200, recovered.body);
      const recoveredBody = recovered.json<{
        status: string;
        knowledgeReference: { knowledgeId: string; referenceId: string };
        presentation: { assistantMessage: string };
      }>();
      assert.equal(recoveredBody.status, "REFERENCE_RESOLVED");
      assert.equal(recoveredBody.knowledgeReference.knowledgeId, established.knowledgeId);
      assert.match(recoveredBody.presentation.assistantMessage, /Sources for that established Knowledge/iu);
      assert.equal(provider.calls, 3, "exact replay after failure must be able to invoke the model route again");
      assert.deepEqual(provider.attempts, [0, 0, 1]);

      const afterRecovery = await continuity(app, conversationId);
      assert.equal(afterRecovery.runs.length, before.runs.length);
      assert.deepEqual(afterRecovery.knowledge, before.knowledge);
      const recoveredMessage = afterRecovery.messages.find((message) =>
        message.logicalUserTurnId === followUpTurnId);
      assert.ok(recoveredMessage);
      const consumed = afterRecovery.conversationReferences.filter((reference) =>
        reference.userMessageId === recoveredMessage.id
        && reference.targets.some((target) =>
          target.kind === "KNOWLEDGE"
          && target.relation === "CONSUMED"
          && target.targetId === established.knowledgeId));
      assert.equal(consumed.length, 1);
      assert.equal(consumed[0]?.referenceId, recoveredBody.knowledgeReference.referenceId);
      assert.equal(consumed[0]?.parentReferenceId, established.referenceId);

      const knowledgeAfterResponse = await app.inject({
        method: "GET",
        url: `/api/v1/knowledge/${established.knowledgeId}`,
      });
      assert.equal(knowledgeAfterResponse.statusCode, 200, knowledgeAfterResponse.body);
      assert.deepEqual(knowledgeAfterResponse.json(), knowledgeBefore);
    } finally {
      await app.close();
    }
  }
});

test("canonical conversation UI distinguishes cognition service failure from a badly written request", async () => {
  const app = await createRuntimeApp(config, {
    truthPipeline: truthPipeline(HELD_OUT_CASES[0]!),
  });
  try {
    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /CONSULTATION_COGNITION_TIMEOUT/u);
    assert.match(
      response.body,
      /model service didn't complete this turn within its current time limit/u,
    );
    assert.match(response.body, /CONSULTATION_COGNITION_UNAVAILABLE/u);
    assert.match(response.body, /model service is temporarily unavailable for this turn/u);
  } finally {
    await app.close();
  }
});
