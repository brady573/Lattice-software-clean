import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
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
  SolandraActionPreparationInput,
  SolandraActionPreparationRuntimeResult,
  SolandraActionPreparer,
} from "../src/solandra/action-preparer.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;
const SUBJECT = "issue-100-governed-reference-user";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-100-reference-fixture",
  requestedModel: "issue-100-reference-model",
  actualProvider: "issue-100-reference-fixture",
  actualModel: "issue-100-reference-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-100-reference-request",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "DECISION",
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

function config(autoMigrate: boolean) {
  assert.ok(databaseUrl);
  return resolveRuntimeConfig({
    DATABASE_URL: databaseUrl,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: String(autoMigrate),
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: SUBJECT,
  } as NodeJS.ProcessEnv);
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

type TriggerHandle = Readonly<{ table: string; trigger: string; fn: string }>;

async function installFailureTrigger(
  pool: Pool,
  table: string,
  whenSql?: string,
): Promise<TriggerHandle> {
  const suffix = randomUUID().replaceAll("-", "");
  const fn = `issue100_fail_${suffix}`;
  const trigger = `issue100_fail_trigger_${suffix}`;
  await pool.query(
    `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'issue100 injected governed-reference failure';
     END;
     $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${trigger}
     BEFORE INSERT ON ${table}
     FOR EACH ROW ${whenSql ? `WHEN (${whenSql})` : ""}
     EXECUTE FUNCTION ${fn}()`,
  );
  return { table, trigger, fn };
}

async function removeFailureTrigger(pool: Pool, handle: TriggerHandle | undefined): Promise<void> {
  if (!handle) return;
  await pool.query(`DROP TRIGGER IF EXISTS ${handle.trigger} ON ${handle.table}`);
  await pool.query(`DROP FUNCTION IF EXISTS ${handle.fn}()`);
}

async function countRows(pool: Pool, sql: string, values: unknown[]): Promise<number> {
  const result = await pool.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function cleanupConversation(pool: Pool, conversationId: string): Promise<void> {
  await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
  await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [`consultation:${conversationId}`]);
}

class DecisionChoiceCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    if (/probe incomplete recommendation/iu.test(input.message)) {
      return { mode: "CONVERSATION", response: "probe complete", invocationProvenance: PROVENANCE };
    }
    const recommendation = input.governedRecommendations?.at(-1);
    if (/choose the first option/iu.test(input.message)) {
      return {
        proposal: proposal({
          requestedHelp: "ACCEPT_CHOICE",
          referencedRecommendationId: recommendation?.recommendationId ?? null,
          referencedOptionId: recommendation?.options[0]?.optionId ?? null,
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        preferences: ["keep maintenance bounded"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class DecisionChoiceAdvisory implements SolandraAdvisoryRuntime {
  calls = 0;

  async advise(_input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    this.calls += 1;
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Use the bounded weekly option.",
        basis: [],
        rationale: ["The proposal reflects only the USER's stated preference."],
        tradeoffs: [],
        assumptions: ["keep maintenance bounded"],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Use the monthly option."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

test(
  "Issue #100 PostgreSQL: Recommendation and AcceptedChoice stay incomplete until exact PRODUCED references survive, then restart/concurrent replay converges",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const cognition = new DecisionChoiceCognition();
    const advisory = new DecisionChoiceAdvisory();
    let app: FastifyInstance | undefined;
    let trigger: TriggerHandle | undefined;
    let conversationId = "";
    try {
      app = await createRuntimeApp(config(true), {
        solandraCognition: cognition,
        solandraAdvisory: advisory,
      });
      conversationId = await createConversation(app);
      const turnUrl = `/api/v1/conversations/${conversationId}/turns`;
      const decisionPayload = {
        turnId: "issue-100-reference-decision",
        message: "Help me choose a low-maintenance review routine; keep maintenance bounded.",
      };

      trigger = await installFailureTrigger(pool, "recommendations");
      const beforeObject = await app.inject({ method: "POST", url: turnUrl, payload: decisionPayload });
      assert.equal(beforeObject.statusCode, 500, beforeObject.body);
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM recommendations WHERE conversation_id=$1",
        [conversationId],
      ), 0);
      await removeFailureTrigger(pool, trigger);
      trigger = undefined;

      trigger = await installFailureTrigger(
        pool,
        "conversation_references",
        "NEW.targets @> '[{\"kind\":\"RECOMMENDATION\",\"relation\":\"PRODUCED\"}]'::jsonb",
      );
      const boundaryFailure = await app.inject({ method: "POST", url: turnUrl, payload: decisionPayload });
      assert.equal(boundaryFailure.statusCode, 500, boundaryFailure.body);
      const durableRecommendation = await pool.query<{ recommendation_id: string }>(
        "SELECT recommendation_id FROM recommendations WHERE conversation_id=$1",
        [conversationId],
      );
      assert.equal(durableRecommendation.rowCount, 1);
      const recommendationId = durableRecommendation.rows[0]!.recommendation_id;
      assert.equal(await countRows(
        pool,
        `SELECT count(*)::text AS count
         FROM conversation_references
         WHERE conversation_id=$1
           AND targets @> $2::jsonb`,
        [conversationId, JSON.stringify([{ kind: "RECOMMENDATION", targetId: recommendationId, relation: "PRODUCED" }])],
      ), 0);

      const continuityWhileIncomplete = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${conversationId}/continuity`,
      });
      assert.equal(continuityWhileIncomplete.statusCode, 200, continuityWhileIncomplete.body);
      assert.equal(continuityWhileIncomplete.json().recommendations.length, 0);
      const directWhileIncomplete = await app.inject({
        method: "GET",
        url: `/api/v1/recommendations/${recommendationId}`,
      });
      assert.equal(directWhileIncomplete.statusCode, 404, directWhileIncomplete.body);

      const probe = await app.inject({
        method: "POST",
        url: turnUrl,
        payload: { turnId: "issue-100-reference-probe", message: "Probe incomplete recommendation." },
      });
      assert.equal(probe.statusCode, 200, probe.body);
      const probeInput = cognition.inputs.at(-1);
      assert.ok(probeInput);
      assert.deepEqual(probeInput.governedRecommendations ?? [], []);

      await removeFailureTrigger(pool, trigger);
      trigger = undefined;
      await app.close();
      app = await createRuntimeApp(config(false), {
        solandraCognition: cognition,
        solandraAdvisory: advisory,
      });
      const advisoryCallsBeforeRepair = advisory.calls;
      const repaired = await Promise.all([
        app.inject({ method: "POST", url: turnUrl, payload: decisionPayload }),
        app.inject({ method: "POST", url: turnUrl, payload: decisionPayload }),
      ]);
      assert.ok(repaired.every((response) => response.statusCode === 200), repaired.map((response) => response.body).join("\n"));
      assert.ok(repaired.every((response) => response.json().status === "RECOMMENDATION_ESTABLISHED"));
      assert.ok(repaired.every((response) =>
        response.json().recommendationReference.recommendationId === recommendationId));
      assert.equal(advisory.calls, advisoryCallsBeforeRepair, "reference repair must reuse the durable Recommendation");
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM recommendations WHERE conversation_id=$1",
        [conversationId],
      ), 1);
      assert.equal(await countRows(
        pool,
        `SELECT count(*)::text AS count
         FROM conversation_references
         WHERE conversation_id=$1
           AND targets @> $2::jsonb`,
        [conversationId, JSON.stringify([{ kind: "RECOMMENDATION", targetId: recommendationId, relation: "PRODUCED" }])],
      ), 1);

      const continuityAfterRecommendation = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${conversationId}/continuity`,
      });
      assert.equal(continuityAfterRecommendation.json().recommendations.length, 1);

      const choicePayload = {
        turnId: "issue-100-reference-choice",
        message: "Choose the first option.",
      };
      trigger = await installFailureTrigger(pool, "accepted_choices");
      const choiceBeforeObject = await app.inject({ method: "POST", url: turnUrl, payload: choicePayload });
      assert.equal(choiceBeforeObject.statusCode, 500, choiceBeforeObject.body);
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM accepted_choices WHERE conversation_id=$1",
        [conversationId],
      ), 0);
      await removeFailureTrigger(pool, trigger);
      trigger = undefined;

      trigger = await installFailureTrigger(
        pool,
        "conversation_references",
        "NEW.targets @> '[{\"kind\":\"ACCEPTED_CHOICE\",\"relation\":\"PRODUCED\"}]'::jsonb",
      );
      const choiceBoundaryFailure = await app.inject({ method: "POST", url: turnUrl, payload: choicePayload });
      assert.equal(choiceBoundaryFailure.statusCode, 500, choiceBoundaryFailure.body);
      const durableChoice = await pool.query<{
        accepted_choice_id: string;
        authorization_granted: boolean;
        execution_authorized: boolean;
      }>(
        `SELECT accepted_choice_id,authorization_granted,execution_authorized
         FROM accepted_choices WHERE conversation_id=$1`,
        [conversationId],
      );
      assert.equal(durableChoice.rowCount, 1);
      const acceptedChoiceId = durableChoice.rows[0]!.accepted_choice_id;
      assert.equal(durableChoice.rows[0]!.authorization_granted, false);
      assert.equal(durableChoice.rows[0]!.execution_authorized, false);
      assert.equal(await countRows(
        pool,
        `SELECT count(*)::text AS count
         FROM conversation_references
         WHERE conversation_id=$1
           AND targets @> $2::jsonb`,
        [conversationId, JSON.stringify([{ kind: "ACCEPTED_CHOICE", targetId: acceptedChoiceId, relation: "PRODUCED" }])],
      ), 0);
      const incompleteChoiceContinuity = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${conversationId}/continuity`,
      });
      assert.equal(incompleteChoiceContinuity.json().acceptedChoices.length, 0);

      await removeFailureTrigger(pool, trigger);
      trigger = undefined;
      await app.close();
      app = await createRuntimeApp(config(false), {
        solandraCognition: cognition,
        solandraAdvisory: advisory,
      });
      const cognitionCallsBeforeChoiceRepair = cognition.inputs.length;
      const repairedChoices = await Promise.all([
        app.inject({ method: "POST", url: turnUrl, payload: choicePayload }),
        app.inject({ method: "POST", url: turnUrl, payload: choicePayload }),
      ]);
      assert.ok(repairedChoices.every((response) => response.statusCode === 200), repairedChoices.map((response) => response.body).join("\n"));
      assert.ok(repairedChoices.every((response) => response.json().status === "ACCEPTED_CHOICE_ESTABLISHED"));
      assert.ok(repairedChoices.every((response) =>
        response.json().acceptedChoice.acceptedChoiceId === acceptedChoiceId));
      assert.equal(cognition.inputs.length, cognitionCallsBeforeChoiceRepair, "choice repair must reuse exact durable meaning before cognition");
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM accepted_choices WHERE conversation_id=$1",
        [conversationId],
      ), 1);
      assert.equal(await countRows(
        pool,
        `SELECT count(*)::text AS count
         FROM conversation_references
         WHERE conversation_id=$1
           AND targets @> $2::jsonb`,
        [conversationId, JSON.stringify([{ kind: "ACCEPTED_CHOICE", targetId: acceptedChoiceId, relation: "PRODUCED" }])],
      ), 1);

      const finalContinuity = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${conversationId}/continuity`,
      });
      assert.equal(finalContinuity.statusCode, 200, finalContinuity.body);
      assert.equal(finalContinuity.json().recommendations.length, 1);
      assert.equal(finalContinuity.json().acceptedChoices.length, 1);
      assert.equal(
        finalContinuity.json().conversationReferences.filter((reference: { targets: Array<{ kind: string; targetId: string; relation: string }> }) =>
          reference.targets.some((target) =>
            target.kind === "RECOMMENDATION"
            && target.targetId === recommendationId
            && target.relation === "PRODUCED")).length,
        1,
      );
      assert.equal(
        finalContinuity.json().conversationReferences.filter((reference: { targets: Array<{ kind: string; targetId: string; relation: string }> }) =>
          reference.targets.some((target) =>
            target.kind === "ACCEPTED_CHOICE"
            && target.targetId === acceptedChoiceId
            && target.relation === "PRODUCED")).length,
        1,
      );
    } finally {
      await removeFailureTrigger(pool, trigger);
      await app?.close();
      if (conversationId) await cleanupConversation(pool, conversationId);
      await pool.end();
    }
  },
);

