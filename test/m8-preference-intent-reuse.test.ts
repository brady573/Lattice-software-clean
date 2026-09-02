import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  MemoryIntentAuthorityStore,
  MemoryUserPreferenceStore,
  PostgresIntentAuthorityStore,
  PostgresUserPreferenceStore,
  UserPreferenceNotFoundError,
  UserPreferenceVersionConflictError,
  reuseActiveUserPreference,
  type IntentAuthorityStore,
  type IntentProvenance,
  type UserPreferenceStore,
} from "../src/intent/index.js";

const databaseUrl = process.env.DATABASE_URL;

function explicitProvenance(label: string): IntentProvenance {
  return {
    kind: "EXPLICIT_USER",
    logicalUserTurnId: `turn-${label}`,
    sourceMessageId: `message-${label}`,
    sourceDigest: `digest-${label}`,
  };
}

async function createDecisionScope(store: IntentAuthorityStore, scopeId: string) {
  return store.createScope({
    intentScopeId: scopeId,
    initialTransition: {
      transitionId: `transition-${scopeId}-initial`,
      intentScopeId: scopeId,
      baseIntentVersionId: null,
      logicalUserTurnId: `turn-${scopeId}-initial`,
      observedMessageHorizon: 1,
      sourceMessageId: `message-${scopeId}-initial`,
      sourceDigest: `digest-${scopeId}-initial`,
      operations: [{
        op: "SET",
        path: { kind: "OBJECTIVE" },
        value: { state: "VALUE", value: "plan a trip" },
      }],
    },
  });
}

async function createPreference(store: UserPreferenceStore, preferenceId: string, ownerSubjectId = "subject-a") {
  return store.create({
    preferenceId,
    ownerSubjectId,
    semanticKey: "travel.pace",
    value: { state: "VALUE", value: "slow" },
    provenance: explicitProvenance("preference-create"),
  });
}

test("M8-E2 copies an exact active preference by value with original USER provenance", async () => {
  const preferenceStore = new MemoryUserPreferenceStore();
  const intentStore = new MemoryIntentAuthorityStore(() => `intent-version-${randomUUID()}`);
  try {
    const preference = await createPreference(preferenceStore, "preference-copy");
    const scope = await createDecisionScope(intentStore, "scope-copy");

    const result = await reuseActiveUserPreference(preferenceStore, intentStore, {
      preferenceId: preference.preferenceId,
      ownerSubjectId: preference.ownerSubjectId,
      expectedPreferenceVersion: preference.version,
      transitionId: "transition-reuse-copy",
      intentScopeId: scope.intentScopeId,
      baseIntentVersionId: scope.currentIntentVersionId,
      logicalUserTurnId: "turn-use-preference",
      observedMessageHorizon: 2,
      sourceMessageId: "message-use-preference",
      sourceDigest: "digest-use-preference",
    });

    assert.equal(result.disposition, "COMMITTED");
    assert.ok(result.resultingIntentVersionId);
    const reused = await intentStore.getVersion(result.resultingIntentVersionId);
    assert.deepEqual(reused?.state.preferences[preference.semanticKey], {
      value: { state: "VALUE", value: "slow" },
      provenance: preference.provenance,
    });
    assert.notEqual(
      reused?.state.preferences[preference.semanticKey]?.provenance.sourceMessageId,
      "message-use-preference",
    );

    const historicalBeforePreferenceChange = structuredClone(reused);
    await preferenceStore.update({
      preferenceId: preference.preferenceId,
      ownerSubjectId: preference.ownerSubjectId,
      expectedVersion: preference.version,
      value: { state: "VALUE", value: "fast" },
      provenance: explicitProvenance("preference-update"),
    });
    assert.deepEqual(await intentStore.getVersion(result.resultingIntentVersionId), historicalBeforePreferenceChange);
  } finally {
    await intentStore.close();
    await preferenceStore.close();
  }
});

