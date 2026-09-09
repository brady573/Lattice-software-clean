import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresCapabilityAuthorizationStore } from "../src/capabilities/authorization-store.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;

test("PostgreSQL capability grants preserve subject isolation, revocation, finalization, and invocation evidence across restart", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const capabilityId = `m3-capability-${randomUUID()}`;
  const subjectA = `m3-subject-a-${randomUUID()}`;
  const subjectB = `m3-subject-b-${randomUUID()}`;

  let store = await PostgresCapabilityAuthorizationStore.connect(databaseUrl);
  const connected = await store.connect(subjectA, capabilityId);
  assert.equal(connected.status, "CONNECTED");
  assert.equal(connected.version, 1);
  assert.equal((await store.get(subjectB, capabilityId)).status, "DISCONNECTED");
  assert.equal(await store.finalizeInvocation(subjectA, capabilityId, connected.version, {
    requestId: "m3-pg-request",
    purpose: "bounded cognitive work",
    outcome: "SUCCEEDED",
    recordedAt: new Date().toISOString(),
    provenance: null,
    failureCode: null,
  }), true);
  await store.close();

  store = await PostgresCapabilityAuthorizationStore.connect(databaseUrl);
  const restarted = await store.get(subjectA, capabilityId);
  assert.equal(restarted.status, "CONNECTED");
  assert.equal(restarted.version, 1);
  assert.equal(restarted.lastInvocation?.requestId, "m3-pg-request");
  const disconnected = await store.disconnect(subjectA, capabilityId);
  assert.equal(disconnected.status, "DISCONNECTED");
  assert.equal(disconnected.version, 2);
  assert.equal(await store.finalizeInvocation(subjectA, capabilityId, connected.version, {
    requestId: "stale-finalization",
    purpose: "must not finalize after revoke",
    outcome: "SUCCEEDED",
    recordedAt: new Date().toISOString(),
    provenance: null,
    failureCode: null,
  }), false);
  const reconnected = await store.connect(subjectA, capabilityId);
  assert.equal(reconnected.status, "CONNECTED");
  assert.equal(reconnected.version, 3);
  assert.equal(await store.finalizeInvocation(subjectA, capabilityId, connected.version, {
    requestId: "stale-after-reconnect",
    purpose: "old grant must not finalize after reconnect",
    outcome: "SUCCEEDED",
    recordedAt: new Date().toISOString(),
    provenance: null,
    failureCode: null,
  }), false);
  assert.equal((await store.get(subjectA, capabilityId)).lastInvocation?.requestId, "m3-pg-request");
  await store.disconnect(subjectA, capabilityId);
  await store.close();

  store = await PostgresCapabilityAuthorizationStore.connect(databaseUrl);
  const revoked = await store.get(subjectA, capabilityId);
  assert.equal(revoked.status, "DISCONNECTED");
  assert.equal(revoked.version, 4);
  assert.equal(revoked.lastInvocation?.requestId, "m3-pg-request");
  assert.equal((await store.get(subjectB, capabilityId)).version, 0);
  await store.close();
});
