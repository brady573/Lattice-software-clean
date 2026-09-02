import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import type { Conversation } from "../src/conversation/conversation-store.js";
import type { RunIntentBinding } from "../src/intent/run-binding.js";
import type { DurableResearchTask } from "../src/orchestration-store.js";
import {
  BoundLiveResearchTaskExecutor,
  parseLiveV36ResearchTask,
  type LiveResearchOperation,
} from "../src/live-research-task-executor.js";
import type { LiveResearchBindingStores } from "../src/live-research-binding.js";

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

function task(overrides: Partial<DurableResearchTask> = {}): DurableResearchTask {
  const checkpointHash = "checkpoint-hash-1";
  return {
    id: "task-live-research",
    runId: "run-live-research",
    taskFingerprint: "fingerprint-live-research",
    planVersion: 1,
    taskType: "RESEARCH",
    input: {
      kind: "V36_RESEARCH_REQUEST",
      checkpointHash,
      request: {
        id: "research-request-1",
        runId: "run-live-research",
        claimId: "claim-1",
        parentRequestId: null,
        purpose: "SUPPORT",
        query: "Find current supporting evidence.",
        serialRound: 1,
      },
    },
    contextVersionIds: [`v36-checkpoint:${checkpointHash}`],
    dependsOn: [],
    runEpoch: 7,
    status: "RUNNING",
    maxAttempts: 1,
    attemptCount: 1,
    currentAttempt: 1,
    leaseOwner: "worker-1",
    leaseExpiresAt: "2026-08-31T00:01:00.000Z",
    acceptedResult: null,
    ...overrides,
  };
}

function stores(options: {
  runs?: (LatticeRun | undefined)[];
  bindings?: (RunIntentBinding | undefined)[];
  conversations?: (Conversation | undefined)[];
} = {}): LiveResearchBindingStores {
  const runs = [...(options.runs ?? [run(), run()])];
  const bindings = [...(options.bindings ?? [binding(), binding()])];
  const conversations = [...(options.conversations ?? [conversation(), conversation()])];
  let runIndex = 0;
  let bindingIndex = 0;
  let conversationIndex = 0;
  return {
    runStore: {
      async get() {
        const value = runs[Math.min(runIndex++, runs.length - 1)];
        return value === undefined ? undefined : structuredClone(value);
      },
    },
    runBindingStore: {
      async getBinding() {
        const value = bindings[Math.min(bindingIndex++, bindings.length - 1)];
        return value === undefined ? undefined : structuredClone(value);
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

function operation(fn: LiveResearchOperation["execute"]): LiveResearchOperation {
  return { execute: fn };
}

test("M9-5 parses only exact durable V36 research request tasks", () => {
  const parsed = parseLiveV36ResearchTask(task());
  assert.equal(parsed.checkpointHash, "checkpoint-hash-1");
  assert.equal(parsed.request.id, "research-request-1");
  assert.equal(parsed.request.runId, "run-live-research");
  assert.equal(parsed.request.query, "Find current supporting evidence.");

  assert.throws(
    () => parseLiveV36ResearchTask(task({ input: { kind: "OTHER" } })),
    /V36_RESEARCH_REQUEST/u,
  );
  assert.throws(
    () => parseLiveV36ResearchTask(task({ contextVersionIds: [] })),
    /checkpoint binding/u,
  );
  assert.throws(
    () => parseLiveV36ResearchTask(task({
      input: {
        kind: "V36_RESEARCH_REQUEST",
        checkpointHash: "checkpoint-hash-1",
        request: {
          id: "research-request-1",
          runId: "different-run",
          claimId: "claim-1",
          parentRequestId: null,
          purpose: "SUPPORT",
          query: "query",
          serialRound: 1,
        },
      },
    })),
    /crossed durable Run scope/u,
  );
});

test("M9-5 executes one injected operational research capability only inside the exact Product binding", async () => {
  let calls = 0;
  const executor = new BoundLiveResearchTaskExecutor(
    stores(),
    operation(async (context) => {
      calls += 1;
      assert.equal(context.binding.subjectId, "subject-live-research");
      assert.equal(context.binding.intentVersionId, "intent-live-research-v3");
      assert.equal(context.request.id, "research-request-1");
      assert.equal(context.checkpointHash, "checkpoint-hash-1");
      return {
        artifacts: [],
        edges: [],
        evidence: [{
          artifactId: "artifact-1",
          externalEvidenceId: "observation-1",
          relation: "SUPPORTS",
          specificEvidence: "Untrusted operational observation.",
        }],
      };
    }),
  );

  const result = await executor.execute({ task: task() });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    artifacts: [],
    edges: [],
    evidence: [{
      artifactId: "artifact-1",
      externalEvidenceId: "observation-1",
      relation: "SUPPORTS",
      specificEvidence: "Untrusted operational observation.",
    }],
  });
});

test("M9-5 refuses operational dispatch when Product binding is inactive", async () => {
  let calls = 0;
  const executor = new BoundLiveResearchTaskExecutor(
    stores({ runs: [run({ status: "CANCELLED" })] }),
    operation(async () => { calls += 1; return { artifacts: [], edges: [], evidence: [] }; }),
  );

  await assert.rejects(
    executor.execute({ task: task() }),
    /INVESTIGATING Run/u,
  );
  assert.equal(calls, 0);
});

test("M9-5 discards the external operation result when binding changes before persistence", async () => {
  let calls = 0;
  const executor = new BoundLiveResearchTaskExecutor(
    stores({
      runs: [run(), run({ status: "CANCELLED", version: 8 })],
      bindings: [binding()],
      conversations: [conversation()],
    }),
    operation(async () => {
      calls += 1;
      return { artifacts: [], edges: [], evidence: [] };
    }),
  );

  await assert.rejects(
    executor.execute({ task: task() }),
    /binding changed after dispatch/u,
  );
  assert.equal(calls, 1);
});