test("M8-E2 fails closed for cross-subject, revoked, stale preference-version, and stale IntentVersion reuse", async () => {
  const preferenceStore = new MemoryUserPreferenceStore();
  const intentStore = new MemoryIntentAuthorityStore(() => `intent-version-${randomUUID()}`);
  try {
    const preference = await createPreference(preferenceStore, "preference-guards");
    const scope = await createDecisionScope(intentStore, "scope-guards");

    await assert.rejects(
      reuseActiveUserPreference(preferenceStore, intentStore, {
        preferenceId: preference.preferenceId,
        ownerSubjectId: "subject-b",
        expectedPreferenceVersion: preference.version,
        transitionId: "transition-cross-subject",
        intentScopeId: scope.intentScopeId,
        baseIntentVersionId: scope.currentIntentVersionId,
        logicalUserTurnId: "turn-cross-subject",
        observedMessageHorizon: 2,
        sourceMessageId: "message-cross-subject",
        sourceDigest: "digest-cross-subject",
      }),
      UserPreferenceNotFoundError,
    );

    await assert.rejects(
      reuseActiveUserPreference(preferenceStore, intentStore, {
        preferenceId: preference.preferenceId,
        ownerSubjectId: preference.ownerSubjectId,
        expectedPreferenceVersion: preference.version + 1,
        transitionId: "transition-stale-preference-version",
        intentScopeId: scope.intentScopeId,
        baseIntentVersionId: scope.currentIntentVersionId,
        logicalUserTurnId: "turn-stale-preference-version",
        observedMessageHorizon: 2,
        sourceMessageId: "message-stale-preference-version",
        sourceDigest: "digest-stale-preference-version",
      }),
      UserPreferenceVersionConflictError,
    );

    const advance = await intentStore.applyTransition({
      transitionId: "transition-advance-scope",
      intentScopeId: scope.intentScopeId,
      baseIntentVersionId: scope.currentIntentVersionId,
      logicalUserTurnId: "turn-advance-scope",
      observedMessageHorizon: 2,
      sourceMessageId: "message-advance-scope",
      sourceDigest: "digest-advance-scope",
      operations: [{
        op: "SET",
        path: { kind: "REQUIREMENT", key: "budget" },
        value: { state: "VALUE", value: 2000 },
      }],
    });
    assert.equal(advance.disposition, "COMMITTED");

    const staleTarget = await reuseActiveUserPreference(preferenceStore, intentStore, {
      preferenceId: preference.preferenceId,
      ownerSubjectId: preference.ownerSubjectId,
      expectedPreferenceVersion: preference.version,
      transitionId: "transition-stale-intent-version",
      intentScopeId: scope.intentScopeId,
      baseIntentVersionId: scope.currentIntentVersionId,
      logicalUserTurnId: "turn-stale-intent-version",
      observedMessageHorizon: 3,
      sourceMessageId: "message-stale-intent-version",
      sourceDigest: "digest-stale-intent-version",
    });
    assert.equal(staleTarget.disposition, "REJECTED_STALE");
    assert.equal((await intentStore.getScope(scope.intentScopeId))?.currentIntentVersionId, advance.resultingIntentVersionId);

    const revoked = await preferenceStore.revoke({
      preferenceId: preference.preferenceId,
      ownerSubjectId: preference.ownerSubjectId,
      expectedVersion: preference.version,
      provenance: explicitProvenance("preference-revoke"),
    });
    await assert.rejects(
      reuseActiveUserPreference(preferenceStore, intentStore, {
        preferenceId: revoked.preferenceId,
        ownerSubjectId: revoked.ownerSubjectId,
        expectedPreferenceVersion: revoked.version,
        transitionId: "transition-revoked",
        intentScopeId: scope.intentScopeId,
        baseIntentVersionId: advance.resultingIntentVersionId!,
        logicalUserTurnId: "turn-revoked",
        observedMessageHorizon: 4,
        sourceMessageId: "message-revoked",
        sourceDigest: "digest-revoked",
      }),
      UserPreferenceNotFoundError,
    );
  } finally {
    await intentStore.close();
    await preferenceStore.close();
  }
});

test("M8-E2 PostgreSQL reuse survives reconnect without a live preference reference", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresIntentAuthorityStore.migrate(databaseUrl);
  await PostgresUserPreferenceStore.migrate(databaseUrl);

  const preferenceId = `preference-${randomUUID()}`;
  const scopeId = `scope-${randomUUID()}`;
  const pool = new Pool({ connectionString: databaseUrl });
  let preferenceStore = await PostgresUserPreferenceStore.connect(databaseUrl);
  let intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  try {
    const preference = await createPreference(preferenceStore, preferenceId);
    const scope = await createDecisionScope(intentStore, scopeId);
    const reuse = await reuseActiveUserPreference(preferenceStore, intentStore, {
      preferenceId,
      ownerSubjectId: preference.ownerSubjectId,
      expectedPreferenceVersion: preference.version,
      transitionId: `transition-reuse-${scopeId}`,
      intentScopeId: scopeId,
      baseIntentVersionId: scope.currentIntentVersionId,
      logicalUserTurnId: `turn-reuse-${scopeId}`,
      observedMessageHorizon: 2,
      sourceMessageId: `message-reuse-${scopeId}`,
      sourceDigest: `digest-reuse-${scopeId}`,
    });
    assert.equal(reuse.disposition, "COMMITTED");
    assert.ok(reuse.resultingIntentVersionId);

    const historicalBeforeUpdate = await intentStore.getVersion(reuse.resultingIntentVersionId);
    assert.deepEqual(historicalBeforeUpdate?.state.preferences[preference.semanticKey], {
      value: preference.value,
      provenance: preference.provenance,
    });

    await preferenceStore.update({
      preferenceId,
      ownerSubjectId: preference.ownerSubjectId,
      expectedVersion: preference.version,
      value: { state: "VALUE", value: "fast" },
      provenance: explicitProvenance("postgres-preference-update"),
    });

    await intentStore.close();
    await preferenceStore.close();
    intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
    preferenceStore = await PostgresUserPreferenceStore.connect(databaseUrl);

    assert.deepEqual(await intentStore.getVersion(reuse.resultingIntentVersionId), historicalBeforeUpdate);
    assert.deepEqual((await preferenceStore.getActive(preferenceId, preference.ownerSubjectId))?.value, {
      state: "VALUE",
      value: "fast",
    });
  } finally {
    await intentStore.close();
    await preferenceStore.close();
    await pool.query("DELETE FROM user_preferences WHERE preference_id=$1", [preferenceId]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
