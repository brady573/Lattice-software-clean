import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  MemoryUserPreferenceStore,
  PostgresUserPreferenceStore,
  UserPreferenceNotFoundError,
  UserPreferenceVersionConflictError,
  type CreateUserPreferenceInput,
} from "../src/intent/user-preference-store.js";

const databaseUrl = process.env.DATABASE_URL;

function explicitProvenance(turn: string) {
  return {
    kind: "EXPLICIT_USER" as const,
    logicalUserTurnId: `turn-${turn}`,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
  };
}

function preferenceInput(
  preferenceId: string,
  ownerSubjectId = "subject-a",
  semanticKey = "travel.pace",
): CreateUserPreferenceInput {
  return {
    preferenceId,
    ownerSubjectId,
    semanticKey,
    value: { state: "VALUE", value: "slow" },
    provenance: explicitProvenance("create"),
  };
}

test("M8-E1 explicit preferences are subject-owned and non-disclosing", async () => {
  const store = new MemoryUserPreferenceStore();
  try {
    const preference = await store.create(preferenceInput("preference-1"));
    assert.equal(preference.ownerSubjectId, "subject-a");
    assert.equal(preference.version, 1);
    assert.equal(preference.status, "ACTIVE");

    assert.deepEqual(await store.listActive("subject-a"), [preference]);
    assert.deepEqual(await store.listActive("subject-b"), []);
    assert.equal(await store.getActive(preference.preferenceId, "subject-b"), undefined);

    await assert.rejects(
      store.update({
        preferenceId: preference.preferenceId,
        ownerSubjectId: "subject-b",
        expectedVersion: 1,
        value: { state: "VALUE", value: "fast" },
        provenance: explicitProvenance("cross-user"),
      }),
      UserPreferenceNotFoundError,
    );
  } finally {
    await store.close();
  }
});

test("M8-E1 update and revoke append immutable preference revisions", async () => {
  const store = new MemoryUserPreferenceStore();
  try {
    const created = await store.create(preferenceInput("preference-2"));
    const updated = await store.update({
      preferenceId: created.preferenceId,
      ownerSubjectId: created.ownerSubjectId,
      expectedVersion: created.version,
      value: { state: "VALUE", value: "fast" },
      provenance: explicitProvenance("update"),
    });
    assert.equal(updated.version, 2);
    assert.deepEqual(updated.value, { state: "VALUE", value: "fast" });

    await assert.rejects(
      store.update({
        preferenceId: created.preferenceId,
        ownerSubjectId: created.ownerSubjectId,
        expectedVersion: 1,
        value: { state: "VALUE", value: "medium" },
        provenance: explicitProvenance("stale"),
      }),
      UserPreferenceVersionConflictError,
    );

    const revoked = await store.revoke({
      preferenceId: updated.preferenceId,
      ownerSubjectId: updated.ownerSubjectId,
      expectedVersion: updated.version,
      provenance: explicitProvenance("revoke"),
    });
    assert.equal(revoked.version, 3);
    assert.equal(revoked.status, "REVOKED");
    assert.equal(await store.getActive(revoked.preferenceId, revoked.ownerSubjectId), undefined);

    const revisions = await store.listRevisions(revoked.preferenceId, revoked.ownerSubjectId);
    assert.deepEqual(revisions.map((revision) => revision.version), [1, 2, 3]);
    assert.deepEqual(revisions[0]?.value, { state: "VALUE", value: "slow" });
    assert.deepEqual(revisions[1]?.value, { state: "VALUE", value: "fast" });
    assert.equal(revisions[2]?.status, "REVOKED");
  } finally {
    await store.close();
  }
});

test("M8-E1 rejects non-USER provenance instead of silently persisting inference", async () => {
  const store = new MemoryUserPreferenceStore();
  try {
    await assert.rejects(
      store.create({
        ...preferenceInput("preference-3"),
        provenance: {
          kind: "INFERRED_MATERIAL",
          logicalUserTurnId: "turn-inferred",
          sourceMessageId: "message-inferred",
          sourceDigest: "digest-inferred",
        },
      } as unknown as CreateUserPreferenceInput),
    );
    assert.deepEqual(await store.listActive("subject-a"), []);
  } finally {
    await store.close();
  }
});

test("M8-E1 PostgreSQL preference state survives reconnect with subject isolation and revision history", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresUserPreferenceStore.migrate(databaseUrl);
  const preferenceId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  let store = await PostgresUserPreferenceStore.connect(databaseUrl);
  try {
    const created = await store.create(preferenceInput(preferenceId));
    const updated = await store.update({
      preferenceId,
      ownerSubjectId: "subject-a",
      expectedVersion: created.version,
      value: { state: "VALUE", value: "fast" },
      provenance: explicitProvenance("postgres-update"),
    });

    await store.close();
    store = await PostgresUserPreferenceStore.connect(databaseUrl);

    assert.deepEqual(await store.getActive(preferenceId, "subject-a"), updated);
    assert.equal(await store.getActive(preferenceId, "subject-b"), undefined);
    assert.deepEqual(
      (await store.listRevisions(preferenceId, "subject-a")).map((revision) => revision.version),
      [1, 2],
    );
    assert.deepEqual(await store.listRevisions(preferenceId, "subject-b"), []);
  } finally {
    await store.close();
    await pool.query("DELETE FROM user_preferences WHERE preference_id=$1", [preferenceId]);
    await pool.end();
  }
});
