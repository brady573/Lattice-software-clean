import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { backfillLegacyConversationKnowledgeReferences } from "../src/conversation/conversation-reference-backfill.js";
import { buildConversationReference } from "../src/conversation/conversation-reference-store.js";
import { MemoryKnowledgeRecordStore } from "../src/knowledge/knowledge-record-store.js";
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

const databaseUrl = process.env.DATABASE_URL;
const FINDING = "Stable identifiers preserve exact governed relationships across conversational turns.";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-91-consolidation-fixture",
  requestedModel: "issue-91-consolidation-model",
  actualProvider: "issue-91-consolidation-fixture",
  actualModel: "issue-91-consolidation-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-91-consolidation-request",
  routeProvenance: "COMPLETE",
});

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "issue-91-consolidation-evidence",
    value: FINDING,
    sourceId: "issue-91-consolidation-source",
    sourceLabel: "Issue 91 consolidation governed source",
    admitted: true,
  }],
  truthClaims: [{
    id: "issue-91-consolidation-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["issue-91-consolidation-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(
      requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"]),
    ),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "issue-91-consolidation-evidence",
    claimId: "issue-91-consolidation-claim",
    provenanceComponentKey: "issue-91-consolidation-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
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

class ConsolidationCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];
  forcedKnowledgeId: string | null = null;

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    if (input.message === "Try to use the unreferenced Knowledge.") {
      return {
        proposal: proposal({
          requestedHelp: "SOURCES_REFERENCE",
          referencedKnowledgeId: this.forcedKnowledgeId,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    const knowledgeId = input.governedKnowledge[0]?.knowledgeId ?? null;
    if (input.message.includes("sources")) {
      return {
        proposal: proposal({
          requestedHelp: "SOURCES_REFERENCE",
          referencedKnowledgeId: knowledgeId,
          proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (input.message.includes("plain language")) {
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
        objectiveRelation: input.currentObjective ? "NEW_OBJECTIVE" : "NEW_OBJECTIVE",
        proposedObjective: input.message,
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: ["stable governed identity continuity"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class ConsolidationPresenter implements SolandraKnowledgePresenter {
  readonly inputs: SolandraKnowledgePresentationInput[] = [];

  async present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult> {
    this.inputs.push(structuredClone(input));
    return {
      status: "PRESENTED",
      text: `Plain-language rendering of the same governed Knowledge: ${input.knowledge.findings[0]?.text ?? ""}`,
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
  throw new Error("Issue #91 consolidation test Run did not complete.");
}

test("Issue #91: Product Knowledge continuity is owned only by general ConversationReference", async () => {
  const knowledgeStore = new MemoryKnowledgeRecordStore();
  const cognition = new ConsolidationCognition();
  const presenter = new ConsolidationPresenter();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    knowledgeStore,
    solandraCognition: cognition,
    solandraKnowledgePresenter: presenter,
  });

  try {
    const conversationId = await createConversation(app);
    const initialMessage = "How do stable identifiers help preserve governed continuity?";
    const initialTurn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: initialMessage },
    });
    assert.equal(initialTurn.statusCode, 202, initialTurn.body);
    const accepted = initialTurn.json<{
      runId: string;
      intentScopeId: string;
      intentVersionId: string;
    }>();
    await waitForCompletion(app, accepted.runId);

    const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(outcome.statusCode, 200, outcome.body);
    const established = outcome.json<{
      knowledgeReference: { knowledgeId: string; referenceId: string; responseId: string };
    }>().knowledgeReference;
    assert.ok(established.referenceId);

    const initialContinuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(initialContinuity.statusCode, 200, initialContinuity.body);
    const initialBody = initialContinuity.json<{
      references?: unknown;
      messages: Array<{ id: string; role: string; content: string }>;
      conversationReferences: Array<{
        referenceId: string;
        userMessageId: string;
        responseId: string;
        intentVersionId: string;
        targets: Array<{ kind: string; targetId: string; relation: string }>;
      }>;
      recommendations: unknown[];
      acceptedChoices: unknown[];
    }>();
    assert.equal(initialBody.references, undefined, "legacy Knowledge reference collection must not remain in canonical continuity");
    const establishedReference = initialBody.conversationReferences.find((item) => item.referenceId === established.referenceId);
    assert.ok(establishedReference);
    assert.deepEqual(establishedReference.targets, [{
      kind: "KNOWLEDGE",
      targetId: established.knowledgeId,
      relation: "PRODUCED",
    }]);
    assert.equal(establishedReference.responseId, established.responseId);
    assert.equal(establishedReference.intentVersionId, accepted.intentVersionId);
    assert.equal(
      establishedReference.userMessageId,
      initialBody.messages.find((message) => message.role === "USER" && message.content === initialMessage)?.id,
    );
    assert.equal(initialBody.recommendations.length, 0);
    assert.equal(initialBody.acceptedChoices.length, 0);

    const orphanKnowledgeId = `knowledge-orphan-${randomUUID()}`;
    await knowledgeStore.putKnowledge({
      knowledgeId: orphanKnowledgeId,
      conversationId,
      runId: randomUUID(),
      intentScopeId: accepted.intentScopeId,
      intentVersionId: accepted.intentVersionId,
      sourceMessageId: establishedReference.userMessageId,
      objective: "Unreferenced same-conversation Knowledge",
      claimIds: ["orphan-claim"],
      sourceIds: ["orphan-source"],
      evidenceIds: ["orphan-evidence"],
      truthAssessmentIds: ["orphan-assessment"],
      uncertainties: [],
      asOf: "2026-09-15T00:00:00.000Z",
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    const sourcesMessage = "Show me the sources for that Knowledge.";
    const sources = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: sourcesMessage },
    });
    assert.equal(sources.statusCode, 200, sources.body);
    const sourcesBody = sources.json<{
      status: string;
      intentVersionId: string;
      knowledgeReference: { knowledgeId: string; referenceId: string };
    }>();
    assert.equal(sourcesBody.status, "REFERENCE_RESOLVED");
    assert.equal(sourcesBody.knowledgeReference.knowledgeId, established.knowledgeId);
    const sourcesInput = cognition.inputs.at(-1);
    assert.deepEqual(
      sourcesInput?.governedKnowledge.map((item) => item.knowledgeId),
      [established.knowledgeId],
      "same-conversation Knowledge without a general ConversationReference must not enter cognitive context",
    );

    const afterSources = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(afterSources.statusCode, 200, afterSources.body);
    const afterSourcesBody = afterSources.json<{
      messages: Array<{ id: string; role: string; content: string }>;
      conversationReferences: Array<{
        referenceId: string;
        userMessageId: string;
        intentVersionId: string;
        targets: Array<{ kind: string; targetId: string; relation: string }>;
      }>;
    }>();
    const consumed = afterSourcesBody.conversationReferences.find((item) =>
      item.referenceId === sourcesBody.knowledgeReference.referenceId);
    assert.ok(consumed);
    assert.deepEqual(consumed.targets, [{
      kind: "KNOWLEDGE",
      targetId: established.knowledgeId,
      relation: "CONSUMED",
    }]);
    assert.equal(consumed.intentVersionId, sourcesBody.intentVersionId);
    assert.equal(
      consumed.userMessageId,
      afterSourcesBody.messages.find((message) => message.role === "USER" && message.content === sourcesMessage)?.id,
    );

    cognition.forcedKnowledgeId = orphanKnowledgeId;
    const orphanReference = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Try to use the unreferenced Knowledge." },
    });
    assert.equal(orphanReference.statusCode, 404, orphanReference.body);
    assert.equal(orphanReference.json<{ error: string }>().error, "KNOWLEDGE_NOT_FOUND");
    assert.deepEqual(
      cognition.inputs.at(-1)?.governedKnowledge.map((item) => item.knowledgeId),
      [established.knowledgeId],
    );
    cognition.forcedKnowledgeId = null;

    const simplified = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Put that Knowledge in plain language." },
    });
    assert.equal(simplified.statusCode, 200, simplified.body);
    assert.equal(
      simplified.json<{ knowledgeReference: { knowledgeId: string } }>().knowledgeReference.knowledgeId,
      established.knowledgeId,
    );
    assert.equal(presenter.inputs.length, 1);
    assert.equal(presenter.inputs[0]?.knowledgeId, established.knowledgeId);

    const finalContinuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(finalContinuity.statusCode, 200, finalContinuity.body);
    const finalBody = finalContinuity.json<{
      conversationReferences: Array<{
        targets: Array<{ kind: string; targetId: string; relation: string }>;
      }>;
      recommendations: unknown[];
      acceptedChoices: unknown[];
    }>();
    const knowledgeReferences = finalBody.conversationReferences.filter((reference) =>
      reference.targets.some((target) => target.kind === "KNOWLEDGE" && target.targetId === established.knowledgeId));
    assert.equal(knowledgeReferences.length, 3);
    assert.equal(
      finalBody.conversationReferences.some((reference) =>
        reference.targets.some((target) => target.targetId === orphanKnowledgeId)),
      false,
    );
    assert.equal(finalBody.recommendations.length, 0);
    assert.equal(finalBody.acceptedChoices.length, 0);
  } finally {
    await app.close();
  }
});

test("Issue #91: recent governed Knowledge is deduplicated and bounded by ConversationReference history", async () => {
  const cognition = new ConsolidationCognition();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
  });
  try {
    const conversationId = await createConversation(app);
    const knowledgeIds: string[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const turn = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: randomUUID(), message: `Investigate governed continuity topic ${index}.` },
      });
      assert.equal(turn.statusCode, 202, turn.body);
      const runId = turn.json<{ runId: string }>().runId;
      await waitForCompletion(app, runId);
      const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(outcome.statusCode, 200, outcome.body);
      knowledgeIds.push(outcome.json<{ knowledgeReference: { knowledgeId: string } }>().knowledgeReference.knowledgeId);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const reference = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Show me the sources for the recent Knowledge." },
    });
    assert.equal(reference.statusCode, 200, reference.body);
    const recentInput = cognition.inputs.at(-1);
    assert.ok(recentInput);
    assert.equal(recentInput.governedKnowledge.length, 4);
    assert.deepEqual(
      recentInput.governedKnowledge.map((item) => item.knowledgeId),
      [...knowledgeIds].reverse().slice(0, 4),
    );
    assert.equal(recentInput.governedKnowledge.some((item) => item.knowledgeId === knowledgeIds[0]), false);

    const repeat = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Show me the sources for that Knowledge again." },
    });
    assert.equal(repeat.statusCode, 200, repeat.body);
    const repeatedInput = cognition.inputs.at(-1);
    assert.equal(repeatedInput?.governedKnowledge.length, 4);
    assert.equal(new Set(repeatedInput?.governedKnowledge.map((item) => item.knowledgeId)).size, 4);
  } finally {
    await app.close();
  }
});

