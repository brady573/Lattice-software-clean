import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  getAuthenticatedSubject,
  registerAuthenticatedSubjectBoundary,
} from "../src/auth/authenticated-subject.js";
import { registerConversationApi } from "../src/conversation/conversation-api.js";
import {
  MemoryConversationStore,
  PostgresConversationStore,
  type ConversationStore,
} from "../src/conversation/conversation-store.js";
import { buildCanonicalApp as buildApp } from "../src/http-app.js";
import {
  MemoryIntentAuthorityStore,
  MemoryIntentUserMessageStore,
  MemoryUserPreferenceStore,
  PostgresIntentAuthorityStore,
  PostgresIntentUserMessageStore,
  PostgresUserPreferenceStore,
  type IntentAuthorityStore,
  type IntentUserMessageStore,
  type UserPreferenceStore,
} from "../src/intent/index.js";
import { registerUserPreferenceControlsApi } from "../src/intent/user-preference-controls-api.js";

const databaseUrl = process.env.DATABASE_URL;

function subjectHeaders(subjectId: string): Record<string, string> {
  return { "x-test-subject": subjectId };
}

function resolveTestSubject(request: { headers: Record<string, unknown> }) {
  const value = request.headers["x-test-subject"];
  return typeof value === "string" ? { subjectId: value } : undefined;
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

async function appendControlMessage(
  store: IntentUserMessageStore,
  conversationId: string,
  intentScopeId: string,
  horizon: number,
  label: string,
) {
  return store.append({
    conversationId,
    intentScopeId,
    logicalUserTurnId: `turn-${label}`,
    messageId: `message-${label}`,
    messageHorizon: horizon,
    content: `User control ${label}`,
  });
}

function createControlApp(
  conversationStore: ConversationStore,
  intentStore: IntentAuthorityStore,
  userMessageStore: IntentUserMessageStore,
  preferenceStore: UserPreferenceStore,
) {
  const app = buildApp({ apiSubject: (request) => getAuthenticatedSubject(request).subjectId });
  registerAuthenticatedSubjectBoundary(app, { resolveSubject: resolveTestSubject });
  registerConversationApi(app, { conversationStore });
  registerUserPreferenceControlsApi(app, { preferenceStore, intentStore, userMessageStore });
  return app;
}

async function exerciseControls(
  conversationStore: ConversationStore,
  intentStore: IntentAuthorityStore,
  userMessageStore: IntentUserMessageStore,
  preferenceStore: UserPreferenceStore,
  suffix: string,
) {
  const app = createControlApp(conversationStore, intentStore, userMessageStore, preferenceStore);
  const conversationId = `conversation-${suffix}`;
  const otherConversationId = `conversation-other-${suffix}`;
  const scopeId = `scope-${suffix}`;
  const preferenceId = `preference-${suffix}`;
  await conversationStore.create(conversationId, "subject-a");
  await conversationStore.create(otherConversationId, "subject-b");
  const scope = await createDecisionScope(intentStore, scopeId);
  const rememberMessage = await appendControlMessage(userMessageStore, conversationId, scopeId, 2, `${suffix}-remember`);
  const applyMessage = await appendControlMessage(userMessageStore, conversationId, scopeId, 3, `${suffix}-apply`);
  const excludeMessage = await appendControlMessage(userMessageStore, conversationId, scopeId, 4, `${suffix}-exclude`);
  const forgetMessage = await appendControlMessage(userMessageStore, conversationId, scopeId, 5, `${suffix}-forget`);

  try {
    const remembered = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/preferences`,
      headers: subjectHeaders("subject-a"),
      payload: {
        preferenceId,
        semanticKey: "travel.pace",
        value: { state: "VALUE", value: "slow" },
        sourceMessageId: rememberMessage.messageId,
      },
    });
    assert.equal(remembered.statusCode, 201);
    assert.equal(remembered.json().preference.ownerSubjectId, "subject-a");
    assert.equal(remembered.json().preference.provenance.sourceMessageId, rememberMessage.messageId);

    const listA = await app.inject({
      method: "GET",
      url: "/api/v1/preferences",
      headers: subjectHeaders("subject-a"),
    });
    assert.equal(listA.statusCode, 200);
    assert.deepEqual(listA.json().preferences.map((preference: { preferenceId: string }) => preference.preferenceId), [preferenceId]);

    const listB = await app.inject({
      method: "GET",
      url: "/api/v1/preferences",
      headers: subjectHeaders("subject-b"),
    });
    assert.equal(listB.statusCode, 200);
    assert.deepEqual(listB.json().preferences, []);

    const crossSubject = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/preferences/${preferenceId}/forget`,
      headers: subjectHeaders("subject-b"),
      payload: { expectedPreferenceVersion: 1, sourceMessageId: forgetMessage.messageId },
    });
    assert.equal(crossSubject.statusCode, 404);
    assert.deepEqual(crossSubject.json(), { error: "CONVERSATION_NOT_FOUND" });

    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/preferences/${preferenceId}/apply`,
      headers: subjectHeaders("subject-a"),
      payload: {
        expectedPreferenceVersion: 1,
        transitionId: `transition-${suffix}-apply`,
        baseIntentVersionId: scope.currentIntentVersionId,
        sourceMessageId: applyMessage.messageId,
      },
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(applied.json().result.disposition, "COMMITTED");
    const appliedVersionId = applied.json().result.resultingIntentVersionId as string;
    const appliedVersion = await intentStore.getVersion(appliedVersionId);
    assert.deepEqual(appliedVersion?.state.preferences["travel.pace"], {
      value: { state: "VALUE", value: "slow" },
      provenance: remembered.json().preference.provenance,
    });

    const excluded = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/preferences/${preferenceId}/exclude`,
      headers: subjectHeaders("subject-a"),
      payload: {
        expectedPreferenceVersion: 1,
        transitionId: `transition-${suffix}-exclude`,
        baseIntentVersionId: appliedVersionId,
        sourceMessageId: excludeMessage.messageId,
      },
    });
    assert.equal(excluded.statusCode, 200);
    assert.equal(excluded.json().result.disposition, "COMMITTED");
    const excludedVersion = await intentStore.getVersion(excluded.json().result.resultingIntentVersionId as string);
    assert.equal(excludedVersion?.state.preferences["travel.pace"], undefined);
    assert.equal((await preferenceStore.getActive(preferenceId, "subject-a"))?.status, "ACTIVE");

    const staleForget = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/preferences/${preferenceId}/forget`,
      headers: subjectHeaders("subject-a"),
      payload: { expectedPreferenceVersion: 2, sourceMessageId: forgetMessage.messageId },
    });
    assert.equal(staleForget.statusCode, 409);
    assert.deepEqual(staleForget.json(), { error: "USER_PREFERENCE_VERSION_CONFLICT" });

    const forgotten = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/preferences/${preferenceId}/forget`,
      headers: subjectHeaders("subject-a"),
      payload: { expectedPreferenceVersion: 1, sourceMessageId: forgetMessage.messageId },
    });
    assert.equal(forgotten.statusCode, 200);
    assert.equal(forgotten.json().preference.status, "REVOKED");
    assert.equal(forgotten.json().preference.provenance.sourceMessageId, forgetMessage.messageId);

    const afterForget = await app.inject({
      method: "GET",
      url: "/api/v1/preferences",
      headers: subjectHeaders("subject-a"),
    });
    assert.deepEqual(afterForget.json().preferences, []);

    const applyForgotten = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/preferences/${preferenceId}/apply`,
      headers: subjectHeaders("subject-a"),
      payload: {
        expectedPreferenceVersion: 2,
        transitionId: `transition-${suffix}-apply-forgotten`,
        baseIntentVersionId: excluded.json().result.resultingIntentVersionId,
        sourceMessageId: forgetMessage.messageId,
      },
    });
    assert.equal(applyForgotten.statusCode, 404);
    assert.deepEqual(applyForgotten.json(), { error: "USER_PREFERENCE_NOT_FOUND" });
  } finally {
    await app.close();
  }

  return { conversationId, otherConversationId, scopeId, preferenceId };
}

test("M8-F1 exposes remember/list/apply/exclude/forget without crossing subject or intent boundaries", async () => {
  const conversationStore = new MemoryConversationStore();
  const intentStore = new MemoryIntentAuthorityStore(() => `intent-version-${randomUUID()}`);
  const userMessageStore = new MemoryIntentUserMessageStore();
  const preferenceStore = new MemoryUserPreferenceStore();
  await exerciseControls(conversationStore, intentStore, userMessageStore, preferenceStore, "memory");
});

test("M8-F1 PostgreSQL controls preserve subject ownership and explicit USER provenance", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresConversationStore.migrate(databaseUrl);
  await PostgresIntentUserMessageStore.migrate(databaseUrl);
  await PostgresIntentAuthorityStore.migrate(databaseUrl);
  await PostgresUserPreferenceStore.migrate(databaseUrl);

  const conversationStore = await PostgresConversationStore.connect(databaseUrl);
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const userMessageStore = await PostgresIntentUserMessageStore.connect(databaseUrl, { migrate: false });
  const preferenceStore = await PostgresUserPreferenceStore.connect(databaseUrl);
  const suffix = randomUUID();
  const ids = await exerciseControls(conversationStore, intentStore, userMessageStore, preferenceStore, suffix);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const revisions = await pool.query<{ status: string }>(
      "SELECT status FROM user_preference_revisions WHERE preference_id=$1 ORDER BY version",
      [ids.preferenceId],
    );
    assert.deepEqual(revisions.rows.map((row) => row.status), ["ACTIVE", "REVOKED"]);
  } finally {
    await pool.query("DELETE FROM user_preferences WHERE preference_id=$1", [ids.preferenceId]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [ids.scopeId]);
    await pool.query("DELETE FROM conversations WHERE id = ANY($1::text[])", [[ids.conversationId, ids.otherConversationId]]);
    await pool.end();
  }
});
