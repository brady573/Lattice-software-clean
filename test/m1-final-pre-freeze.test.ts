import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
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
  ModelProviderResult,
  ModelInvocationProvenance,
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
const DURABLE_FINDING = "A stable public interface can reduce upgrade coupling when clients depend on that interface rather than implementation details.";
const DURABLE_QUERY = "public interface stability upgrade coupling";
const FIXED_TIME = "2026-09-07T03:30:00.000Z";

const TEST_PROVENANCE: ModelInvocationProvenance = Object.freeze({
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

class RestartCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const referencedKnowledgeId = input.governedKnowledge[0]?.knowledgeId ?? null;
    if (input.message === "Show me the sources behind that.") {
      return {
        proposal: proposal({
          requestedHelp: "SOURCES_REFERENCE",
          referencedKnowledgeId,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: TEST_PROVENANCE,
      };
    }
    if (input.message === "Explain that more plainly.") {
      return {
        proposal: proposal({
          requestedHelp: "SIMPLIFY_REFERENCE",
          referencedKnowledgeId,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: TEST_PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: "Model-understood wording that remains non-authoritative.",
        knowledgeNeeds: [DURABLE_QUERY],
      }),
      invocationProvenance: TEST_PROVENANCE,
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
      invocationProvenance: TEST_PROVENANCE,
    };
  }
}

class RecordingAcquisitionProvider implements KnowledgeAcquisitionProvider {
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
        content: DURABLE_FINDING,
      }],
      claims: [{
        claimId: "m1-restart-claim",
        text: DURABLE_FINDING,
        claimType: "INTERPRETIVE",
        evidence: [{
          sourceId: "m1-restart-source",
          relation: "SUPPORTS",
          excerpt: DURABLE_FINDING,
        }],
      }],
    };
  }
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
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

