import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  createApiRequestHash,
  type ApiRunSubmissionInput,
} from "../src/api-control-store.js";
import type {
  ConsultationRunRequest,
  RunRequest,
  StructuredDecision,
} from "../src/domain.js";
import { PostgresIntentAuthorityStore } from "../src/intent/index.js";
import type { DecisionPlanFidelityPolicy } from "../src/intent/decision-plan-store.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
import {
  PersistedRunCorruptionError,
  parsePersistedRunRequest,
} from "../src/postgres-run-json.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { createPendingRun } from "../src/run-execution.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
const allowExactTestPlanning: DecisionPlanFidelityPolicy = () => {};

const legacyRequest: RunRequest = {
  goal: "Choose a qualified option.",
  priorities: [{ criterion: "quality", weight: 1 }],
  hardConstraints: [{ criterion: "eligible", operator: "eq", value: true }],
};

function consultationRequest(
  intentScopeId = "scope-issue-132",
  intentVersionId = "intent-issue-132-v1",
): ConsultationRunRequest {
  return {
    kind: "consultation",
    objective: "Choose a qualified option.",
    context: ["Preserve canonical consultation context."],
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "message-issue-132",
    sourceMessageDigest: "a".repeat(64),
    intentVersion: 1,
    intentScopeId,
    intentVersionId,
  };
}

function qualifiedConsultationRequest(
  intentScopeId: string,
  intentVersionId: string,
): ConsultationRunRequest {
  const objective = "Choose a bounded durable option.";
  return {
    kind: "consultation",
    objective,
    context: [],
    investigationQueries: [],
    advisoryRequested: false,
    decisionNeed: "QUALIFIED",
    resourceNeed: "NONE",
    sourceMessageId: `message-${randomUUID()}`,
    sourceMessageDigest: "b".repeat(64),
    intentVersion: 1,
    intentScopeId,
    intentVersionId,
    decisionInput: {
      schemaVersion: 1,
      intentScopeId,
      intentVersionId,
      criterionCatalogVersion: 1,
      objective,
      hardRequirements: [],
      priorities: [],
      tolerances: [],
      criterionBindings: [],
    },
  };
}

function currentRecommendation(): StructuredDecision {
  return {
    goal: legacyRequest.goal,
    outcome: "RECOMMENDATION",
    winnerCandidateId: "alpha",
    frontierCandidateIds: ["alpha"],
    tiedCandidateIds: [],
    materialUnknowns: [],
    evaluations: [{
      candidateId: "alpha",
      eligible: true,
      rawScore: 0,
      normalizedScore: 0,
      constraints: [],
      supportingEvidenceIds: [],
    }],
    rationale: ["Current decision remains authoritative only within the decision boundary."],
    evidenceIds: [],
    truthAssessmentIds: [],
  };
}

function legacyWinnerDecision() {
  const current = currentRecommendation();
  return {
    goal: current.goal,
    winnerCandidateId: current.winnerCandidateId,
    evaluations: current.evaluations,
    rationale: current.rationale,
    evidenceIds: current.evidenceIds,
    truthAssessmentIds: current.truthAssessmentIds,
  };
}

