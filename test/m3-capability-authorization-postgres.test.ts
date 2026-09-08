import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresCapabilityAuthorizationStore } from "../src/capabilities/authorization-store.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;

test("PostgreSQL capability grants preserve subject isolation, revocation, and invocation evidence across restart", { skip: !databaseUrl }, async () => {
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
  await store.recordInvocation(subjectA, capabilityId, {
    requestId: "m3-pg-request",
    purpose: "bounded cognitive work",
    outcome: "SUCCEEDED",
    recordedAt: new Date().toISOString(),
    provenance: null,
    failureCode: null,
  });
  await store.close();

  store = await PostgresCapabilityAuthorizationStore.connect(databaseUrl);
  const restarted = await store.get(subjectA, capabilityId);
  assert.equal(restarted.status, "CONNECTED");
  assert.equal(restarted.version, 1);
  assert.equal(restarted.lastInvocation?.requestId, "m3-pg-request");
  const disconnected = await store.disconnect(subjectA, capabilityId);
  assert.equal(disconnected.status, "DISCONNECTED");
  assert.equal(disconnected.version, 2);
  await store.close();

  store = await PostgresCapabilityAuthorizationStore.connect(databaseUrl);
  const revoked = await store.get(subjectA, capabilityId);
  assert.equal(revoked.status, "DISCONNECTED");
  assert.equal(revoked.version, 2);
  assert.equal((await store.get(subjectB, capabilityId)).version, 0);
  await store.close();
});
