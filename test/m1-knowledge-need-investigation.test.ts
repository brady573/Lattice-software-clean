import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigationPlanningInput,
  type KnowledgeInvestigator,
  type KnowledgeResponsivenessInput,
} from "../src/knowledge/investigation.js";
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
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const USER_OBJECTIVE = "I'm trying to understand why a public software interface can make client upgrades less brittle.";
const FIRST_NEED = "Understand which compatibility properties reduce upgrade coupling.";
const FRESH_NEED = "Refresh the evidence about versioned compatibility contracts.";
const FIRST_QUERY = "public API compatibility contracts client upgrade coupling";
const FRESH_QUERY = "versioned public API compatibility contracts client upgrades";
const FIRST_FINDING = "A stable public software interface can make client upgrades less brittle because clients depend on the public contract rather than implementation details.";
const FRESH_FINDING = "A versioned public interface can reduce client upgrade coupling because compatibility changes are made explicit at the contract boundary.";
const MODEL_ONLY_GUESS = "The model guesses that public interfaces always eliminate upgrade failures.";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "m1-semantic-fixture",
  requestedModel: "m1-semantic-fixture-model",
  actualProvider: "m1-semantic-fixture",
  actualModel: "m1-semantic-fixture-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "m1-semantic-fixture-request",
  routeProvenance: "COMPLETE",
});

