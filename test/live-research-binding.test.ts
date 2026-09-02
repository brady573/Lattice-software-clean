import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import {
  assertLiveResearchBindingStillActive,
  LiveResearchBindingError,
  resolveLiveResearchBinding,
  type LiveResearchBindingStores,
} from "../src/live-research-binding.js";
import type { Conversation } from "../src/conversation/conversation-store.js";
import type { RunIntentBinding } from "../src/intent/run-binding.js";

function run(overrides: Partial<LatticeRun> = {}): LatticeRun {
  return {
    id: "run-live-research",
    conversationId: "conversation-live-research",
    status: "INVESTIGATING",
    version: 7,
    request: {
      goal: "Verify the current claim",
      priorities: [{ criterion: "quality", weight: 1 }],
      hardConstraints: [{ criterion: "eligible", operator: "eq", value: true }],
    },
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [{ sequence: 1, type: "CREATED" }],
    ...overrides,
  };
}

function binding(overrides: Partial<RunIntentBinding> = {}): RunIntentBinding {
  return {
    runId: "run-live-research",
    intentScopeId: "scope-live-research",
    intentVersionId: "intent-live-research-v3",
    boundAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-live-research",
    ownerSubjectId: "subject-live-research",
    createdAt: "2026-08-31T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function stores(options: {
  runs?: (LatticeRun | undefined)[];
  bindings?: (RunIntentBinding | undefined)[];
  conversations?: (Conversation | undefined)[];
} = {}): LiveResearchBindingStores {
  const runs = [...(options.runs ?? [run()])];
  const bindings = [...(options.bindings ?? [binding()])];
  const conversations = [...(options.conversations ?? [conversation()])];
  let runIndex = 0;
  let bindingIndex = 0;
  let conversationIndex = 0;
  return {
    runStore: {
      async get() {
        return structuredClone(runs[Math.min(runIndex++, runs.length - 1)]);
      },
    },
    runBindingStore: {
      async getBinding() {
        return structuredClone(bindings[Math.min(bindingIndex++, bindings.length - 1)]);
      },
    },
    conversationStore: {
      async get() {
        const value = conversations[Math.min(conversationIndex++, conversations.length - 1)];
        return value === undefined ? undefined : structuredClone(value);
      },
    },
  };
}

async function expectCode(
  operation: Promise<unknown>,
  code: LiveResearchBindingError["code"],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof LiveResearchBindingError);
    assert.equal(error.code, code);
    return true;
  });
}

test("M9-5 re-derives subject and exact IntentVersion from canonical Run ownership before live research", async () => {
  const resolved = await resolveLiveResearchBinding(stores(), {
    runId: "run-live-research",
    runEpoch: 7,
  });
  assert.deepEqual(resolved, {
    runId: "run-live-research",
    runEpoch: 7,
    runStatus: "INVESTIGATING",
    conversationId: "conversation-live-research",
    subjectId: "subject-live-research",
    intentScopeId: "scope-live-research",
    intentVersionId: "intent-live-research-v3",
  });
});

test("M9-5 blocks live dispatch when Run state, epoch, exact intent binding, or Conversation is unavailable", async () => {
  await expectCode(
    resolveLiveResearchBinding(stores({ runs: [undefined] }), { runId: "run-live-research", runEpoch: 7 }),
    "RUN_UNAVAILABLE",
  );
  await expectCode(
    resolveLiveResearchBinding(stores({ runs: [run({ status: "CANCELLED" })] }), { runId: "run-live-research", runEpoch: 7 }),
    "RUN_NOT_RESEARCHABLE",
  );
  await expectCode(
    resolveLiveResearchBinding(stores(), { runId: "run-live-research", runEpoch: 6 }),
    "RUN_EPOCH_MISMATCH",
  );
  await expectCode(
    resolveLiveResearchBinding(stores({ bindings: [undefined] }), { runId: "run-live-research", runEpoch: 7 }),
    "INTENT_BINDING_UNAVAILABLE",
  );
  await expectCode(
    resolveLiveResearchBinding(stores({ conversations: [undefined] }), { runId: "run-live-research", runEpoch: 7 }),
    "CONVERSATION_UNAVAILABLE",
  );
});

test("M9-5 last-safe-boundary recheck rejects subject, intent, Conversation, or Run movement after external dispatch", async () => {
  const initial = await resolveLiveResearchBinding(stores(), {
    runId: "run-live-research",
    runEpoch: 7,
  });

  await assertLiveResearchBindingStillActive(stores(), initial);

  await expectCode(
    assertLiveResearchBindingStillActive(stores({
      conversations: [conversation({ ownerSubjectId: "different-subject" })],
    }), initial),
    "BINDING_CHANGED",
  );
  await expectCode(
    assertLiveResearchBindingStillActive(stores({
      bindings: [binding({ intentVersionId: "intent-live-research-v4" })],
    }), initial),
    "BINDING_CHANGED",
  );
  await expectCode(
    assertLiveResearchBindingStillActive(stores({
      runs: [run({ status: "CANCELLED", version: 8 })],
    }), initial),
    "BINDING_CHANGED",
  );
});
