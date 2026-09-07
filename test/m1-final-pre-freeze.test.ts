import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { isConsultationRunRequest } from "../src/domain.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { PostgresKnowledgeRecordStore } from "../src/knowledge/knowledge-record-store.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelInvocationProvenance,
  ModelProviderResult,
} from "../src/model/types.js";
import type { KnowledgeOutcome } from "../src/outcome.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { executePersistedRun } from "../src/run-execution.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import {
  ModelSolandraKnowledgePresenter,
  type SolandraKnowledgePresentationInput,
  type SolandraKnowledgePresentationResult,
  type SolandraKnowledgePresenter,
} from "../src/solandra/knowledge-presenter.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;
const FINDING = "A stable public interface can reduce upgrade coupling when clients depend on that interface rather than implementation details.";
const KNOWLEDGE_NEED = "public interface stability upgrade coupling";
const FIXED_TIME = "2026-09-07T03:30:00.000Z";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "m1-final-fixture",
  requestedModel: "m1-final-model",
  actualProvider: "m1-final-fixture",
  actualModel: "m1-final-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "m1-final-fixture-request",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
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
    ...overrides,
  };
}

class RestartCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const knowledgeId = input.governedKnowledge[0]?.knowledgeId ?? null;
    if (input.message === "Show me the sources behind that.") {
      return {
        proposal: proposal({
          requestedHelp: "SOURCES_REFERENCE",
          referencedKnowledgeId: knowledgeId,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (input.message === "Explain that more plainly.") {
      return {
        proposal: proposal({
          requestedHelp: "SIMPLIFY_REFERENCE",
          referencedKnowledgeId: knowledgeId,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: "Model wording remains non-authoritative.",
        knowledgeNeeds: [KNOWLEDGE_NEED],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class RestartPresenter implements SolandraKnowledgePresenter {
  readonly inputs: SolandraKnowledgePresentationInput[] = [];

  async present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult> {
    this.inputs.push(structuredClone(input));
    return {
      status: "PRESENTED",
      text: `Based on the same established Knowledge: ${input.knowledge.findings[0]?.text ?? ""}`,
      invocationProvenance: PROVENANCE,
    };
  }
}

class RecordingAcquisition implements KnowledgeAcquisitionProvider {
  readonly kind = "m1-postgres-restart-recording-provider";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "m1-restart-source",
        canonicalUri: "https://durable.example/interface-stability",
        title: "Durable interface stability source",
        publisher: "Durable Example",
        retrievedAt: FIXED_TIME,
        publishedAt: "2026-08-20T00:00:00.000Z",
        contentType: "text/plain",
        content: FINDING,
      }],
      claims: [{
        claimId: "m1-restart-claim",
        text: FINDING,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "m1-restart-source", relation: "SUPPORTS", excerpt: FINDING }],
      }],
    };
  }
}

function postgresConfig(autoMigrate: boolean) {
  assert.ok(databaseUrl);
  return resolveRuntimeConfig({
    DATABASE_URL: databaseUrl,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: String(autoMigrate),
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m1-postgres-restart-user",
  } as NodeJS.ProcessEnv);
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

test("M1 PostgreSQL reconstruction preserves exact Knowledge identity, provenance, and reference reuse without reacquisition", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const acquisition = new RecordingAcquisition();
  const pipeline = new KnowledgeAcquisitionTruthPipeline(acquisition);
  const cognition = new RestartCognition();
  const presenter = new RestartPresenter();
  const pool = new Pool({ connectionString: databaseUrl });
  let first: FastifyInstance | undefined;
  let second: FastifyInstance | undefined;
  let executionStore: PostgresRunStore | undefined;
  let runStore: PostgresRunStore | undefined;
  let knowledgeStore: PostgresKnowledgeRecordStore | undefined;
  let conversationId = "";
  let runId = "";
  let intentScopeId = "";
  let intentVersionId = "";

  try {
    first = await createRuntimeApp(postgresConfig(true), {
      truthPipeline: pipeline,
      solandraCognition: cognition,
      solandraKnowledgePresenter: presenter,
    });
    conversationId = await createConversation(first);
    const userMessage = "Help me understand how a stable public interface affects upgrade coupling.";
    const turn = await first.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: userMessage },
    });
    assert.equal(turn.statusCode, 202, turn.body);
    const accepted = turn.json<{
      runId: string;
      intentScopeId: string;
      intentVersionId: string;
      acceptedUnderstanding: string;
      interpretation: { authority: string; knowledgeNeeds: string[] };
    }>();
    runId = accepted.runId;
    intentScopeId = accepted.intentScopeId;
    intentVersionId = accepted.intentVersionId;
    assert.equal(accepted.acceptedUnderstanding, userMessage);
    assert.equal(accepted.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.deepEqual(accepted.interpretation.knowledgeNeeds, [KNOWLEDGE_NEED]);

    executionStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    assert.equal((await executePersistedRun(executionStore, pipeline, runId)).status, "COMPLETED");
    assert.equal(acquisition.requests.length, 1);
    assert.deepEqual(acquisition.requests[0]?.investigationQueries, [KNOWLEDGE_NEED]);

    const outcome = await first.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.equal(outcome.statusCode, 200, outcome.body);
    const knowledgeId = outcome.json<{ knowledgeReference: { knowledgeId: string } }>().knowledgeReference.knowledgeId;
    const beforeResponse = await first.inject({ method: "GET", url: `/api/v1/knowledge/${knowledgeId}` });
    assert.equal(beforeResponse.statusCode, 200, beforeResponse.body);
    const before = beforeResponse.json<{
      knowledgeId: string;
      runId: string;
      intentVersionId: string;
      claimIds: string[];
      sourceIds: string[];
      evidenceIds: string[];
      truthAssessmentIds: string[];
    }>();
    assert.equal(before.runId, runId);
    assert.equal(before.intentVersionId, intentVersionId);
    assert.equal(before.claimIds.length, 1);
    assert.equal(before.sourceIds.length, 1);
    assert.equal(before.evidenceIds.length, 1);
    assert.equal(before.truthAssessmentIds.length, 1);

    await executionStore.close();
    executionStore = undefined;
    await first.close();
    first = undefined;

    second = await createRuntimeApp(postgresConfig(false), {
      truthPipeline: pipeline,
      solandraCognition: cognition,
      solandraKnowledgePresenter: presenter,
    });
    runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    knowledgeStore = await PostgresKnowledgeRecordStore.connect(databaseUrl);

    const establishedReferences = await knowledgeStore.listReferences(conversationId);
    assert.equal(establishedReferences.length, 1);
    assert.equal(establishedReferences[0]?.knowledgeId, knowledgeId);
    assert.equal(establishedReferences[0]?.referenceKind, "ESTABLISHED");

    const afterResponse = await second.inject({ method: "GET", url: `/api/v1/knowledge/${knowledgeId}` });
    assert.equal(afterResponse.statusCode, 200, afterResponse.body);
    const after = afterResponse.json<typeof before>();
    assert.deepEqual(after, before);

    const reconstructedRun = await runStore.get(runId);
    const truth = await runStore.getTruthBundle(runId);
    assert.ok(reconstructedRun);
    assert.ok(isConsultationRunRequest(reconstructedRun.request));
    assert.equal(reconstructedRun.request.intentVersionId, intentVersionId);
    assert.ok(truth);
    for (const id of after.claimIds) assert.ok(truth.claims.some((item) => item.id === id));
    for (const id of after.sourceIds) assert.ok(truth.sources.some((item) => item.id === id));
    for (const id of after.evidenceIds) assert.ok(truth.claimEvidence.some((item) => item.externalEvidenceId === id));
    for (const id of after.truthAssessmentIds) assert.ok(truth.assessments.some((item) => item.id === id));

    const sources = await second.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Show me the sources behind that." },
    });
    assert.equal(sources.statusCode, 200, sources.body);
    const sourcesBody = sources.json<{
      status: string;
      knowledgeReference: { knowledgeId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(sourcesBody.status, "REFERENCE_RESOLVED");
    assert.equal(sourcesBody.knowledgeReference.knowledgeId, knowledgeId);
    assert.match(sourcesBody.presentation.assistantMessage, /durable\.example\/interface-stability/iu);
    assert.equal(acquisition.requests.length, 1);

    const transformed = await second.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Explain that more plainly." },
    });
    assert.equal(transformed.statusCode, 200, transformed.body);
    assert.equal(
      transformed.json<{ knowledgeReference: { knowledgeId: string } }>().knowledgeReference.knowledgeId,
      knowledgeId,
    );
    assert.equal(acquisition.requests.length, 1);
    assert.equal(presenter.inputs.length, 1);

    const references = await knowledgeStore.listReferences(conversationId);
    assert.equal(references.filter((item) => item.knowledgeId === knowledgeId).length, 3);
    assert.equal(references.at(-1)?.referenceKind, "REFERENCED");
  } finally {
    await executionStore?.close();
    await runStore?.close();
    await knowledgeStore?.close();
    await first?.close();
    await second?.close();
    if (conversationId) {
      await pool.query("DELETE FROM conversation_knowledge_references WHERE conversation_id=$1", [conversationId]);
      await pool.query("DELETE FROM knowledge_records WHERE conversation_id=$1", [conversationId]);
    }
    if (runId) {
      await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_intent_bindings WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_events WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM dispatch_outbox WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    }
    if (conversationId) await pool.query("DELETE FROM intent_user_messages WHERE conversation_id=$1", [conversationId]);
    if (intentScopeId) await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]);
    if (conversationId) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    await pool.end();
  }
});

