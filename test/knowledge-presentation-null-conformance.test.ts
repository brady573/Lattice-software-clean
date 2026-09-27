import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { ModelProviderError } from "../src/model/errors.js";
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
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import {
  ModelSolandraCognitiveRuntime,
  solandraSemanticProposalSchema,
} from "../src/solandra/cognition.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

/**
 * Issue #91: a null knowledgePresentation is the model obeying Lattice's own
 * cognition contract, not a model defect.
 *
 * The contract instructs the model to use null for absent values, and Lattice
 * discards this field entirely for every requestedHelp other than KNOWLEDGE and
 * FRESH_RESEARCH. The schema accepted only an omitted field, so a null rejected
 * an otherwise valid interpretation and surfaced as a failed turn. The live
 * Groq cognition proof failed this way twice at canonical main.
 */

const MODEL = "knowledge-presentation-null-conformance";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "knowledge-presentation-null-provider",
  requestedModel: MODEL,
  actualProvider: "knowledge-presentation-null-provider",
  actualModel: MODEL,
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "knowledge-presentation-null-request",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal>): SolandraSemanticProposal {
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
    ...overrides,
  };
}

class RawProjectionProvider implements ModelProvider {
  readonly kind = "knowledge-presentation-null-provider";

  constructor(private readonly projection: unknown) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "raw-projection-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({ mode: "GOVERNED", projection: this.projection }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "raw-projection-request",
      },
    };
  }
}

const PENDING_PROPOSAL = {
  proposalId: "pending-proposal-1",
  proposalDigest: "a".repeat(64),
  operations: [JSON.stringify({
    op: "SET",
    path: { kind: "OBJECTIVE" },
    value: { state: "VALUE", value: "Plan a quiet reading corner in a shared living room." },
  })],
};

function interpret(projection: unknown): Promise<SolandraCognitionResult> {
  const runtime = new ModelRuntime(new RawProjectionProvider(projection), { timeoutMs: 1_000 });
  return new ModelSolandraCognitiveRuntime(runtime, MODEL, 1).interpret({
    conversationId: "knowledge-presentation-null",
    messageId: "knowledge-presentation-null-message",
    message: "Yes, that is the change I meant.",
    currentObjective: "Keep a small home project recoverable.",
    recentUserMessages: [],
    recentConversation: [],
    governedKnowledge: [],
    governedRecommendations: [],
    pendingIntentProposal: PENDING_PROPOSAL,
  });
}

// The projection the live model returned verbatim at canonical main, from the
// CONFIRM_INTENT continuation that failed the live cognition proof twice.
const LIVE_CONFIRM_INTENT_PROJECTION = {
  objectiveRelation: "CONTINUE",
  proposedObjective: null,
  requestedHelp: "CONFIRM_INTENT",
  knowledgePresentation: null,
  relevantContext: ["Plan a quiet reading corner for my apartment."],
  entities: [],
  referents: [],
  constraints: [],
  preferences: [],
  knowledgeNeeds: [],
  materialAmbiguity: null,
  referencedKnowledgeId: null,
  referencedRecommendationId: null,
  referencedOptionId: null,
  referencedIntentProposalId: "pending-proposal-1",
};

test("a null knowledgePresentation no longer rejects an otherwise valid interpretation", async () => {
  const result = await interpret(LIVE_CONFIRM_INTENT_PROJECTION);
  assert.notEqual((result as { mode?: string }).mode, "CONVERSATION");
  const governed = result as Extract<SolandraCognitionResult, { proposal: SolandraSemanticProposal }>;
  assert.equal(governed.proposal.requestedHelp, "CONFIRM_INTENT");
  assert.equal(governed.proposal.referencedIntentProposalId, "pending-proposal-1");
  assert.equal(governed.proposal.knowledgePresentation, null);
});

test("a null knowledgePresentation resolves to ANSWER at the point of use", () => {
  // Mirrors the Product's own consumption in consultation-intake, where the
  // proposal field is read as `proposal.knowledgePresentation ?? "ANSWER"`.
  const absent: string | null | undefined = null;
  const omitted: string | null | undefined = undefined;
  assert.equal(absent ?? "ANSWER", "ANSWER");
  assert.equal(omitted ?? "ANSWER", "ANSWER");
  const stated: string | null | undefined = "SOURCES";
  assert.equal(stated ?? "ANSWER", "SOURCES");
});

test("an absent, ANSWER, or SOURCES knowledgePresentation keeps its existing meaning", () => {
  const base = LIVE_CONFIRM_INTENT_PROJECTION as Record<string, unknown>;
  const withoutField = { ...base };
  delete withoutField.knowledgePresentation;
  assert.equal(solandraSemanticProposalSchema.safeParse(withoutField).success, true);
  assert.equal(
    solandraSemanticProposalSchema.safeParse({ ...base, knowledgePresentation: "ANSWER" }).success,
    true,
  );
  assert.equal(
    solandraSemanticProposalSchema.safeParse({ ...base, knowledgePresentation: "SOURCES" }).success,
    true,
  );
});

