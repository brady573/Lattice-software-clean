import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import type {
  SolandraKnowledgePresentationInput,
  SolandraKnowledgePresentationResult,
  SolandraKnowledgePresenter,
} from "../src/solandra/knowledge-presenter.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const FINDING = "A stable public interface can reduce upgrade coupling when clients depend on that interface rather than implementation details.";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "m1-deterministic-cognition",
  requestedModel: "m1-deterministic-model",
  actualProvider: "m1-deterministic-cognition",
  actualModel: "m1-deterministic-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "m1-deterministic-request",
  routeProvenance: "COMPLETE",
});

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "m1-evidence",
    value: FINDING,
    sourceId: "m1-source",
    sourceLabel: "M1 governed source",
    admitted: true,
  }],
  truthClaims: [{
    id: "m1-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["m1-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(
      requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"]),
    ),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "m1-evidence",
    claimId: "m1-claim",
    provenanceComponentKey: "m1-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

function proposal(input: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
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
    proposedNextStep: "INVESTIGATE",
    ...input,
  };
}

class StructuralCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const reference = input.governedKnowledge[0]?.knowledgeId ?? null;
    const message = input.message.toLocaleLowerCase("en-US");
    if (message.includes("sources")) {
      return { proposal: proposal({ requestedHelp: "SOURCES_REFERENCE", referencedKnowledgeId: reference, proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE" }), invocationProvenance: PROVENANCE };
    }
    if (message.includes("plain language")) {
      return { proposal: proposal({ requestedHelp: "SIMPLIFY_REFERENCE", referencedKnowledgeId: reference, proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE" }), invocationProvenance: PROVENANCE };
    }
    if (message.includes("which meaning")) {
      return {
        proposal: proposal({
          objectiveRelation: "NEW_OBJECTIVE",
          proposedObjective: "A model-inferred objective that must not become USER intent.",
          materialAmbiguity: {
            question: "Which meaning would materially change the work you want done?",
            couldChangeObjective: true,
          },
          proposedNextStep: "ASK_USER",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: "Model-understood objective wording that is not USER-authored.",
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: ["How interface stability affects upgrade coupling"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class StructuralPresenter implements SolandraKnowledgePresenter {
  readonly inputs: SolandraKnowledgePresentationInput[] = [];

  async present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult> {
    this.inputs.push(structuredClone(input));
    return {
      status: "PRESENTED",
      text: `In plain language, based on the same established Knowledge:\n\n${input.knowledge.findings[0]?.text ?? ""}`,
      invocationProvenance: PROVENANCE,
    };
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

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
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("M1 test Run did not complete.");
}

test("M1 Knowledge establishment is stable under concurrent outcome reads and reference turns reuse it", async () => {
  const cognition = new StructuralCognition();
  const presenter = new StructuralPresenter();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraKnowledgePresenter: presenter,
  });
  try {
    const conversationId = await createConversation(app);
    const userMessage = "How does API compatibility affect client upgrades?";
    const turn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: userMessage },
    });
    assert.equal(turn.statusCode, 202, turn.body);
    const accepted = turn.json<{
      status: string;
      runId: string;
      acceptedUnderstanding: string;
      intentVersionId: string;
      interpretation: { authority: string; knowledgeNeeds: string[] };
    }>();
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.equal(accepted.acceptedUnderstanding, userMessage);
    assert.equal(accepted.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.deepEqual(accepted.interpretation.knowledgeNeeds, ["How interface stability affects upgrade coupling"]);
    await waitForCompletion(app, accepted.runId);

    const [left, right] = await Promise.all([
      app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` }),
      app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` }),
    ]);
    assert.equal(left.statusCode, 200, left.body);
    assert.equal(right.statusCode, 200, right.body);
    const l = left.json<{ knowledgeReference: { knowledgeId: string; referenceId: string }; outcome: { objective: string } }>();
    const r = right.json<{ knowledgeReference: { knowledgeId: string; referenceId: string } }>();
    assert.equal(l.knowledgeReference.knowledgeId, r.knowledgeReference.knowledgeId);
    assert.equal(l.knowledgeReference.referenceId, r.knowledgeReference.referenceId);
    assert.equal(l.outcome.objective, userMessage);

    const addressable = await app.inject({ method: "GET", url: `/api/v1/knowledge/${l.knowledgeReference.knowledgeId}` });
    assert.equal(addressable.statusCode, 200, addressable.body);
    const durable = addressable.json<{
      runId: string;
      intentVersionId: string;
      claimIds: string[];
      evidenceIds: string[];
      sourceIds: string[];
      truthAssessmentIds: string[];
    }>();
    assert.equal(durable.runId, accepted.runId);
    assert.equal(durable.intentVersionId, accepted.intentVersionId);
    assert.equal(durable.claimIds.length, 1);
    assert.equal(durable.evidenceIds.length, 1);
    assert.equal(durable.sourceIds.length, 1);
    assert.equal(durable.truthAssessmentIds.length, 1);

    const sources = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "What are your sources?" },
    });
    assert.equal(sources.statusCode, 200, sources.body);
    const sourceBody = sources.json<{
      status: string;
      knowledgeReference: { knowledgeId: string; referenceId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(sourceBody.status, "REFERENCE_RESOLVED");
    assert.equal(sourceBody.knowledgeReference.knowledgeId, l.knowledgeReference.knowledgeId);
    assert.match(sourceBody.presentation.assistantMessage, /Sources for that established Knowledge/iu);

    const plain = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Put that in plain language." },
    });
    assert.equal(plain.statusCode, 200, plain.body);
    const plainBody = plain.json<{
      status: string;
      knowledgeReference: { knowledgeId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(plainBody.status, "REFERENCE_RESOLVED");
    assert.equal(plainBody.knowledgeReference.knowledgeId, l.knowledgeReference.knowledgeId);
    assert.match(plainBody.presentation.assistantMessage, /same established Knowledge/iu);
    assert.equal(presenter.inputs.length, 1);

    const unchanged = await app.inject({ method: "GET", url: `/api/v1/knowledge/${l.knowledgeReference.knowledgeId}` });
    assert.equal(unchanged.statusCode, 200, unchanged.body);
    assert.deepEqual(unchanged.json(), addressable.json());
  } finally {
    await app.close();
  }
});

test("M1 material model ambiguity asks the USER without promoting inferred objective meaning", async () => {
  const cognition = new StructuralCognition();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
  });
  try {
    const conversationId = await createConversation(app);
    const userMessage = "I need help with a case where which meaning changes what I should investigate.";
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: userMessage },
    });
    assert.equal(response.statusCode, 202, response.body);
    const body = response.json<{
      status: string;
      runId?: string;
      acceptedUnderstanding: string;
      question: string;
      interpretation: { authority: string; proposedObjective: string };
    }>();
    assert.equal(body.status, "NEEDS_CLARIFICATION");
    assert.equal(body.runId, undefined);
    assert.equal(body.acceptedUnderstanding, userMessage);
    assert.equal(body.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.notEqual(body.interpretation.proposedObjective, body.acceptedUnderstanding);
    assert.match(body.question, /materially change/iu);

    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.equal(continuity.json<{ runs: unknown[] }>().runs.length, 0);
  } finally {
    await app.close();
  }
});

test("canonical Solandra client handles direct Knowledge reference and new-Knowledge responses", async () => {
  const app = await createRuntimeApp(config, { truthPipeline });
  try {
    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200, root.body);
    assert.match(root.body, /body\.status === "REFERENCE_RESOLVED"/u);
    assert.match(root.body, /renderOutcome\(body\.knowledge, body\.presentation\)/u);
    assert.match(root.body, /body\.status === "NEEDS_NEW_KNOWLEDGE"/u);

    const missingWorkGuard = root.body.match(/if \(!body\.runId\) throw new Error\("([^"]+)"\);/u);
    assert.ok(missingWorkGuard, "Missing work identity must fail closed in the canonical browser client.");
    const failureCopy = missingWorkGuard[1];
    assert.match(failureCopy, /couldn't establish the requested work safely/iu);
    assert.doesNotMatch(failureCopy, /\bRun\b|provider|worker|queue|database|retry epoch/iu);

    const guardIndex = root.body.indexOf("if (!body.runId) throw new Error(");
    const activeWorkIndex = root.body.indexOf("const work = { conversationId: record.conversationId, runId: body.runId");
    assert.ok(
      guardIndex >= 0 && activeWorkIndex > guardIndex,
      "Browser must reject a missing authoritative work identity before treating the response as active/successful work.",
    );
  } finally {
    await app.close();
  }
});
