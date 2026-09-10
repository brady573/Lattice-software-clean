import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";

const databaseUrl = process.env.DATABASE_URL;
const SUBJECT = "topic-transition-reload-subject";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "topic-transition-reload-fixture",
  requestedModel: "topic-transition-reload-fixture",
  actualProvider: "topic-transition-reload-fixture",
  actualModel: "topic-transition-reload-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "topic-transition-reload-request",
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
    referencedOptionId: null,
    ...overrides,
  };
}

class ReloadCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "NEW_OBJECTIVE" : "NEW_OBJECTIVE",
        proposedObjective: input.message,
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

function durableConfig(connectionString: string, autoMigrate: boolean) {
  return resolveRuntimeConfig({
    DATABASE_URL: connectionString,
    LATTICE_DEPLOYMENT_MODE: "durable",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: autoMigrate ? "true" : "false",
  } as NodeJS.ProcessEnv);
}

const subjectResolver = () => ({ subjectId: SUBJECT });

async function cleanup(connectionString: string, conversationId: string, scopeId: string, runIds: readonly string[]) {
  const pool = new Pool({ connectionString });
  try {
    for (const runId of runIds) {
      await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_intent_bindings WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_events WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM dispatch_outbox WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    }
    await pool.query("DELETE FROM intent_user_messages WHERE conversation_id=$1", [conversationId]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
  } finally {
    await pool.end();
  }
}

test("PostgreSQL reload does not make recovered Intent sticky across a clear new topic", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const cognition = new ReloadCognition();
  let conversationId = "";
  let scopeId = "";
  const runIds: string[] = [];
  let firstVersionId = "";

  const firstApp = await createRuntimeApp(durableConfig(databaseUrl, true), {
    authenticatedSubjectResolver: subjectResolver,
    solandraCognition: cognition,
  });
  try {
    const created = await firstApp.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const firstMessage = "What causes tides in the ocean?";
    const first = await firstApp.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: firstMessage },
    });
    assert.equal(first.statusCode, 202, first.body);
    const accepted = first.json<{ runId: string; intentScopeId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    runIds.push(accepted.runId);
    scopeId = accepted.intentScopeId;
    firstVersionId = accepted.intentVersionId;
    assert.equal(accepted.acceptedUnderstanding, firstMessage);
  } finally {
    await firstApp.close();
  }

  const reopened = await createRuntimeApp(durableConfig(databaseUrl, false), {
    authenticatedSubjectResolver: subjectResolver,
    solandraCognition: cognition,
  });
  try {
    const secondMessage = "Help me plan how to organize a small pantry.";
    const second = await reopened.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: secondMessage },
    });
    assert.equal(second.statusCode, 202, second.body);
    const accepted = second.json<{
      runId: string;
      intentScopeId: string;
      intentVersionId: string;
      acceptedUnderstanding: string;
      provenance: { messageId: string };
      interpretation: { objectiveRelation: string };
    }>();
    runIds.push(accepted.runId);
    assert.equal(accepted.interpretation.objectiveRelation, "NEW_OBJECTIVE");
    assert.equal(accepted.acceptedUnderstanding, secondMessage);
    assert.notEqual(accepted.intentVersionId, firstVersionId);

    const run = await reopened.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}` });
    assert.equal(run.statusCode, 200, run.body);
    const body = run.json<{
      request: { objective: string; sourceMessageId: string; intentVersionId: string; intentScopeId: string };
    }>();
    assert.equal(body.request.objective, secondMessage);
    assert.equal(body.request.sourceMessageId, accepted.provenance.messageId);
    assert.equal(body.request.intentVersionId, accepted.intentVersionId);
    assert.equal(body.request.intentScopeId, accepted.intentScopeId);

    const continuity = await reopened.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    const continuityBody = continuity.json<{ messages: Array<{ content: string }>; runs: Array<{ runId: string; exactBinding: { intentVersionId: string } }> }>();
    assert.equal(continuityBody.messages.at(-1)?.content, secondMessage);
    const indexed = continuityBody.runs.find((entry) => entry.runId === accepted.runId);
    assert.ok(indexed);
    assert.equal(indexed.exactBinding.intentVersionId, accepted.intentVersionId);

    assert.equal(cognition.inputs.at(-1)?.currentObjective, "What causes tides in the ocean?");
    assert.equal(cognition.inputs.at(-1)?.message, secondMessage);
  } finally {
    await reopened.close();
    if (conversationId && scopeId) await cleanup(databaseUrl, conversationId, scopeId, runIds);
  }
});
