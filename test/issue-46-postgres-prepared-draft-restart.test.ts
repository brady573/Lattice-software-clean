import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { executePersistedRun } from "../src/run-execution.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraActionPreparationInput,
  SolandraActionPreparationRuntimeResult,
  SolandraActionPreparer,
} from "../src/solandra/action-preparer.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
} from "../src/solandra/cognition.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;
const USER = "Draft a short note asking the community center whether the side room is available for a volunteer orientation.";
const FINDING = "The published room schedule lists the side room as reserved until 5 PM on Wednesday.";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-46-postgres",
  requestedModel: "issue-46-postgres",
  actualProvider: "issue-46-postgres",
  actualModel: "issue-46-postgres",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-46-postgres-request",
  routeProvenance: "COMPLETE",
});

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "issue-46-postgres-evidence",
    value: FINDING,
    sourceId: "issue-46-postgres-source",
    sourceLabel: "Community center published room schedule",
    admitted: true,
  }],
  truthClaims: [{
    id: "issue-46-postgres-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["issue-46-postgres-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "issue-46-postgres-evidence",
    claimId: "issue-46-postgres-claim",
    provenanceComponentKey: "issue-46-postgres-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

class ResourceCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return {
      proposal: {
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        requestedHelp: "RESOURCE",
        relevantContext: [],
        entities: [],
        referents: [],
        constraints: [],
        preferences: [],
        knowledgeNeeds: ["published room availability relevant to the request"],
        materialAmbiguity: null,
        referencedKnowledgeId: null,
        referencedRecommendationId: null,
        referencedOptionId: null,
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

class RestartPreparer implements SolandraActionPreparer {
  calls = 0;
  async prepare(input: SolandraActionPreparationInput): Promise<SolandraActionPreparationRuntimeResult> {
    this.calls += 1;
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const claim = knowledge.findings[0];
    assert.ok(claim);
    return {
      result: {
        status: "PREPARED",
        body: "Hello, would the side room be available after 5 PM on Wednesday for a volunteer orientation? Thank you.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [claim.claimId] }],
        preservedUncertainties: ["The published schedule does not establish availability after 5 PM."],
      },
      generationProvenance: PROVENANCE,
      groundingProvenance: PROVENANCE,
    };
  }
}

function config(autoMigrate: boolean) {
  assert.ok(databaseUrl);
  return resolveRuntimeConfig({
    DATABASE_URL: databaseUrl,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: String(autoMigrate),
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-46-postgres-user",
  } as NodeJS.ProcessEnv);
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

test("Issue #46 PostgreSQL restart preserves prepared draft authority, exact support, uncertainty, editability, and non-execution", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const cognition = new ResourceCognition();
  const preparer = new RestartPreparer();
  let first: FastifyInstance | undefined;
  let second: FastifyInstance | undefined;
  let executionStore: PostgresRunStore | undefined;
  try {
    first = await createRuntimeApp(config(true), {
      truthPipeline,
      solandraCognition: cognition,
      solandraActionPreparer: preparer,
    });
    const conversationId = await createConversation(first);
    const turn = await first.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: USER },
    });
    assert.equal(turn.statusCode, 202, turn.body);
    const accepted = turn.json<{ runId: string }>();

    executionStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    assert.equal((await executePersistedRun(executionStore, truthPipeline, accepted.runId)).status, "COMPLETED");

    const beforeResponse = await first.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(beforeResponse.statusCode, 200, beforeResponse.body);
    const before = beforeResponse.json<{
      outcome: {
        kind: string;
        resource: {
          kind: string;
          body: string;
          draftAuthority: { origin: string; factualAuthority: boolean; userAuthored: boolean };
          basis: Array<{ knowledgeId: string; claimIds: string[] }>;
          preservedUncertainties: string[];
          editable: boolean;
          executionAuthorized: boolean;
        };
      };
      preparationReference: { resourceId: string };
    }>();
    assert.equal(before.outcome.kind, "ACTION_PREPARATION");
    assert.equal(before.outcome.resource.kind, "PREPARED_MESSAGE");
    assert.deepEqual(before.outcome.resource.draftAuthority, {
      origin: "SOLANDRA",
      factualAuthority: false,
      userAuthored: false,
    });
    assert.equal(before.outcome.resource.basis.length, 1);
    assert.equal(before.outcome.resource.basis[0]?.claimIds.length, 1);
    assert.deepEqual(before.outcome.resource.preservedUncertainties, [
      "The published schedule does not establish availability after 5 PM.",
    ]);
    assert.equal(before.outcome.resource.editable, true);
    assert.equal(before.outcome.resource.executionAuthorized, false);
    assert.equal(preparer.calls, 1);

    const resourceId = before.preparationReference.resourceId;
    const body = before.outcome.resource.body;
    const basis = structuredClone(before.outcome.resource.basis);
    await first.close();
    first = undefined;
    await executionStore.close();
    executionStore = undefined;

    second = await createRuntimeApp(config(false), {
      truthPipeline,
      solandraCognition: cognition,
      solandraActionPreparer: preparer,
    });
    const afterResponse = await second.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(afterResponse.statusCode, 200, afterResponse.body);
    const after = afterResponse.json<typeof before>();
    assert.equal(after.preparationReference.resourceId, resourceId);
    assert.equal(after.outcome.resource.body, body);
    assert.deepEqual(after.outcome.resource.draftAuthority, before.outcome.resource.draftAuthority);
    assert.deepEqual(after.outcome.resource.basis, basis);
    assert.deepEqual(after.outcome.resource.preservedUncertainties, before.outcome.resource.preservedUncertainties);
    assert.equal(after.outcome.resource.editable, true);
    assert.equal(after.outcome.resource.executionAuthorized, false);
    assert.equal(preparer.calls, 1, "historical replay must reuse the durable PreparedResource without regeneration");
  } finally {
    await executionStore?.close();
    await first?.close();
    await second?.close();
  }
});