test("a knowledgePresentation outside the accepted form is still rejected", () => {
  const base = LIVE_CONFIRM_INTENT_PROJECTION as Record<string, unknown>;
  for (const invalid of ["SOURCES_REFERENCE", "sources", "BOTH", "", 1, true, {}]) {
    assert.equal(
      solandraSemanticProposalSchema.safeParse({ ...base, knowledgePresentation: invalid }).success,
      false,
      `must still reject ${JSON.stringify(invalid)}`,
    );
  }
});

class NullPresentationCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  constructor(
    private readonly requestedHelp: SolandraSemanticProposal["requestedHelp"],
    private readonly knowledgePresentation: SolandraSemanticProposal["knowledgePresentation"],
  ) {}

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: "An objective Lattice will hold as non-authoritative until governed work requires it.",
        requestedHelp: this.requestedHelp,
        knowledgePresentation: this.knowledgePresentation,
        knowledgeNeeds: ["How a stable interface reduces upgrade coupling"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

const FINDING = "A stable public interface can reduce upgrade coupling when clients depend on that interface rather than implementation details.";

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "knowledge-presentation-null-evidence",
    value: FINDING,
    sourceId: "knowledge-presentation-null-source",
    sourceLabel: "Knowledge presentation conformance fixture",
    admitted: true,
  }],
  truthClaims: [{
    id: "knowledge-presentation-null-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["knowledge-presentation-null-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(
      requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"]),
    ),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "knowledge-presentation-null-evidence",
    claimId: "knowledge-presentation-null-claim",
    provenanceComponentKey: "knowledge-presentation-null-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

async function submitTurn(
  app: FastifyInstance,
  message: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const conversation = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(conversation.statusCode, 201, conversation.body);
  const conversationId = conversation.json<{ conversation: { id: string } }>().conversation.id;
  const turn = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  return { statusCode: turn.statusCode, body: turn.json<Record<string, unknown>>() };
}

test("a turn whose cognition returns a null knowledgePresentation is accepted and defaults to ANSWER", async () => {
  const cognition = new NullPresentationCognition("KNOWLEDGE", null);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
  });
  try {
    const { statusCode, body } = await submitTurn(app, "How does a stable interface help?");
    assert.equal(statusCode, 202, JSON.stringify(body));
    const interpretation = body.interpretation as { authority: string; knowledgePresentation: string };
    assert.equal(interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.equal(
      interpretation.knowledgePresentation,
      "ANSWER",
      "a null preference must resolve to ANSWER, not fail the turn",
    );
  } finally {
    await app.close();
  }
});

test("an explicit SOURCES knowledgePresentation still reaches the run unchanged", async () => {
  const cognition = new NullPresentationCognition("KNOWLEDGE", "SOURCES");
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
  });
  try {
    const { statusCode, body } = await submitTurn(app, "How does a stable interface help?");
    assert.equal(statusCode, 202, JSON.stringify(body));
    const interpretation = body.interpretation as { knowledgePresentation: string };
    assert.equal(interpretation.knowledgePresentation, "SOURCES");
  } finally {
    await app.close();
  }
});

test("a non-KNOWLEDGE proposal cannot change Product behavior through knowledgePresentation", async () => {
  // The public interpretation echoes the model's non-authoritative value, but
  // the run request forces ANSWER for every requestedHelp other than KNOWLEDGE
  // and FRESH_RESEARCH. So for a CONFIRM_INTENT or DECISION continuation the
  // field cannot influence what Lattice actually does, which is why rejecting a
  // null here failed an otherwise valid interpretation over an inert value.
  const cognition = new NullPresentationCognition("DECISION", "SOURCES");
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
  });
  try {
    const { statusCode, body } = await submitTurn(app, "Should I keep the stable interface or rewrite it?");
    assert.equal(statusCode, 202, JSON.stringify(body));
    const interpretation = body.interpretation as { knowledgePresentation: string; requestedHelp: string };
    assert.equal(interpretation.requestedHelp, "DECISION");
    assert.equal(
      interpretation.knowledgePresentation,
      "SOURCES",
      "the public payload remains a faithful non-authoritative echo",
    );

    const runId = body.runId as string;
    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(run.statusCode, 200, run.body);
    const request = run.json<{ request: { knowledgePresentation?: string } }>().request;
    assert.equal(
      request.knowledgePresentation,
      "ANSWER",
      "presentation form is a Knowledge Run concern and must not reach a DECISION Run",
    );
  } finally {
    await app.close();
  }
});

test("the cognition runtime still rejects a projection that references state Lattice did not supply", async () => {
  await assert.rejects(
    interpret({ ...LIVE_CONFIRM_INTENT_PROJECTION, referencedIntentProposalId: "never-supplied" }),
    (error: unknown) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.code, "invalid_output");
      return true;
    },
  );
});

test("the cognition runtime still rejects an unknown requestedHelp", async () => {
  // The schema rejects the projection outright, so the runtime never returns a
  // governed result for it.
  await assert.rejects(
    interpret({ ...LIVE_CONFIRM_INTENT_PROJECTION, requestedHelp: "NOT_A_REAL_HELP" }),
  );
});
