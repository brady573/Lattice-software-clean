import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ModelAssistanceCapabilityService } from "../src/model-assistance-capability.js";
import { PostgresModelAssistanceAuthorizationStore } from "../src/model-assistance-store.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import type {
  KnowledgeSimplificationAttempt,
  KnowledgeSimplifier,
} from "../src/presentation/solandra/knowledge-simplification.js";

const databaseUrl = process.env.DATABASE_URL;

test("A2 PostgreSQL model assistance authorization persists connect and revoke state", {
  skip: databaseUrl === undefined ? "DATABASE_URL is required for PostgreSQL integration." : false,
}, async () => {
  assert.ok(databaseUrl);
  await PostgresModelAssistanceAuthorizationStore.migrate(databaseUrl);
  const subjectId = `a2-${randomUUID()}`;

  let store = await PostgresModelAssistanceAuthorizationStore.connect(databaseUrl);
  assert.equal((await store.get(subjectId)).status, "DISCONNECTED");
  const connected = await store.connect(subjectId);
  assert.equal(connected.status, "CONNECTED");
  assert.equal(connected.version, 1);
  await store.close();

  store = await PostgresModelAssistanceAuthorizationStore.connect(databaseUrl);
  assert.equal((await store.get(subjectId)).status, "CONNECTED");
  const disconnected = await store.disconnect(subjectId);
  assert.equal(disconnected.status, "DISCONNECTED");
  assert.equal(disconnected.version, 2);
  await store.close();
});


const POSTGRES_PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LIVE_DIRECT",
  routeMode: "PINNED",
  requestedProvider: "postgres-fixture-service",
  requestedModel: "postgres-fixture-model",
  actualProvider: "postgres-fixture-service",
  actualModel: "postgres-fixture-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "postgres-fixture-request",
  routeProvenance: "COMPLETE",
});

const postgresFinding = {
  claimId: "claim-a2-postgres",
  text: "A bounded source claim.",
  status: "UNRESOLVED" as const,
  confidence: "LOW" as const,
  evidenceIds: ["evidence-a2-postgres"],
  contradictoryEvidenceIds: [],
  temporalQualifiers: { effectiveAt: null, period: null },
  basis: "SOURCE_REPORT" as const,
};

test("A2 PostgreSQL stale in-flight model assistance cannot finalize after disconnect", {
  skip: databaseUrl === undefined ? "DATABASE_URL is required for PostgreSQL integration." : false,
}, async () => {
  assert.ok(databaseUrl);
  await PostgresModelAssistanceAuthorizationStore.migrate(databaseUrl);
  const subjectId = `a2-finalize-disconnect-${randomUUID()}`;
  let release!: (value: KnowledgeSimplificationAttempt) => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const delegate: KnowledgeSimplifier = {
    async simplifyWithAudit() {
      started();
      return await new Promise<KnowledgeSimplificationAttempt>((resolve) => { release = resolve; });
    },
    async simplify(input) {
      const result = await this.simplifyWithAudit!(input);
      return result.status === "SIMPLIFIED" ? result.text : null;
    },
  };
  const service = new ModelAssistanceCapabilityService(
    await PostgresModelAssistanceAuthorizationStore.connect(databaseUrl),
    delegate,
  );
  try {
    await service.connect(subjectId);
    const pending = service.simplifierFor(subjectId).simplifyWithAudit!({
      runId: "pg-run-in-flight",
      finding: postgresFinding,
    });
    await startedPromise;
    const disconnected = await service.disconnect(subjectId);
    assert.equal(disconnected.status, "DISCONNECTED");
    assert.equal(disconnected.version, 2);

    release(Object.freeze({
      status: "SIMPLIFIED",
      text: "A simpler bounded source claim.",
      invocationProvenance: POSTGRES_PROVENANCE,
    }));
    assert.equal((await pending).status, "CAPABILITY_REVOKED");
    const finalState = await service.stateFor(subjectId);
    assert.equal(finalState.status, "DISCONNECTED");
    assert.equal(finalState.lastInvocation, null);
  } finally {
    await service.close();
  }
});

test("A2 PostgreSQL disconnect/reconnect preserves newer invocation evidence against late old completion", {
  skip: databaseUrl === undefined ? "DATABASE_URL is required for PostgreSQL integration." : false,
}, async () => {
  assert.ok(databaseUrl);
  await PostgresModelAssistanceAuthorizationStore.migrate(databaseUrl);
  const subjectId = `a2-finalize-reconnect-${randomUUID()}`;
  let oldRelease!: (value: KnowledgeSimplificationAttempt) => void;
  let oldStarted!: () => void;
  const oldStartedPromise = new Promise<void>((resolve) => { oldStarted = resolve; });
  let calls = 0;
  const delegate: KnowledgeSimplifier = {
    async simplifyWithAudit() {
      calls += 1;
      if (calls === 1) {
        oldStarted();
        return await new Promise<KnowledgeSimplificationAttempt>((resolve) => { oldRelease = resolve; });
      }
      return Object.freeze({
        status: "SIMPLIFIED",
        text: "Current authorized result.",
        invocationProvenance: POSTGRES_PROVENANCE,
      });
    },
    async simplify(input) {
      const result = await this.simplifyWithAudit!(input);
      return result.status === "SIMPLIFIED" ? result.text : null;
    },
  };
  const service = new ModelAssistanceCapabilityService(
    await PostgresModelAssistanceAuthorizationStore.connect(databaseUrl),
    delegate,
  );
  try {
    const connected = await service.connect(subjectId);
    assert.equal(connected.version, 1);
    const simplifier = service.simplifierFor(subjectId);
    const oldPending = simplifier.simplifyWithAudit!({
      runId: "pg-run-old-epoch",
      finding: postgresFinding,
    });
    await oldStartedPromise;

    assert.equal((await service.disconnect(subjectId)).version, 2);
    assert.equal((await service.connect(subjectId)).version, 3);

    const current = await simplifier.simplifyWithAudit!({
      runId: "pg-run-current-epoch",
      finding: postgresFinding,
    });
    assert.equal(current.status, "SIMPLIFIED");
    const currentState = await service.stateFor(subjectId);
    assert.equal(currentState.status, "CONNECTED");
    assert.equal(currentState.version, 3);
    assert.equal(currentState.lastInvocation?.runId, "pg-run-current-epoch");
    assert.equal(currentState.lastInvocation?.outcome, "SUCCEEDED");

    oldRelease(Object.freeze({
      status: "SIMPLIFIED",
      text: "Late old result.",
      invocationProvenance: POSTGRES_PROVENANCE,
    }));
    assert.equal((await oldPending).status, "CAPABILITY_REVOKED");

    const finalState = await service.stateFor(subjectId);
    assert.equal(finalState.version, 3);
    assert.equal(finalState.lastInvocation?.runId, "pg-run-current-epoch");
    assert.equal(finalState.lastInvocation?.outcome, "SUCCEEDED");
  } finally {
    await service.close();
  }
});
