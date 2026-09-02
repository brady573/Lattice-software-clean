import assert from "node:assert/strict";
import test from "node:test";
import {
  ContextProjectionError,
  buildExternalContextProjection,
  type ExternalContextProjectionInput,
} from "../src/model/context-projection.js";

function input(overrides: Partial<ExternalContextProjectionInput> = {}): ExternalContextProjectionInput {
  return {
    subjectId: "subject-a",
    role: "RESEARCH",
    conversation: {
      conversationId: "conversation-a",
      ownerSubjectId: "subject-a",
      state: "ACTIVE",
    },
    currentUserTurn: {
      messageId: "message-current",
      conversationId: "conversation-a",
      content: "Find the current answer for this exact decision.",
      intentScopeId: "scope-a",
      intentVersionId: "intent-v3",
    },
    intent: {
      ownerSubjectId: "subject-a",
      intentScopeId: "scope-a",
      intentVersionId: "intent-v3",
      values: {
        budget: 2500,
        region: "Utah",
        unrelatedHistoricalPreference: "do not export me",
      },
    },
    run: {
      runId: "run-a",
      subjectId: "subject-a",
      intentScopeId: "scope-a",
      intentVersionId: "intent-v3",
      taskDescription: "Bounded research for the current Run",
    },
    preferences: [
      {
        ownerSubjectId: "subject-a",
        semanticKey: "format",
        state: "ACTIVE",
        value: "concise",
        copiedIntoIntentVersionId: "intent-v3",
      },
      {
        ownerSubjectId: "subject-a",
        semanticKey: "revoked-style",
        state: "REVOKED",
        value: "old",
      },
    ],
    research: {
      runId: "run-a",
      checkpointId: "checkpoint-1",
      queryMaterial: "Verify only the unresolved current-state claim.",
    },
    priorResults: [
      {
        resultId: "result-1",
        runId: "run-a",
        kind: "OPERATIONAL",
        value: { status: 200, observation: "candidate evidence only" },
      },
    ],
    policy: {
      includeCurrentUserTurn: true,
      intentKeys: ["budget", "region"],
      licensedPreferenceKeys: ["format"],
      includeResearchMaterial: true,
      licensedPriorResultIds: ["result-1"],
      maxBytes: 16 * 1024,
    },
    ...overrides,
  };
}