class UnsupportedPresentationProvider implements ModelProvider {
  readonly kind = "m1-unsupported-presentation-provider";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    return {
      response: {
        id: "m1-unsupported-presentation-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            needsNewKnowledge: false,
            segments: [{
              claimId: "presenter-claim",
              text: "A stable public interface eliminates upgrade coupling and guarantees 99.9% uptime for every deployment.",
            }],
          }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "m1-unsupported-presentation-request",
      },
    };
  }
}

test("ModelSolandraKnowledgePresenter rejects unsupported factual additions without changing governed Knowledge", async () => {
  const knowledge: KnowledgeOutcome = {
    kind: "KNOWLEDGE",
    objective: "Understand the effect of a stable public interface on upgrade coupling.",
    acceptedUnderstanding: "Understand the effect of a stable public interface on upgrade coupling.",
    findings: [{
      claimId: "presenter-claim",
      text: FINDING,
      status: "SUPPORTED",
      confidence: "HIGH",
      evidenceIds: ["presenter-evidence"],
      contradictoryEvidenceIds: [],
      temporalQualifiers: { effectiveAt: null, period: null },
      basis: "CLAIM",
    }],
    uncertainties: [],
    provenance: [{
      sourceId: "presenter-source",
      canonicalUri: "https://presenter.example/governed",
      publisher: "Presenter Example",
      provenanceConfidence: "HIGH",
      authoritativePrimary: true,
      retrievedAt: FIXED_TIME,
    }],
    evidence: [{
      evidenceId: "presenter-evidence",
      claimId: "presenter-claim",
      sourceId: "presenter-source",
      relation: "SUPPORTS",
      excerpt: FINDING,
      verification: "VERIFIED",
      admitted: true,
      rejectionReason: null,
    }],
    truthAssessmentIds: ["presenter-assessment"],
  };
  const before = structuredClone(knowledge);
  const provider = new UnsupportedPresentationProvider();
  const presenter = new ModelSolandraKnowledgePresenter(new ModelRuntime(provider), "m1-presenter-authority-model");
  const result = await presenter.present({
    knowledgeId: "knowledge-presenter-authority",
    userMessageId: "message-presenter-authority",
    mode: "EXPLAIN",
    knowledge,
  });

  assert.equal(provider.calls, 1);
  assert.equal(result.status, "FIDELITY_REJECTED");
  assert.equal(result.text, null);
  assert.deepEqual(knowledge, before);
  assert.deepEqual(knowledge.findings.map((item) => item.claimId), ["presenter-claim"]);
  assert.deepEqual(knowledge.evidence?.map((item) => item.evidenceId), ["presenter-evidence"]);
  assert.deepEqual(knowledge.truthAssessmentIds, ["presenter-assessment"]);
  assert.doesNotMatch(JSON.stringify(knowledge), /99\.9|guarantees|eliminates/iu);
});
