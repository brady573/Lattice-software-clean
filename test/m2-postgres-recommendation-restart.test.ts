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
import { PostgresRecommendationStore } from "../src/recommendation/recommendation-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { executePersistedRun } from "../src/run-execution.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraAdvisoryInput,
  SolandraAdvisoryRuntime,
  SolandraAdvisoryRuntimeResult,
} from "../src/solandra/advisory.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;
const USER = "Help me choose an approach that keeps ongoing maintenance manageable.";
const NEED = "governed evidence about ongoing maintenance burden for the available approaches";
const FINDING = "A smaller maintenance surface can reduce the amount of ongoing work required to keep an implementation usable.";
const EXTRA_FINDING = "A broader dependency surface can increase the number of components requiring routine attention.";
const FIXED_TIME = "2026-09-07T15:00:00.000Z";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "m2-postgres-fixture",
  requestedModel: "m2-postgres-model",
  actualProvider: "m2-postgres-fixture",
  actualModel: "m2-postgres-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "m2-postgres-request",
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
    referencedRecommendationId: null,
    ...overrides,
  };
}

class RestartCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const recommendationId = input.governedRecommendations?.at(-1)?.recommendationId ?? null;
    if (/why did you recommend/iu.test(input.message)) {
      return {
        proposal: proposal({ requestedHelp: "EXPLAIN_RECOMMENDATION", referencedRecommendationId: recommendationId }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (/sources behind that recommendation/iu.test(input.message)) {
      return {
        proposal: proposal({ requestedHelp: "SOURCES_RECOMMENDATION", referencedRecommendationId: recommendationId }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: "Model wording must remain non-authoritative.",
        requestedHelp: "DECISION",
        knowledgeNeeds: [NEED],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class RecordingAcquisition implements KnowledgeAcquisitionProvider {
  readonly kind = "m2-postgres-recording-acquisition";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "m2-postgres-source",
        canonicalUri: "https://m2-postgres.example/maintenance",
        title: "M2 PostgreSQL governed maintenance source",
        publisher: "M2 PostgreSQL Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: null,
        contentType: "text/plain",
        content: FINDING,
      }, {
        sourceId: "m2-postgres-extra-source",
        canonicalUri: "https://m2-postgres.example/unrelated",
        title: "M2 PostgreSQL unrelated governed source",
        publisher: "M2 PostgreSQL Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: null,
        contentType: "text/plain",
        content: EXTRA_FINDING,
      }],
      claims: [{
        claimId: "m2-postgres-claim",
        text: FINDING,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "m2-postgres-source", relation: "SUPPORTS", excerpt: FINDING }],
      }, {
        claimId: "m2-postgres-extra-claim",
        text: EXTRA_FINDING,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "m2-postgres-extra-source", relation: "SUPPORTS", excerpt: EXTRA_FINDING }],
      }],
    };
  }
}

class RacingAdvisory implements SolandraAdvisoryRuntime {
  readonly inputs: SolandraAdvisoryInput[] = [];
  calls = 0;

  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    this.calls += 1;
    const call = this.calls;
    this.inputs.push(structuredClone(input));
    await new Promise((resolve) => setTimeout(resolve, call === 1 ? 30 : 5));
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const claim = knowledge.findings[0];
    assert.ok(claim);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Prefer the approach that best fits the USER's stated maintenance objective.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [claim.claimId] }],
        rationale: ["The governed finding supplies the factual basis; the preference-sensitive conclusion remains advisory."],
        tradeoffs: ["The recommendation is conditional on the USER's stated objective."],
        assumptions: ["The USER's stated maintenance objective remains controlling."],
        uncertainties: [...knowledge.uncertainties],
        preservedUncertainties: [...knowledge.uncertainties],
        alternatives: ["Keep alternatives open if the remaining uncertainty is material."],
      },
      invocationProvenance: PROVENANCE,
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
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m2-postgres-restart-user",
  } as NodeJS.ProcessEnv);
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

