import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresModelAssistanceAuthorizationStore } from "../src/model-assistance-store.js";

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