const FINDING = "The governed source establishes one bounded factual finding.";
const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "issue-100-reference-evidence",
    value: FINDING,
    sourceId: "issue-100-reference-source",
    sourceLabel: "Issue 100 reference source",
    admitted: true,
  }],
  truthClaims: [{
    id: "issue-100-reference-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["issue-100-reference-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "issue-100-reference-evidence",
    claimId: "issue-100-reference-claim",
    provenanceComponentKey: "issue-100-reference-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

class KnowledgeCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    if (/probe incomplete knowledge/iu.test(input.message)) {
      return { mode: "CONVERSATION", response: "knowledge probe complete", invocationProvenance: PROVENANCE };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: ["one bounded factual finding"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

test(
  "Issue #100 PostgreSQL: Knowledge is invisible until its exact PRODUCED reference survives and exact outcome replay repairs it",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const cognition = new KnowledgeCognition();
    let app: FastifyInstance | undefined;
    let runStore: PostgresRunStore | undefined;
    let trigger: TriggerHandle | undefined;
    let conversationId = "";
    let runId = "";
    try {
      app = await createRuntimeApp(config(true), { truthPipeline, solandraCognition: cognition });
      conversationId = await createConversation(app);
      const turn = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: "issue-100-knowledge-turn", message: "Establish the bounded factual finding." },
      });
      assert.equal(turn.statusCode, 202, turn.body);
      runId = turn.json().runId;

      runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
      assert.equal((await executePersistedRun(runStore, truthPipeline, runId)).status, "COMPLETED");

      trigger = await installFailureTrigger(pool, "knowledge_records");
      const beforeObject = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(beforeObject.statusCode, 500, beforeObject.body);
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM knowledge_records WHERE run_id=$1",
        [runId],
      ), 0);
      await removeFailureTrigger(pool, trigger);
      trigger = undefined;

      trigger = await installFailureTrigger(
        pool,
        "conversation_references",
        "NEW.targets @> '[{\"kind\":\"KNOWLEDGE\",\"relation\":\"PRODUCED\"}]'::jsonb",
      );
      const boundaryFailure = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(boundaryFailure.statusCode, 500, boundaryFailure.body);
      const durableKnowledge = await pool.query<{ knowledge_id: string }>(
        "SELECT knowledge_id FROM knowledge_records WHERE run_id=$1",
        [runId],
      );
      assert.equal(durableKnowledge.rowCount, 1);
      const knowledgeId = durableKnowledge.rows[0]!.knowledge_id;

      const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
      assert.equal(continuity.json().knowledge.length, 0);
      const direct = await app.inject({ method: "GET", url: `/api/v1/knowledge/${knowledgeId}` });
      assert.equal(direct.statusCode, 404, direct.body);

      const probe = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: "issue-100-knowledge-probe", message: "Probe incomplete knowledge." },
      });
      assert.equal(probe.statusCode, 200, probe.body);
      assert.deepEqual(cognition.inputs.at(-1)?.governedKnowledge ?? [], []);

      await removeFailureTrigger(pool, trigger);
      trigger = undefined;
      await runStore.close();
      runStore = undefined;
      await app.close();
      app = await createRuntimeApp(config(false), { truthPipeline, solandraCognition: cognition });

      const repaired = await Promise.all([
        app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }),
        app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }),
      ]);
      assert.ok(repaired.every((response) => response.statusCode === 200), repaired.map((response) => response.body).join("\n"));
      assert.ok(repaired.every((response) => response.json().knowledgeReference.knowledgeId === knowledgeId));
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM knowledge_records WHERE run_id=$1",
        [runId],
      ), 1);
      assert.equal(await countRows(
        pool,
        `SELECT count(*)::text AS count
         FROM conversation_references
         WHERE conversation_id=$1
           AND targets @> $2::jsonb`,
        [conversationId, JSON.stringify([{ kind: "KNOWLEDGE", targetId: knowledgeId, relation: "PRODUCED" }])],
      ), 1);

      const finalContinuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
      assert.equal(finalContinuity.json().knowledge.length, 1);
      const finalDirect = await app.inject({ method: "GET", url: `/api/v1/knowledge/${knowledgeId}` });
      assert.equal(finalDirect.statusCode, 200, finalDirect.body);
    } finally {
      await removeFailureTrigger(pool, trigger);
      await runStore?.close();
      await app?.close();
      if (conversationId) await cleanupConversation(pool, conversationId);
      await pool.end();
    }
  },
);