async function insertRawRun(
  pool: Pool,
  runId: string,
  requestJson: unknown,
  decisionJson: unknown | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO runs(id,conversation_id,status,version,request_json,decision_json,explanation)
     VALUES ($1,$2,'CREATED',1,$3::jsonb,$4::jsonb,NULL)`,
    [
      runId,
      `conversation-${runId}`,
      JSON.stringify(requestJson),
      decisionJson === null ? null : JSON.stringify(decisionJson),
    ],
  );
}

async function expectCorruption(
  operation: Promise<unknown>,
  runId: string,
  field: "request_json" | "decision_json",
  options: { cause?: RegExp; secret?: string } = {},
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PersistedRunCorruptionError);
    assert.equal(error.runId, runId);
    assert.equal(error.field, field);
    assert.match(error.message, new RegExp(runId));
    assert.match(error.message, new RegExp(field));
    if (options.cause) {
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, options.cause);
    }
    if (options.secret) {
      assert.equal(error.message.includes(options.secret), false);
      assert.equal(String(error).includes(options.secret), false);
      assert.equal(JSON.stringify(error).includes(options.secret), false);
    }
    return true;
  });
}

function initialTransition(intentScopeId: string, objective: string) {
  return {
    transitionId: randomUUID(),
    intentScopeId,
    baseIntentVersionId: null,
    logicalUserTurnId: `turn-${randomUUID()}`,
    observedMessageHorizon: 1,
    sourceMessageId: `message-${randomUUID()}`,
    sourceDigest: `digest-${randomUUID()}`,
    operations: [{
      op: "SET" as const,
      path: { kind: "OBJECTIVE" as const },
      value: { state: "VALUE" as const, value: objective },
    }],
  };
}

function submission(
  run: ReturnType<typeof createPendingRun>,
  intentScopeId: string,
  intentVersionId: string,
  identity: string,
): ApiRunSubmissionInput {
  return {
    run,
    intentBinding: { intentScopeId, intentVersionId },
    dispatch: {
      logicalKey: `run:${run.id}:execute`,
      queueName: "lattice.run",
      payload: { runId: run.id },
    },
    idempotency: {
      scopeKey: `issue-132:${identity}`,
      httpMethod: "POST",
      canonicalRoute: `/issue-132/${identity}/runs`,
      idempotencyKey: `idem-${identity}`,
      requestHash: createApiRequestHash(run.request),
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
}

test("persisted Run request discrimination uses canonical schemas without consultation fallback", () => {
  assert.deepEqual(parsePersistedRunRequest("legacy-run", legacyRequest), legacyRequest);

  const consultation = consultationRequest();
  assert.deepEqual(
    parsePersistedRunRequest("consultation-run", consultation),
    {
      ...consultation,
      investigationQueries: [],
      advisoryRequested: false,
    },
  );

  const legacyShapeWithUnsupportedKind = {
    ...legacyRequest,
    kind: "legacy",
  };
  assert.throws(
    () => parsePersistedRunRequest("unsupported-kind-run", legacyShapeWithUnsupportedKind),
    (error: unknown) => {
      assert.ok(error instanceof PersistedRunCorruptionError);
      assert.equal(error.field, "request_json");
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /Unsupported persisted Run request discriminator/);
      return true;
    },
  );

  const contradictoryConsultation = {
    ...legacyRequest,
    kind: "consultation",
  };
  assert.throws(
    () => parsePersistedRunRequest("contradictory-consultation-run", contradictoryConsultation),
    (error: unknown) => {
      assert.ok(error instanceof PersistedRunCorruptionError);
      assert.equal(error.field, "request_json");
      return true;
    },
  );
});

test(
  "PostgresRunStore admits only parsed legacy and consultation requests and fails closed on malformed request_json",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);
    const store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    const legacyId = randomUUID();
    const consultationId = randomUUID();
    const malformedLegacyId = randomUUID();
    const malformedConsultationId = randomUUID();
    const unsupportedKindId = randomUUID();
    const contradictoryId = randomUUID();
    const secret = "ISSUE132_PRIVATE_REQUEST_SENTINEL";
    try {
      await store.create(createPendingRun("issue-132-valid-legacy", legacyRequest, legacyId));
      const consultation = consultationRequest();
      await store.create(createPendingRun("issue-132-valid-consultation", consultation, consultationId));

      const loadedLegacy = await store.get(legacyId);
      assert.deepEqual(loadedLegacy?.request, legacyRequest);

      const loadedConsultation = await store.get(consultationId);
      assert.deepEqual(loadedConsultation?.request, {
        ...consultation,
        investigationQueries: [],
        advisoryRequested: false,
      });

      await insertRawRun(pool, malformedLegacyId, {
        goal: "x",
        priorities: [],
        hardConstraints: [],
      });
      await expectCorruption(store.get(malformedLegacyId), malformedLegacyId, "request_json");

      await insertRawRun(pool, malformedConsultationId, {
        kind: "consultation",
        objective: "",
        sourceMessageId: "message-malformed",
        sourceMessageDigest: "c".repeat(64),
        intentVersion: 1,
        arbitraryPrivateContent: secret,
      });
      await expectCorruption(
        store.get(malformedConsultationId),
        malformedConsultationId,
        "request_json",
        { secret },
      );

      await insertRawRun(pool, unsupportedKindId, {
        ...legacyRequest,
        kind: "other-request-family",
      });
      await expectCorruption(store.get(unsupportedKindId), unsupportedKindId, "request_json", {
        cause: /Unsupported persisted Run request discriminator/,
      });

      await insertRawRun(pool, contradictoryId, {
        ...legacyRequest,
        kind: "consultation",
      });
      await expectCorruption(store.get(contradictoryId), contradictoryId, "request_json");
    } finally {
      await pool.query(
        "DELETE FROM runs WHERE id = ANY($1::uuid[])",
        [[legacyId, consultationId, malformedLegacyId, malformedConsultationId, unsupportedKindId, contradictoryId]],
      );
      await pool.end();
      await store.close();
    }
  },
);

test(
  "PostgresRunStore adds Run/decision_json corruption context without changing StructuredDecision compatibility",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);
    const store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    const malformedId = randomUUID();
    const currentId = randomUUID();
    const legacyId = randomUUID();
    try {
      await insertRawRun(pool, malformedId, legacyRequest, {
        outcome: "RECOMMENDATION",
        winnerCandidateId: "fabricated",
      });
      await expectCorruption(store.get(malformedId), malformedId, "decision_json", {
        cause: /Invalid persisted StructuredDecision/,
      });

      const current = currentRecommendation();
      await store.create(createPendingRun("issue-132-current-decision", legacyRequest, currentId));
      await pool.query(
        "UPDATE runs SET decision_json=$1::jsonb WHERE id=$2",
        [JSON.stringify(current), currentId],
      );
      assert.deepEqual((await store.get(currentId))?.decision, current);

      const historical = legacyWinnerDecision();
      await insertRawRun(pool, legacyId, legacyRequest, historical);
      const upgraded = await store.get(legacyId);
      assert.equal(upgraded?.decision?.outcome, "RECOMMENDATION");
      assert.equal(upgraded?.decision?.winnerCandidateId, "alpha");
      assert.deepEqual(upgraded?.decision?.frontierCandidateIds, ["alpha"]);
    } finally {
      await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [[malformedId, currentId, legacyId]]);
      await pool.end();
      await store.close();
    }
  },
);

test(
  "Postgres API-control recovery parses persisted request_json before DecisionPlan domain reconstruction",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
    const control = await PostgresApiRunControlStore.connect(databaseUrl, {
      migrate: false,
      decisionPlanFidelityPolicy: allowExactTestPlanning,
    });
    const intentScopeId = `issue-132-scope-${randomUUID()}`;
    const validRunId = randomUUID();
    const corruptRunId = randomUUID();
    const secret = "ISSUE132_API_RECOVERY_PRIVATE_SENTINEL";
    try {
      const objective = "Choose a bounded durable option.";
      const scope = await intentStore.createScope({
        intentScopeId,
        initialTransition: initialTransition(intentScopeId, objective),
      });
      const intentVersionId = scope.currentIntentVersionId;
      const request = qualifiedConsultationRequest(intentScopeId, intentVersionId);

      const validRun = createPendingRun("issue-132-valid-recovery", request, validRunId);
      const validInput = submission(validRun, intentScopeId, intentVersionId, "valid-recovery");
      assert.equal((await control.submitRun(validInput)).outcome, "created");
      await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [validRunId]);

      const replay = await control.submitRun(validInput);
      assert.equal(replay.outcome, "existing");
      const repairedPlan = await pool.query<{ planning_material_json: unknown }>(
        "SELECT planning_material_json FROM decision_plans WHERE run_id=$1",
        [validRunId],
      );
      assert.deepEqual(repairedPlan.rows[0]?.planning_material_json, request.decisionInput);

      const corruptRun = createPendingRun("issue-132-corrupt-recovery", request, corruptRunId);
      const corruptInput = submission(corruptRun, intentScopeId, intentVersionId, "corrupt-recovery");
      assert.equal((await control.submitRun(corruptInput)).outcome, "created");
      await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [corruptRunId]);
      await pool.query(
        "UPDATE runs SET request_json=$1::jsonb WHERE id=$2",
        [JSON.stringify({
          kind: "consultation",
          objective: "",
          sourceMessageId: "message-corrupt",
          sourceMessageDigest: "d".repeat(64),
          intentVersion: 1,
          arbitraryPrivateContent: secret,
        }), corruptRunId],
      );

      await expectCorruption(
        control.submitRun(corruptInput),
        corruptRunId,
        "request_json",
        { secret },
      );
      const corruptPlan = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM decision_plans WHERE run_id=$1",
        [corruptRunId],
      );
      assert.equal(corruptPlan.rows[0]?.count, "0");
    } finally {
      await pool.query("DELETE FROM decision_plans WHERE run_id = ANY($1::text[])", [[validRunId, corruptRunId]]);
      await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [[validRunId, corruptRunId]]);
      await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]);
      await control.close();
      await intentStore.close();
      await pool.end();
    }
  },
);
