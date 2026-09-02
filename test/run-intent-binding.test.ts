import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  MemoryIntentAuthorityStore,
  MemoryIntentBoundRunStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { createPendingRun } from "../src/run-execution.js";
import { MemoryRunStore } from "../src/run-store.js";

const request = {
  goal: "choose a laptop",
  priorities: [{ criterion: "performance", weight: 1 }],
  hardConstraints: [{ criterion: "budget", operator: "lte" as const, value: 1300 }],
};

function transition(
  id: string,
  turn: number,
  baseIntentVersionId: string | null,
  operations: IntentTransitionCommand["operations"],
): IntentTransitionCommand {
  return {
    transitionId: id,
    intentScopeId: "scope-1",
    baseIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

test("memory Run binding stays on its exact IntentVersion after scope head advances", async () => {
  const ids = ["intent-v1", "intent-v2"];
  const runId = randomUUID();
  const rejectedRunId = randomUUID();
  const intentStore = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected-version");
  const runStore = new MemoryRunStore();
  const boundRuns = new MemoryIntentBoundRunStore(runStore, intentStore);
  try {
    await intentStore.createScope({
      intentScopeId: "scope-1",
      initialTransition: transition("transition-1", 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });

    const run = createPendingRun("conversation-1", request, runId);
    const binding = await boundRuns.create(run, {
      intentScopeId: "scope-1",
      intentVersionId: "intent-v1",
    });
    assert.equal(binding.runId, runId);
    assert.equal(binding.intentScopeId, "scope-1");
    assert.equal(binding.intentVersionId, "intent-v1");

    const advanced = await intentStore.applyTransition(transition("transition-2", 2, "intent-v1", [
      { op: "SET", path: { kind: "PREFERENCE", key: "battery" }, value: { state: "VALUE", value: 12 } },
    ]));
    assert.equal(advanced.disposition, "COMMITTED");
    assert.equal((await intentStore.getScope("scope-1"))?.currentIntentVersionId, "intent-v2");

    assert.deepEqual(await boundRuns.getBinding(runId), binding);
    assert.equal((await runStore.get(runId))?.id, runId);

    await assert.rejects(
      boundRuns.create(createPendingRun("conversation-1", request, rejectedRunId), {
        intentScopeId: "scope-other",
        intentVersionId: "intent-v1",
      }),
      /existing exact IntentVersion/,
    );
    assert.equal(await runStore.get(rejectedRunId), undefined);

    await assert.rejects(
      boundRuns.create(run, { intentScopeId: "scope-1", intentVersionId: "intent-v2" }),
      /cannot be rebound/,
    );
    assert.deepEqual(await boundRuns.getBinding(runId), binding);
  } finally {
    await boundRuns.close();
    await runStore.close();
    await intentStore.close();
  }
});