test("M2 PostgreSQL restart preserves exact Recommendation identity, claim provenance, explanation, and zero-recomputation reads", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const acquisition = new RecordingAcquisition();
  const pipeline = new KnowledgeAcquisitionTruthPipeline(acquisition);
  const cognition = new RestartCognition();
  const advisory = new RacingAdvisory();
  const pool = new Pool({ connectionString: databaseUrl });
  let first: FastifyInstance | undefined;
  let second: FastifyInstance | undefined;
  let executionStore: PostgresRunStore | undefined;
  let recommendationStore: PostgresRecommendationStore | undefined;
  let conversationId = "";
  let runId = "";
  let intentScopeId = "";
  let intentVersionId = "";

  try {
    first = await createRuntimeApp(postgresConfig(true), {
      truthPipeline: pipeline,
      solandraCognition: cognition,
      solandraAdvisory: advisory,
    });
    conversationId = await createConversation(first);
    const turn = await first.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: USER },
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
    assert.equal(accepted.acceptedUnderstanding, USER);
    assert.equal(accepted.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.deepEqual(accepted.interpretation.knowledgeNeeds, [NEED]);

    executionStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    assert.equal((await executePersistedRun(executionStore, pipeline, runId)).status, "COMPLETED");
    assert.equal(acquisition.requests.length, 1);

    const [left, right] = await Promise.all([
      first.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }),
      first.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }),
    ]);
    assert.equal(left.statusCode, 200, left.body);
    assert.equal(right.statusCode, 200, right.body);
    const leftBody = left.json<{ recommendationReference: { recommendationId: string } }>();
    const rightBody = right.json<{ recommendationReference: { recommendationId: string } }>();
    assert.equal(leftBody.recommendationReference.recommendationId, rightBody.recommendationReference.recommendationId);
    const recommendationId = leftBody.recommendationReference.recommendationId;

    const beforeResponse = await first.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(beforeResponse.statusCode, 200, beforeResponse.body);
    const before = beforeResponse.json<{
      recommendationId: string;
      conversationId: string;
      runId: string;
      intentVersionId: string;
      sourceMessageId: string;
      basis: Array<{ knowledgeId: string; claimIds: string[] }>;
      knowledgeIds: string[];
      claimIds: string[];
      factualBasis: Array<{ knowledgeId: string; claimIds: string[]; evidenceIds: string[]; sourceIds: string[] }>;
      rationale: string[];
      selectionAuthorized: boolean;
    }>();
    assert.equal(before.runId, runId);
    assert.equal(before.intentVersionId, intentVersionId);
    assert.equal(before.selectionAuthorized, false);
    assert.equal(before.basis.length, 1);
    assert.deepEqual(before.basis[0]?.claimIds, before.claimIds);
    assert.deepEqual(before.factualBasis[0]?.claimIds, before.claimIds);
    assert.deepEqual(before.factualBasis[0]?.sourceIds, ["m2-postgres-source"]);
    assert.equal(before.factualBasis[0]?.evidenceIds.length, 1);

    const continuityBefore = await first.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuityBefore.statusCode, 200, continuityBefore.body);
    const sourceMessageId = continuityBefore.json<{ messages: Array<{ id: string }> }>().messages[0]?.id;
    assert.ok(sourceMessageId);
    assert.equal(before.sourceMessageId, sourceMessageId);

    const callsAtPersistence = advisory.calls;
    assert.ok(callsAtPersistence >= 1);

    await executionStore.close();
    executionStore = undefined;
    await first.close();
    first = undefined;

    second = await createRuntimeApp(postgresConfig(false), {
      truthPipeline: pipeline,
      solandraCognition: cognition,
      solandraAdvisory: advisory,
    });
    recommendationStore = await PostgresRecommendationStore.connect(databaseUrl);
    const persisted = await recommendationStore.getRecommendation(recommendationId);
    assert.ok(persisted);
    assert.equal(persisted.recommendationId, recommendationId);
    assert.equal(persisted.runId, runId);
    assert.equal(persisted.intentVersionId, intentVersionId);
    assert.equal(persisted.sourceMessageId, sourceMessageId);
    assert.deepEqual(persisted.basis, before.basis);
    assert.deepEqual(persisted.knowledgeIds, before.knowledgeIds);
    assert.deepEqual(persisted.claimIds, before.claimIds);
    assert.deepEqual(persisted.rationale, before.rationale);
    assert.equal(persisted.selectionAuthorized, false);

    const replay = await second.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(
      replay.json<{ recommendationReference: { recommendationId: string } }>().recommendationReference.recommendationId,
      recommendationId,
    );
    assert.equal(advisory.calls, callsAtPersistence, "Restarted historical outcome read must not recompute Recommendation.");
    assert.equal(acquisition.requests.length, 1);

    const why = await second.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Why did you recommend that?" },
    });
    assert.equal(why.statusCode, 200, why.body);
    assert.equal(why.json<{ recommendationReference: { recommendationId: string } }>().recommendationReference.recommendationId, recommendationId);
    assert.match(why.json<{ presentation: { assistantMessage: string } }>().presentation.assistantMessage, /Why:/u);
    assert.equal(advisory.calls, callsAtPersistence);
    assert.equal(acquisition.requests.length, 1);

    const sources = await second.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Show me the sources behind that recommendation." },
    });
    assert.equal(sources.statusCode, 200, sources.body);
    assert.equal(sources.json<{ recommendationReference: { recommendationId: string } }>().recommendationReference.recommendationId, recommendationId);
    const sourceMessage = sources.json<{ presentation: { assistantMessage: string } }>().presentation.assistantMessage;
    assert.match(sourceMessage, /m2-postgres\.example\/maintenance/iu);
    assert.doesNotMatch(sourceMessage, /m2-postgres\.example\/unrelated/iu);
    assert.equal(advisory.calls, callsAtPersistence);
    assert.equal(acquisition.requests.length, 1, "Historical Recommendation provenance must not reacquire evidence.");

    const afterResponse = await second.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(afterResponse.statusCode, 200, afterResponse.body);
    assert.deepEqual(afterResponse.json(), before);
  } finally {
    await recommendationStore?.close();
    await executionStore?.close();
    await first?.close();
    await second?.close();
    if (conversationId) {
      await pool.query("DELETE FROM recommendations WHERE conversation_id=$1", [conversationId]);
      await pool.query("DELETE FROM conversation_knowledge_references WHERE conversation_id=$1", [conversationId]);
      await pool.query("DELETE FROM knowledge_records WHERE conversation_id=$1", [conversationId]);
      await pool.query("DELETE FROM intent_user_messages WHERE conversation_id=$1", [conversationId]);
    }
    if (runId) {
      await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_intent_bindings WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_events WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM dispatch_outbox WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    }
    if (intentScopeId) await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]);
    if (conversationId) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    await pool.end();
  }
});