function isolatedDatabaseUrl(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

test("Issue #91: legacy Knowledge references backfill idempotently through canonical ConversationReference admission", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = `issue91_backfill_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = isolatedDatabaseUrl(databaseUrl, schema);
  const pool = new Pool({ connectionString: scopedUrl });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query("CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await pool.query("INSERT INTO schema_migrations(name) VALUES ('040_conversation_references.sql')");
    await pool.query("CREATE TABLE conversations (id text PRIMARY KEY, owner_subject_id text)");
    await pool.query("CREATE TABLE intent_user_messages (message_id text PRIMARY KEY, conversation_id text NOT NULL, intent_scope_id text NOT NULL)");
    await pool.query("CREATE TABLE intent_versions (intent_version_id text PRIMARY KEY, intent_scope_id text NOT NULL)");
    await pool.query("CREATE TABLE knowledge_records (knowledge_id text PRIMARY KEY, conversation_id text NOT NULL)");
    await pool.query(`CREATE TABLE conversation_knowledge_references (
      reference_id text PRIMARY KEY,
      conversation_id text NOT NULL,
      user_message_id text NOT NULL,
      response_id text NOT NULL,
      intent_version_id text NOT NULL,
      knowledge_id text NOT NULL,
      reference_kind text NOT NULL,
      parent_reference_id text NULL,
      created_at timestamptz NOT NULL
    )`);
    await pool.query(`CREATE TABLE conversation_references (
      reference_id text PRIMARY KEY,
      conversation_id text NOT NULL,
      user_message_id text NOT NULL,
      response_id text NOT NULL,
      intent_version_id text NOT NULL,
      targets jsonb NOT NULL,
      parent_reference_id text NULL,
      created_at timestamptz NOT NULL
    )`);

    const conversationId = `conversation-${randomUUID()}`;
    const scopeId = `scope-${randomUUID()}`;
    const versionId = `version-${randomUUID()}`;
    const firstMessageId = `message-${randomUUID()}`;
    const secondMessageId = `message-${randomUUID()}`;
    const knowledgeId = `knowledge-${randomUUID()}`;
    const legacyEstablishedId = `legacy-${randomUUID()}`;
    const legacyReferencedId = `legacy-${randomUUID()}`;
    const establishedCreatedAt = "2026-09-10T10:00:00.000Z";
    const referencedCreatedAt = "2026-09-10T10:05:00.000Z";

    await pool.query("INSERT INTO conversations(id,owner_subject_id) VALUES ($1,$2)", [conversationId, "owner"]);
    await pool.query("INSERT INTO intent_user_messages(message_id,conversation_id,intent_scope_id) VALUES ($1,$2,$3),($4,$2,$3)", [
      firstMessageId, conversationId, scopeId, secondMessageId,
    ]);
    await pool.query("INSERT INTO intent_versions(intent_version_id,intent_scope_id) VALUES ($1,$2)", [versionId, scopeId]);
    await pool.query("INSERT INTO knowledge_records(knowledge_id,conversation_id) VALUES ($1,$2)", [knowledgeId, conversationId]);
    await pool.query(`INSERT INTO conversation_knowledge_references(
      reference_id,conversation_id,user_message_id,response_id,intent_version_id,knowledge_id,reference_kind,parent_reference_id,created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,'ESTABLISHED',NULL,$7),($8,$2,$9,$10,$5,$6,'REFERENCED',$1,$11)`, [
      legacyEstablishedId,
      conversationId,
      firstMessageId,
      "run:legacy:outcome",
      versionId,
      knowledgeId,
      establishedCreatedAt,
      legacyReferencedId,
      secondMessageId,
      `knowledge:${knowledgeId}:reference:${secondMessageId}`,
      referencedCreatedAt,
    ]);

    const established = buildConversationReference({
      conversationId,
      userMessageId: firstMessageId,
      responseId: "run:legacy:outcome",
      intentVersionId: versionId,
      targets: [{ kind: "KNOWLEDGE", targetId: knowledgeId, relation: "PRODUCED" }],
      parentReferenceId: null,
      createdAt: establishedCreatedAt,
    });
    await pool.query(`INSERT INTO conversation_references(
      reference_id,conversation_id,user_message_id,response_id,intent_version_id,targets,parent_reference_id,created_at
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [
      established.referenceId,
      established.conversationId,
      established.userMessageId,
      established.responseId,
      established.intentVersionId,
      JSON.stringify(established.targets),
      established.parentReferenceId,
      established.createdAt,
    ]);

    const first = await backfillLegacyConversationKnowledgeReferences(scopedUrl);
    assert.deepEqual(first, { alreadyApplied: false, legacyRows: 2, inserted: 1, reused: 1 });

    const rows = await pool.query<{
      reference_id: string;
      user_message_id: string;
      targets: Array<{ kind: string; targetId: string; relation: string }>;
      parent_reference_id: string | null;
    }>("SELECT reference_id,user_message_id,targets,parent_reference_id FROM conversation_references ORDER BY created_at,reference_id");
    assert.equal(rows.rows.length, 2);
    assert.deepEqual(rows.rows[0]?.targets, [{ kind: "KNOWLEDGE", relation: "PRODUCED", targetId: knowledgeId }]);
    assert.deepEqual(rows.rows[1]?.targets, [{ kind: "KNOWLEDGE", relation: "CONSUMED", targetId: knowledgeId }]);
    assert.equal(rows.rows[1]?.user_message_id, secondMessageId);
    assert.equal(rows.rows[1]?.parent_reference_id, established.referenceId);

    const second = await backfillLegacyConversationKnowledgeReferences(scopedUrl);
    assert.deepEqual(second, { alreadyApplied: true, legacyRows: 0, inserted: 0, reused: 0 });
    const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM conversation_references");
    assert.equal(count.rows[0]?.count, "2");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});