const PREPARED_BODY = "Prepared exact durable message from the first successful generation.";

class ResourceCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        requestedHelp: "RESOURCE",
        knowledgeNeeds: ["one bounded factual finding"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class ExactPreparer implements SolandraActionPreparer {
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
        body: PREPARED_BODY,
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [claim.claimId] }],
        preservedUncertainties: [...knowledge.uncertainties],
      },
      generationProvenance: PROVENANCE,
      groundingProvenance: PROVENANCE,
    };
  }
}

test(
  "Issue #100 PostgreSQL: PreparedResource stays inert before its PRODUCED reference and restart/concurrent replay reuses the exact draft",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const preparer = new ExactPreparer();
    let app: FastifyInstance | undefined;
    let runStore: PostgresRunStore | undefined;
    let trigger: TriggerHandle | undefined;
    let conversationId = "";
    let runId = "";
    try {
      app = await createRuntimeApp(config(true), {
        truthPipeline,
        solandraCognition: new ResourceCognition(),
        solandraActionPreparer: preparer,
      });
      conversationId = await createConversation(app);
      const turn = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: {
          turnId: "issue-100-resource-turn",
          message: "Draft a message using the bounded factual finding.",
          prepare: "PREPARED_MESSAGE",
        },
      });
      assert.equal(turn.statusCode, 202, turn.body);
      runId = turn.json().runId;

      runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
      assert.equal((await executePersistedRun(runStore, truthPipeline, runId)).status, "COMPLETED");

      trigger = await installFailureTrigger(pool, "prepared_resources");
      const beforeObject = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(beforeObject.statusCode, 500, beforeObject.body);
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM prepared_resources WHERE run_id=$1",
        [runId],
      ), 0);
      await removeFailureTrigger(pool, trigger);
      trigger = undefined;

      trigger = await installFailureTrigger(
        pool,
        "conversation_references",
        "NEW.targets @> '[{\"kind\":\"PREPARED_RESOURCE\",\"relation\":\"PRODUCED\"}]'::jsonb",
      );
      const boundaryFailure = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(boundaryFailure.statusCode, 500, boundaryFailure.body);
      const durableResource = await pool.query<{ resource_id: string; execution_authorized: boolean }>(
        "SELECT resource_id,execution_authorized FROM prepared_resources WHERE run_id=$1",
        [runId],
      );
      assert.equal(durableResource.rowCount, 1);
      const resourceId = durableResource.rows[0]!.resource_id;
      assert.equal(durableResource.rows[0]!.execution_authorized, false);
      assert.equal(preparer.calls, 2, "failed pre-object generation may rerun, but persisted incomplete draft must become replay authority");

      const presentationWhileIncomplete = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${conversationId}/presentation`,
      });
      assert.equal(presentationWhileIncomplete.statusCode, 200, presentationWhileIncomplete.body);
      assert.equal(presentationWhileIncomplete.body.includes(PREPARED_BODY), false);

      await removeFailureTrigger(pool, trigger);
      trigger = undefined;
      await runStore.close();
      runStore = undefined;
      await app.close();
      app = await createRuntimeApp(config(false), {
        truthPipeline,
        solandraCognition: new ResourceCognition(),
        solandraActionPreparer: preparer,
      });
      const callsBeforeRepair = preparer.calls;
      const repaired = await Promise.all([
        app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }),
        app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }),
      ]);
      assert.ok(repaired.every((response) => response.statusCode === 200), repaired.map((response) => response.body).join("\n"));
      assert.ok(repaired.every((response) => response.json().preparationReference.resourceId === resourceId));
      assert.ok(repaired.every((response) => response.json().outcome.resource.body === PREPARED_BODY));
      assert.equal(preparer.calls, callsBeforeRepair, "restart repair must reuse the exact durable PreparedResource without regeneration");
      assert.equal(await countRows(
        pool,
        "SELECT count(*)::text AS count FROM prepared_resources WHERE run_id=$1",
        [runId],
      ), 1);
      assert.equal(await countRows(
        pool,
        `SELECT count(*)::text AS count
         FROM conversation_references
         WHERE conversation_id=$1
           AND targets @> $2::jsonb`,
        [conversationId, JSON.stringify([{ kind: "PREPARED_RESOURCE", targetId: resourceId, relation: "PRODUCED" }])],
      ), 1);

      const finalContinuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
      assert.equal(
        finalContinuity.json().conversationReferences.filter((reference: { targets: Array<{ kind: string; targetId: string; relation: string }> }) =>
          reference.targets.some((target) =>
            target.kind === "PREPARED_RESOURCE"
            && target.targetId === resourceId
            && target.relation === "PRODUCED")).length,
        1,
      );
    } finally {
      await removeFailureTrigger(pool, trigger);
      await runStore?.close();
      await app?.close();
      if (conversationId) await cleanupConversation(pool, conversationId);
      await pool.end();
    }
  },
);