test("M1 PostgreSQL reconstruction preserves exact Knowledge identity, provenance, and reference reuse without reacquisition", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const provider = new RecordingAcquisitionProvider();
  const pipeline = new KnowledgeAcquisitionTruthPipeline(provider);
  const cognition = new RestartCognition();
  const presenter = new RestartPresenter();
  const pool = new Pool({ connectionString: databaseUrl });
  let first: FastifyInstance | undefined;
  let second: FastifyInstance | undefined;
  let executionStore: PostgresRunStore | undefined;
  let reconstructedRunStore: PostgresRunStore | undefined;
  let reconstructedKnowledgeStore: PostgresKnowledgeRecordStore | undefined;
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
    assert.deepEqual(accepted.interpretation.knowledgeNeeds, [DURABLE_QUERY]);

    executionStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const completed = await executePersistedRun(executionStore, pipeline, runId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(provider.requests[0]?.investigationQueries, [DURABLE_QUERY]);

    const outcome = await first.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.equal(outcome.statusCode, 200, outcome.body);
    const established = outcome.json<{
      knowledgeReference: { knowledgeId: string; referenceId: string };
    }>();
    const knowledgeId = established.knowledgeReference.knowledgeId;

    const beforeRestart = await first.inject({ method: "GET", url: `/api/v1/knowledge/${knowledgeId}` });
    assert.equal(beforeRestart.statusCode, 200, beforeRestart.body);
    const before = beforeRestart.json<{
      knowledgeId: string;
      runId: string;
      intentVersionId: string;
      claimIds: string[];
      sourceIds: string[];
      evidenceIds: string[];
      truthAssessmentIds: string[];
    }>();
    assert.equal(before.knowledgeId, knowledgeId);
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
    reconstructedRunStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    reconstructedKnowledgeStore = await PostgresKnowledgeRecordStore.connect(databaseUrl);

    const persistedReferences = await reconstructedKnowledgeStore.listReferences(conversationId);
    assert.equal(persistedReferences.length, 1);
    assert.equal(persistedReferences[0]?.referenceKind, "ESTABLISHED");
    assert.equal(persistedReferences[0]?.knowledgeId, knowledgeId);

    const afterRestart = await second.inject({ method: "GET", url: `/api/v1/knowledge/${knowledgeId}` });
    assert.equal(afterRestart.statusCode, 200, afterRestart.body);
    const after = afterRestart.json<typeof before>();
    assert.deepEqual(after, before);

    const reconstructedRun = await reconstructedRunStore.get(runId);
    const reconstructedTruth = await reconstructedRunStore.getTruthBundle(runId);
    assert.ok(reconstructedRun);
    assert.ok(reconstructedTruth);
    assert.equal(reconstructedRun.request.intentVersionId, intentVersionId);
    for (const claimId of after.claimIds) {
      assert.ok(reconstructedTruth.claims.some((claim) => claim.id === claimId));
    }
    for (const sourceId of after.sourceIds) {
      assert.ok(reconstructedTruth.sources.some((source) => source.id === sourceId));
    }
    for (const evidenceId of after.evidenceIds) {
      assert.ok(reconstructedTruth.claimEvidence.some((evidence) => evidence.externalEvidenceId === evidenceId));
    }
    for (const assessmentId of after.truthAssessmentIds) {
      assert.ok(reconstructedTruth.assessments.some((assessment) => assessment.id === assessmentId));
    }

    const sources = await second.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Show me the sources behind that." },
    });
    assert.equal(sources.statusCode, 200, sources.body);
    const sourceBody = sources.json<{
      status: string;
      knowledgeReference: { knowledgeId: string; referenceId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(sourceBody.status, "REFERENCE_RESOLVED");
    assert.equal(sourceBody.knowledgeReference.knowledgeId, knowledgeId);
    assert.match(sourceBody.presentation.assistantMessage, /durable\.example\/interface-stability/iu);
    assert.equal(provider.requests.length, 1);

    const plain = await second.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Explain that more plainly." },
    });
    assert.equal(plain.statusCode, 200, plain.body);
    const plainBody = plain.json<{
      status: string;
      knowledgeReference: { knowledgeId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(plainBody.status, "REFERENCE_RESOLVED");
    assert.equal(plainBody.knowledgeReference.knowledgeId, knowledgeId);
    assert.match(plainBody.presentation.assistantMessage, /same established Knowledge/iu);
    assert.equal(provider.requests.length, 1);
    assert.equal(presenter.inputs.length, 1);

    const referencesAfterReuse = await reconstructedKnowledgeStore.listReferences(conversationId);
    assert.equal(referencesAfterReuse.filter((item) => item.knowledgeId === knowledgeId).length, 3);
    assert.equal(referencesAfterReuse.at(-1)?.referenceKind, "REFERENCED");
  } finally {
    await executionStore?.close();
    await reconstructedRunStore?.close();
    await reconstructedKnowledgeStore?.close();
    await first?.close();
    await second?.close();
    if (runId) {
      await pool.query("DELETE FROM conversation_knowledge_references WHERE conversation_id=$1", [conversationId]);
      await pool.query("DELETE FROM knowledge_records WHERE conversation_id=$1", [conversationId]);
      await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_intent_bindings WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_events WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM dispatch_outbox WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    }
    if (conversationId) {
      await pool.query("DELETE FROM intent_user_messages WHERE conversation_id=$1", [conversationId]);
    }
    if (intentScopeId) {
      await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]);
    }
    if (conversationId) {
      await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    }
    await pool.end();
  }
});

class UnsupportedPresentationProvider implements ModelProvider {
  readonly kind = "m1-unsupported-presentation-provider";
  calls = 0;

  async generate(
    request: CanonicalModelRequest,
    _context: ModelCallContext,
  ): Promise<ModelProviderResult> {
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
      text: DURABLE_FINDING,
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
      excerpt: DURABLE_FINDING,
      verification: "VERIFIED",
      admitted: true,
      rejectionReason: null,
    }],
    truthAssessmentIds: ["presenter-assessment"],
  };
  const original = structuredClone(knowledge);
  const provider = new UnsupportedPresentationProvider();
  const presenter = new ModelSolandraKnowledgePresenter(
    new ModelRuntime(provider),
    "m1-presenter-authority-model",
  );

  const result = await presenter.present({
    knowledgeId: "knowledge-presenter-authority",
    userMessageId: "message-presenter-authority",
    mode: "EXPLAIN",
    knowledge,
  });

  assert.equal(provider.calls, 1);
  assert.equal(result.status, "FIDELITY_REJECTED");
  assert.equal(result.text, null);
  assert.deepEqual(knowledge, original);
  assert.deepEqual(knowledge.findings.map((item) => item.claimId), ["presenter-claim"]);
  assert.deepEqual(knowledge.evidence?.map((item) => item.evidenceId), ["presenter-evidence"]);
  assert.deepEqual(knowledge.truthAssessmentIds, ["presenter-assessment"]);
  assert.doesNotMatch(JSON.stringify(knowledge), /99\.9|guarantees|eliminates/iu);
});