function proposal(input: Partial<SolandraSemanticProposal>): SolandraSemanticProposal {
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

class JourneyCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const normalized = input.message.toLocaleLowerCase("en-US");
    if (normalized.includes("sources")) {
      const prior = input.governedKnowledge[0]?.knowledgeId ?? null;
      return {
        proposal: proposal({
          requestedHelp: "SOURCES_REFERENCE",
          referencedKnowledgeId: prior,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (normalized.includes("plain language")) {
      const prior = input.governedKnowledge[0]?.knowledgeId ?? null;
      return {
        proposal: proposal({
          requestedHelp: "SIMPLIFY_REFERENCE",
          referencedKnowledgeId: prior,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (normalized.includes("research it again")) {
      return {
        proposal: proposal({
          requestedHelp: "FRESH_RESEARCH",
          relevantContext: [MODEL_ONLY_GUESS],
          knowledgeNeeds: [FRESH_NEED],
          proposedNextStep: "INVESTIGATE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: "Model-normalized wording that must not replace the USER objective.",
        relevantContext: [MODEL_ONLY_GUESS],
        knowledgeNeeds: [FIRST_NEED],
        proposedNextStep: "INVESTIGATE",
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class RecordingInvestigator implements KnowledgeInvestigator {
  readonly kind = "m1-recording-solandra-investigator";
  readonly planningInputs: KnowledgeInvestigationPlanningInput[] = [];
  readonly responsivenessInputs: KnowledgeResponsivenessInput[] = [];

  async plan(input: KnowledgeInvestigationPlanningInput) {
    this.planningInputs.push(structuredClone(input));
    return {
      retrievalQueries: input.knowledgeNeeds.includes(FRESH_NEED) ? [FRESH_QUERY] : [FIRST_QUERY],
    };
  }

  async selectResponsive(input: KnowledgeResponsivenessInput) {
    this.responsivenessInputs.push(structuredClone(input));
    return {
      selections: input.claims.map((claim) => ({
        claimId: claim.claimId,
        sourceIds: claim.evidence.map((item) => item.sourceId),
      })),
    };
  }
}

class RecordingAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "m1-recording-source";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    const fresh = request.investigationQueries?.includes(FRESH_QUERY) === true;
    const text = fresh ? FRESH_FINDING : FIRST_FINDING;
    const suffix = fresh ? "fresh" : "initial";
    return {
      sources: [{
        sourceId: `m1-${suffix}-source`,
        canonicalUri: `https://example.test/m1-${suffix}`,
        title: `M1 ${suffix} source`,
        publisher: "M1 fixture publisher",
        retrievedAt: "2026-09-07T00:00:00.000Z",
        publishedAt: null,
        contentType: "text/plain",
        content: text,
      }],
      claims: [{
        claimId: `m1-${suffix}-claim`,
        text,
        claimType: "FACTUAL",
        evidence: [{
          sourceId: `m1-${suffix}-source`,
          relation: "SUPPORTS",
          excerpt: text,
        }],
      }],
    };
  }
}

class SameKnowledgePresenter implements SolandraKnowledgePresenter {
  async present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult> {
    return {
      status: "PRESENTED",
      text: `In plain language, using the same Knowledge: ${input.knowledge.findings[0]?.text ?? ""}`,
      invocationProvenance: PROVENANCE,
    };
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForOutcome(app: FastifyInstance, runId: string) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(run.statusCode, 200, run.body);
    const status = run.json<{ status: string }>().status;
    if (status === "COMPLETED") {
      const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(outcome.statusCode, 200, outcome.body);
      return outcome;
    }
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("M1 Knowledge-need Run did not complete.");
}

test("Solandra Knowledge needs remain conceptual while Solandra investigation owns retrieval and responsiveness", async () => {
  const cognition = new JourneyCognition();
  const investigator = new RecordingInvestigator();
  const rawProvider = new RecordingAcquisitionProvider();
  const truthPipeline = new KnowledgeAcquisitionTruthPipeline(
    new RelevantKnowledgeAcquisitionProvider(rawProvider, investigator),
  );
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraKnowledgePresenter: new SameKnowledgePresenter(),
  });

  try {
    const conversationId = await createConversation(app);
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: USER_OBJECTIVE },
    });
    assert.equal(first.statusCode, 202, first.body);
    const accepted = first.json<{
      status: string;
      runId: string;
      acceptedUnderstanding: string;
      intentVersionId: string;
      interpretation: { authority: string; proposedObjective: string; knowledgeNeeds: string[] };
    }>();
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.equal(accepted.acceptedUnderstanding, USER_OBJECTIVE);
    assert.equal(accepted.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.notEqual(accepted.interpretation.proposedObjective, accepted.acceptedUnderstanding);
    assert.deepEqual(accepted.interpretation.knowledgeNeeds, [FIRST_NEED]);

    const runBeforeCompletion = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}` });
    assert.equal(runBeforeCompletion.statusCode, 200, runBeforeCompletion.body);
    const request = runBeforeCompletion.json<{
      request: { objective: string; investigationQueries: string[] };
    }>().request;
    assert.equal(request.objective, USER_OBJECTIVE);
    assert.deepEqual(request.investigationQueries, [FIRST_NEED]);

    const outcome = await waitForOutcome(app, accepted.runId);
    assert.equal(investigator.planningInputs.length, 1);
    assert.deepEqual(investigator.planningInputs[0]?.knowledgeNeeds, [FIRST_NEED]);
    assert.equal(rawProvider.requests.length, 1);
    assert.equal(rawProvider.requests[0]?.objective, USER_OBJECTIVE);
    assert.deepEqual(rawProvider.requests[0]?.investigationQueries, [FIRST_QUERY]);
    assert.notDeepEqual(rawProvider.requests[0]?.investigationQueries, request.investigationQueries);
    assert.equal(investigator.responsivenessInputs.length, 1);
    assert.deepEqual(investigator.responsivenessInputs[0]?.retrievalQueries, [FIRST_QUERY]);
    const initial = outcome.json<{
      outcome: { objective: string; findings: Array<{ text: string }> };
      knowledgeReference: { knowledgeId: string; referenceId: string };
    }>();
    assert.equal(initial.outcome.objective, USER_OBJECTIVE);
    assert.equal(initial.outcome.findings[0]?.text, FIRST_FINDING);
    assert.equal(initial.outcome.findings.some((finding) => finding.text.includes(MODEL_ONLY_GUESS)), false);

    const sources = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "What are your sources?" },
    });
    assert.equal(sources.statusCode, 200, sources.body);
    const sourceBody = sources.json<{
      status: string;
      knowledgeReference: { knowledgeId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(sourceBody.status, "REFERENCE_RESOLVED");
    assert.equal(sourceBody.knowledgeReference.knowledgeId, initial.knowledgeReference.knowledgeId);
    assert.match(sourceBody.presentation.assistantMessage, /https:\/\/example\.test\/m1-initial/u);
    assert.equal(rawProvider.requests.length, 1, "historical provenance must not reacquire");

    const plain = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Put that in plain language." },
    });
    assert.equal(plain.statusCode, 200, plain.body);
    assert.equal(plain.json<{ knowledgeReference: { knowledgeId: string } }>().knowledgeReference.knowledgeId, initial.knowledgeReference.knowledgeId);
    assert.equal(rawProvider.requests.length, 1, "referential presentation must not reacquire");

    const freshTurn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Research it again with fresh investigation." },
    });
    assert.equal(freshTurn.statusCode, 202, freshTurn.body);
    const freshAccepted = freshTurn.json<{ runId: string; acceptedUnderstanding: string; intentVersionId: string }>();
    assert.equal(freshAccepted.acceptedUnderstanding, USER_OBJECTIVE);
    assert.equal(freshAccepted.intentVersionId, accepted.intentVersionId);
    const freshRun = await app.inject({ method: "GET", url: `/api/v1/runs/${freshAccepted.runId}` });
    assert.deepEqual(freshRun.json<{ request: { investigationQueries: string[] } }>().request.investigationQueries, [FRESH_NEED]);
    const freshOutcome = await waitForOutcome(app, freshAccepted.runId);
    assert.equal(rawProvider.requests.length, 2);
    assert.deepEqual(investigator.planningInputs[1]?.knowledgeNeeds, [FRESH_NEED]);
    assert.deepEqual(rawProvider.requests[1]?.investigationQueries, [FRESH_QUERY]);
    const fresh = freshOutcome.json<{
      outcome: { findings: Array<{ text: string }> };
      knowledgeReference: { knowledgeId: string };
    }>();
    assert.equal(fresh.outcome.findings[0]?.text, FRESH_FINDING);
    assert.notEqual(fresh.knowledgeReference.knowledgeId, initial.knowledgeReference.knowledgeId);
  } finally {
    await app.close();
  }
});