async function expectCode(fn: () => unknown, code: ContextProjectionError["code"]): Promise<void> {
  await assert.rejects(async () => fn(), (error: unknown) => {
    assert.ok(error instanceof ContextProjectionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("M9-3 projects only explicitly licensed current-turn, IntentVersion, preference, research, and operational result fields", () => {
  const projection = buildExternalContextProjection(input());
  assert.deepEqual(projection, {
    role: "RESEARCH",
    runId: "run-a",
    intentScopeId: "scope-a",
    intentVersionId: "intent-v3",
    currentUserTurn: {
      messageId: "message-current",
      content: "Find the current answer for this exact decision.",
    },
    intentValues: { budget: 2500, region: "Utah" },
    preferences: { format: "concise" },
    research: {
      checkpointId: "checkpoint-1",
      queryMaterial: "Verify only the unresolved current-state claim.",
    },
    priorOperationalResults: [
      {
        resultId: "result-1",
        value: { status: 200, observation: "candidate evidence only" },
      },
    ],
  });
  assert.equal(JSON.stringify(projection).includes("unrelatedHistoricalPreference"), false);
});

test("M9-3 does not expose historical Conversation turns through the projection contract", () => {
  const raw = {
    ...input(),
    historicalConversationTurns: [
      { role: "USER", content: "old unrelated material" },
      { role: "ASSISTANT", content: "old model response" },
    ],
  } as ExternalContextProjectionInput & { historicalConversationTurns: unknown[] };
  const projection = buildExternalContextProjection(raw);
  assert.equal(JSON.stringify(projection).includes("old unrelated material"), false);
  assert.equal(JSON.stringify(projection).includes("old model response"), false);
});

test("M9-3 fails closed across subjects and when Conversation deletion makes the scope unavailable", async () => {
  await expectCode(
    () => buildExternalContextProjection(input({
      conversation: {
        conversationId: "conversation-a",
        ownerSubjectId: "subject-b",
        state: "ACTIVE",
      },
    })),
    "SUBJECT_MISMATCH",
  );

  await expectCode(
    () => buildExternalContextProjection(input({
      conversation: {
        conversationId: "conversation-a",
        ownerSubjectId: "subject-a",
        state: "DELETED",
      },
    })),
    "CONVERSATION_UNAVAILABLE",
  );
});

test("M9-3 preserves exact IntentVersion and Run binding", async () => {
  await expectCode(
    () => buildExternalContextProjection(input({
      run: {
        runId: "run-a",
        subjectId: "subject-a",
        intentScopeId: "scope-a",
        intentVersionId: "intent-v2",
        taskDescription: "stale run",
      },
    })),
    "BINDING_MISMATCH",
  );

  await expectCode(
    () => buildExternalContextProjection(input({
      currentUserTurn: {
        messageId: "message-current",
        conversationId: "conversation-a",
        content: "current",
        intentScopeId: "scope-a",
        intentVersionId: "intent-v2",
      },
    })),
    "BINDING_MISMATCH",
  );
});

test("M9-3 rejects revoked, cross-subject, stale-copy, and unlicensed preferences instead of dumping account state", async () => {
  await expectCode(
    () => buildExternalContextProjection(input({
      policy: { ...input().policy, licensedPreferenceKeys: ["revoked-style"] },
    })),
    "PREFERENCE_UNAVAILABLE",
  );

  await expectCode(
    () => buildExternalContextProjection(input({
      preferences: [{
        ownerSubjectId: "subject-b",
        semanticKey: "format",
        state: "ACTIVE",
        value: "concise",
      }],
    })),
    "PREFERENCE_NOT_LICENSED",
  );

  await expectCode(
    () => buildExternalContextProjection(input({
      preferences: [{
        ownerSubjectId: "subject-a",
        semanticKey: "format",
        state: "ACTIVE",
        value: "concise",
        copiedIntoIntentVersionId: "intent-v2",
      }],
    })),
    "BINDING_MISMATCH",
  );

  await expectCode(
    () => buildExternalContextProjection(input({
      policy: { ...input().policy, licensedPreferenceKeys: ["never-licensed"] },
    })),
    "PREFERENCE_NOT_LICENSED",
  );
});

test("M9-3 keeps prior external observations operational and requires exact Run licensing", async () => {
  await expectCode(
    () => buildExternalContextProjection(input({
      priorResults: [{
        resultId: "result-1",
        runId: "run-old",
        kind: "OPERATIONAL",
        value: { observation: "historical external fact" },
      }],
    })),
    "BINDING_MISMATCH",
  );

  await expectCode(
    () => buildExternalContextProjection(input({
      policy: { ...input().policy, licensedPriorResultIds: ["missing-result"] },
    })),
    "PRIOR_RESULT_NOT_LICENSED",
  );
});

test("M9-3 rejects secret-bearing keys and recognizable credential values", async () => {
  await expectCode(
    () => buildExternalContextProjection(input({
      intent: {
        ownerSubjectId: "subject-a",
        intentScopeId: "scope-a",
        intentVersionId: "intent-v3",
        values: { apiKey: "not-even-exportable" },
      },
      policy: { ...input().policy, intentKeys: ["apiKey"] },
    })),
    "SECRET_MATERIAL",
  );

  await expectCode(
    () => buildExternalContextProjection(input({
      currentUserTurn: {
        ...input().currentUserTurn,
        content: "Bearer abcdefghijklmnop",
      },
    })),
    "SECRET_MATERIAL",
  );
});

test("M9-3 excludes optional context unless explicitly licensed and bounds the final projection bytes", async () => {
  const minimal = buildExternalContextProjection(input({
    policy: {
      includeCurrentUserTurn: false,
      maxBytes: 1024,
    },
  }));
  assert.deepEqual(minimal, {
    role: "RESEARCH",
    runId: "run-a",
    intentScopeId: "scope-a",
    intentVersionId: "intent-v3",
  });

  await expectCode(
    () => buildExternalContextProjection(input({
      policy: { ...input().policy, maxBytes: 20 },
    })),
    "PROJECTION_TOO_LARGE",
  );
});
